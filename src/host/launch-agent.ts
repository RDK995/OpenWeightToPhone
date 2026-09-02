import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolvePwaPort, resolveBundleRoot } from "./config.ts";

// ---------------------------------------------------------------------------
// Constants and exports
// ---------------------------------------------------------------------------

export const LAUNCH_AGENT_LABEL = "com.ryankenny.phone-pwa";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaunchAgentDeps {
  writeFile: (path: string, contents: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
  exec: (command: string, args: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function launchAgentPlistPath(label: string, home: string): string {
  return `${home}/Library/LaunchAgents/${label}.plist`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderPlist(options: {
  label: string;
  bunPath: string;
  serverScript: string;
  workingDirectory: string;
  port: number;
  bundleRoot: string;
  stdoutPath: string;
  stderrPath: string;
}): string {
  const {
    label,
    bunPath,
    serverScript,
    workingDirectory,
    port,
    bundleRoot,
    stdoutPath,
    stderrPath,
  } = options;

  const xmlEscape = escapeXml;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${xmlEscape(label)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xmlEscape(bunPath)}</string>
		<string>run</string>
		<string>${xmlEscape(serverScript)}</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${xmlEscape(workingDirectory)}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PHONE_PWA_PORT</key>
		<string>${xmlEscape(port.toString())}</string>
		<key>PHONE_PWA_BUNDLE_ROOT</key>
		<string>${xmlEscape(bundleRoot)}</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xmlEscape(stdoutPath)}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(stderrPath)}</string>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>`;

  return plist;
}

// ---------------------------------------------------------------------------
// Injectable orchestration
// ---------------------------------------------------------------------------

export async function installLaunchAgent(
  options: {
    label: string;
    uid: number;
    plistPath: string;
    plistContents: string;
  },
  deps: LaunchAgentDeps
): Promise<void> {
  const { label, uid, plistPath, plistContents } = options;

  // 1. mkdir the containing LaunchAgents directory (idempotent)
  const parentDir = dirname(plistPath);
  await deps.mkdir(parentDir);

  // 2. write the rendered plist to plistPath
  await deps.writeFile(plistPath, plistContents);

  // 3. launchctl bootout gui/<uid>/<label> (tolerating non-zero exit)
  await deps.exec("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(() => {
    // Tolerate failure
  });

  // 4. launchctl bootstrap gui/<uid> <plistPath> (non-zero exit IS a failure)
  const bootstrapResult = await deps.exec("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  if (bootstrapResult.exitCode !== 0) {
    throw new Error(
      `launchctl bootstrap failed: exit code ${bootstrapResult.exitCode}; stderr: ${bootstrapResult.stderr}`
    );
  }

  // 5. launchctl enable gui/<uid>/<label> (tolerating non-zero exit)
  await deps.exec("launchctl", ["enable", `gui/${uid}/${label}`]).catch(() => {
    // Tolerate failure
  });

  // 6. launchctl kickstart -k gui/<uid>/<label> (non-zero exit IS a failure)
  const kickstartResult = await deps.exec("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`]);
  if (kickstartResult.exitCode !== 0) {
    throw new Error(
      `launchctl kickstart failed: exit code ${kickstartResult.exitCode}; stderr: ${kickstartResult.stderr}`
    );
  }
}

export async function uninstallLaunchAgent(
  options: { label: string; uid: number; plistPath: string },
  deps: LaunchAgentDeps
): Promise<void> {
  const { label, uid, plistPath } = options;

  // launchctl bootout gui/<uid>/<label> (tolerating non-zero)
  await deps.exec("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(() => {
    // Tolerate failure
  });

  // remove the plist file (tolerating absence)
  await deps.rm(plistPath).catch(() => {
    // Tolerate absence
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function realExec(
  command: string,
  args: readonly string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** The real (non-fake) LaunchAgentDeps used by the CLI entry point below. */
export function createRealLaunchAgentDeps(): LaunchAgentDeps {
  return {
    writeFile,
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    rm: (path) => rm(path),
    exec: realExec,
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let shouldUninstall = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--uninstall") {
      shouldUninstall = true;
    } else if (arg === "--help") {
      console.log(
        [
          "Usage: launch-agent.ts [--uninstall] [--help]",
          "",
          "  Install or uninstall the PWA launch agent.",
          "",
          "Options:",
          "  --uninstall  Uninstall the launch agent.",
          "  --help       Show this help.",
        ].join("\n")
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  // Resolve paths
  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  const hostDir = dirname(currentFilePath);
  const rootDir = dirname(dirname(hostDir));
  const bunPath = `${process.env.HOME}/.bun/bin/bun`;
  const serverScript = join(hostDir, "pwa-server.ts");
  const bundleRoot = resolveBundleRoot();
  const port = resolvePwaPort();
  const home = homedir();
  const uid = process.getuid?.() ?? 0;
  const plistPath = launchAgentPlistPath(LAUNCH_AGENT_LABEL, home);
  const logDir = join(home, "Library", "Logs", "phone-pwa");

  const realDeps: LaunchAgentDeps = createRealLaunchAgentDeps();

  if (shouldUninstall) {
    await uninstallLaunchAgent(
      {
        label: LAUNCH_AGENT_LABEL,
        uid,
        plistPath,
      },
      realDeps
    );
    console.log(`Launch agent uninstalled.`);
    process.exit(0);
  } else {
    const plistContents = renderPlist({
      label: LAUNCH_AGENT_LABEL,
      bunPath,
      serverScript,
      workingDirectory: rootDir,
      port,
      bundleRoot,
      stdoutPath: join(logDir, "stdout.log"),
      stderrPath: join(logDir, "stderr.log"),
    });

    try {
      await installLaunchAgent(
        {
          label: LAUNCH_AGENT_LABEL,
          uid,
          plistPath,
          plistContents,
        },
        realDeps
      );
      console.log(`Launch agent installed at ${plistPath}`);
      process.exit(0);
    } catch (err) {
      console.error(`Launch agent installation failed: ${(err as Error).message}`);
      process.exit(6);
    }
  }
}
