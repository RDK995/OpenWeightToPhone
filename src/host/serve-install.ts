import { APP_MOUNT_PATH, resolvePwaPort } from "./config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServeHandler = { path: string; proxy: string | null };

export type ServeStatusHandlerEntry = { Proxy?: string; [key: string]: unknown };

export type ServeStatus = {
  Web?:
    | Record<
        string,
        { Handlers?: Record<string, ServeStatusHandlerEntry> } | undefined
      >
    | undefined;
  [key: string]: unknown;
};

export type ServePlan = {
  action: "noop" | "apply";
  reason: string;
  command: string[];
  root: ServeHandler | null;
  app: ServeHandler | null;
};

export type Exec = (
  argv: string[]
) => Promise<{ code: number; stdout: string; stderr: string }>;

// ---------------------------------------------------------------------------
// Pure planning / diagnosis
// ---------------------------------------------------------------------------

export function findHandlers(
  status: ServeStatus,
  mountPath: string
): { root: ServeHandler | null; app: ServeHandler | null; hostKey: string | null } {
  const web = status.Web ?? {};
  const hostKey = Object.keys(web)[0] ?? null;
  const handlers = (hostKey !== null ? web[hostKey]?.Handlers : undefined) ?? {};

  const toHandler = (path: string): ServeHandler | null => {
    const entry = handlers[path];
    if (!entry) return null;
    return { path, proxy: entry.Proxy ?? null };
  };

  return {
    root: toHandler("/"),
    app: toHandler(mountPath),
    hostKey,
  };
}

const DANGEROUS_WORDS = ["reset", "clear", "drain", "off", "--funnel", "sudo"];

function assertSafeCommand(command: string[], mountPath: string): void {
  if (command.length === 0) return;

  const joined = command.join(" ");
  for (const word of DANGEROUS_WORDS) {
    if (command.includes(word) || joined.includes(word)) {
      throw new Error(`refusing to run unsafe tailscale serve command: ${joined}`);
    }
  }

  const setPathIndex = command.indexOf("--set-path");
  if (setPathIndex === -1 || command[setPathIndex + 1] !== mountPath) {
    throw new Error(
      `refusing to run tailscale serve command that does not target ${mountPath}: ${joined}`
    );
  }
}

export function planServeInstall(
  status: ServeStatus,
  opts: { port: number; mountPath: string }
): ServePlan {
  const { port, mountPath } = opts;
  const expectedTarget = `http://127.0.0.1:${port}`;
  const { root, app } = findHandlers(status, mountPath);

  let plan: ServePlan;
  if (app && app.proxy === expectedTarget) {
    plan = {
      action: "noop",
      reason: `${mountPath} already proxies to ${expectedTarget}`,
      command: [],
      root,
      app,
    };
  } else {
    plan = {
      action: "apply",
      reason: app
        ? `${mountPath} proxies to ${app.proxy ?? "(none)"} instead of ${expectedTarget}`
        : `${mountPath} handler is absent`,
      command: ["tailscale", "serve", "--bg", "--set-path", mountPath, expectedTarget],
      root,
      app,
    };
  }

  assertSafeCommand(plan.command, mountPath);
  return plan;
}

export function diagnose(
  status: ServeStatus,
  opts: { port: number; mountPath: string }
): { ok: boolean; exitCode: number; lines: string[] } {
  const { port, mountPath } = opts;
  const expectedTarget = `http://127.0.0.1:${port}`;
  const { root, app, hostKey } = findHandlers(status, mountPath);
  const lines: string[] = [];

  if (root) {
    lines.push(`/ handler: present, proxies to ${root.proxy ?? "(no proxy set)"}`);
  } else {
    lines.push(`/ handler: ABSENT`);
  }

  if (!app) {
    lines.push(`${mountPath} handler: ABSENT`);
    lines.push(`Run this to apply it: tailscale serve --bg --set-path ${mountPath} ${expectedTarget}`);
    lines.push(
      `Until it is applied, https://${hostKey ?? "<host>"}${mountPath}/ will be proxied to the harness and return 401.`
    );
    return { ok: false, exitCode: 3, lines };
  }

  if (app.proxy !== expectedTarget) {
    lines.push(
      `${mountPath} handler: present, but proxies to ${app.proxy ?? "(no proxy set)"} (expected ${expectedTarget})`
    );
    return { ok: false, exitCode: 4, lines };
  }

  lines.push(`${mountPath} handler: present, proxies to ${expectedTarget} (correct)`);
  return { ok: true, exitCode: 0, lines };
}

// ---------------------------------------------------------------------------
// Injectable orchestration
// ---------------------------------------------------------------------------

async function readStatus(
  exec: Exec
): Promise<{ ok: true; status: ServeStatus } | { ok: false; lines: string[] }> {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await exec(["tailscale", "serve", "status", "--json"]);
  } catch (err) {
    return {
      ok: false,
      lines: [`Could not read the current Tailscale Serve configuration: ${(err as Error).message}`],
    };
  }

  if (result.code !== 0) {
    return {
      ok: false,
      lines: [
        `Could not read the current Tailscale Serve configuration (exit code ${result.code}).`,
        result.stderr,
      ],
    };
  }

  try {
    const status = JSON.parse(result.stdout) as ServeStatus;
    return { ok: true, status };
  } catch {
    return {
      ok: false,
      lines: [`Could not parse the Tailscale Serve status output as JSON.`],
    };
  }
}

export async function runServeInstall(opts: {
  mode: "check" | "apply";
  port: number;
  mountPath: string;
  dryRun?: boolean;
  exec: Exec;
}): Promise<{ exitCode: number; lines: string[] }> {
  const { mode, port, mountPath, dryRun, exec } = opts;

  const statusResult = await readStatus(exec);
  if (!statusResult.ok) {
    return { exitCode: 6, lines: statusResult.lines };
  }
  const status = statusResult.status;

  if (mode === "check") {
    const d = diagnose(status, { port, mountPath });
    return { exitCode: d.exitCode, lines: d.lines };
  }

  // mode === "apply"
  const plan = planServeInstall(status, { port, mountPath });

  if (plan.action === "noop") {
    return {
      exitCode: 0,
      lines: [`${mountPath} already proxies to http://127.0.0.1:${port}; nothing to do.`],
    };
  }

  if (dryRun) {
    return {
      exitCode: 0,
      lines: [`Dry run: would run: ${plan.command.join(" ")}`],
    };
  }

  const originalRoot = plan.root;

  const applyResult = await exec(plan.command);
  if (applyResult.code !== 0) {
    return {
      exitCode: 6,
      lines: [
        `tailscale serve apply failed: ${applyResult.stderr}`,
        `Run this yourself: ${plan.command.join(" ")}`,
      ],
    };
  }

  const postStatusResult = await readStatus(exec);
  if (!postStatusResult.ok) {
    return { exitCode: 6, lines: postStatusResult.lines };
  }
  const post = findHandlers(postStatusResult.status, mountPath);

  if (originalRoot && (!post.root || post.root.proxy !== originalRoot.proxy)) {
    return {
      exitCode: 5,
      lines: [
        `DANGER: the / handler changed or vanished while applying the ${mountPath} mapping.`,
        post.root
          ? `/ now proxies to ${post.root.proxy ?? "(no proxy set)"}, previously ${originalRoot.proxy ?? "(no proxy set)"}.`
          : `/ handler is now ABSENT; it previously proxied to ${originalRoot.proxy ?? "(no proxy set)"}.`,
        `Restore it with: tailscale serve --bg --set-path / ${originalRoot.proxy ?? ""}`.trimEnd(),
      ],
    };
  }

  const expectedTarget = `http://127.0.0.1:${port}`;
  if (!post.app || post.app.proxy !== expectedTarget) {
    return {
      exitCode: 3,
      lines: [`${mountPath} handler is still absent or incorrect after applying.`],
    };
  }

  return { exitCode: 0, lines: [`${mountPath} now proxies to ${expectedTarget}.`] };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    [
      "Usage: serve-install.ts [check|apply] [--dry-run] [--port <n>] [--mount <path>] [--help]",
      "",
      "  check   Report the current Tailscale Serve mapping state (default).",
      "  apply   Apply the mapping if it is missing or incorrect.",
      "",
      "Options:",
      "  --dry-run       Print the command that would run, without executing it.",
      "  --port <n>      Loopback port to proxy to (default: from PHONE_PWA_PORT / 7788).",
      `  --mount <path>  Mount path to check/apply (default: ${APP_MOUNT_PATH}).`,
      "  --help          Show this help.",
    ].join("\n")
  );
}

async function realExec(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let mode: "check" | "apply" = "check";
  let dryRun = false;
  let port = resolvePwaPort();
  let mountPath: string = APP_MOUNT_PATH;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "check" || arg === "apply") {
      mode = arg;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--port") {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        console.error("--port requires a value");
        process.exit(1);
      }
      port = Number.parseInt(value, 10);
    } else if (arg === "--mount") {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        console.error("--mount requires a value");
        process.exit(1);
      }
      mountPath = value;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  const result = await runServeInstall({ mode, port, mountPath, dryRun, exec: realExec });
  for (const line of result.lines) {
    console.log(line);
  }
  process.exit(result.exitCode);
}
