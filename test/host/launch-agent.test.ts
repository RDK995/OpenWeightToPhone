import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  LAUNCH_AGENT_LABEL,
  launchAgentPlistPath,
  escapeXml,
  renderPlist,
  installLaunchAgent,
  uninstallLaunchAgent,
  type LaunchAgentDeps,
} from "../../src/host/launch-agent.ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const PORT = 7788;
const BUNDLE_ROOT = "/Users/test/repo/web/dist";
const LABEL = "com.test.pwa";
const HOME = "/Users/test";
const BUN_PATH = "/Users/test/.bun/bin/bun";
const SERVER_SCRIPT = "/Users/test/repo/src/host/pwa-server.ts";
const WORKING_DIR = "/Users/test/repo";

describe("launchAgentPlistPath", () => {
  test("constructs correct path", () => {
    const path = launchAgentPlistPath("com.x.y", "/Users/z");
    expect(path).toBe("/Users/z/Library/LaunchAgents/com.x.y.plist");
  });
});

describe("escapeXml", () => {
  test("escapes ampersand", () => {
    expect(escapeXml("a&b")).toBe("a&amp;b");
  });

  test("escapes less-than", () => {
    expect(escapeXml("a<b")).toBe("a&lt;b");
  });

  test("escapes greater-than", () => {
    expect(escapeXml("a>b")).toBe("a&gt;b");
  });

  test("escapes quotes", () => {
    expect(escapeXml('a"b')).toBe("a&quot;b");
  });

  test("escapes apostrophes", () => {
    expect(escapeXml("a'b")).toBe("a&apos;b");
  });

  test("escapes multiple characters", () => {
    expect(escapeXml("a&<>\"'b")).toBe("a&amp;&lt;&gt;&quot;&apos;b");
  });
});

describe("renderPlist", () => {
  test("returns valid XML plist that passes plutil -lint", async () => {
    const plist = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    // Write to temp file
    const tempDir = mkdtempSync(join(tmpdir(), "launch-agent-"));
    const tempFile = join(tempDir, "test.plist");

    try {
      await writeFile(tempFile, plist);

      // Run plutil -lint
      const proc = Bun.spawn(["plutil", "-lint", tempFile], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test("round-trips correctly with plutil convert", async () => {
    const plist = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    // Write to temp file
    const tempDir = mkdtempSync(join(tmpdir(), "launch-agent-"));
    const tempFile = join(tempDir, "test.plist");

    try {
      await writeFile(tempFile, plist);

      // Convert to JSON and parse
      const proc = Bun.spawn(["plutil", "-convert", "json", "-o", "-", tempFile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const jsonText = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(jsonText);

      // Verify key values
      expect(parsed.Label).toBe(LABEL);
      expect(parsed.ProgramArguments).toEqual([BUN_PATH, "run", SERVER_SCRIPT]);
      expect(parsed.WorkingDirectory).toBe(WORKING_DIR);
      expect(parsed.RunAtLoad).toBe(true);
      expect(parsed.KeepAlive).toBe(true);
      expect(parsed.StandardOutPath).toBe("/tmp/stdout.log");
      expect(parsed.StandardErrorPath).toBe("/tmp/stderr.log");
      expect(parsed.ProcessType).toBe("Interactive");
      expect(parsed.EnvironmentVariables.PHONE_PWA_PORT).toBe("7788");
      expect(parsed.EnvironmentVariables.PHONE_PWA_BUNDLE_ROOT).toBe(BUNDLE_ROOT);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test("XML escapes are preserved in round-trip", async () => {
    const workingDirWithSpecials = "/Users/test/repo&<>/test";
    const escapedDir = "/Users/test/repo&amp;&lt;&gt;/test";

    const plist = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: workingDirWithSpecials,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    // Write to temp file
    const tempDir = mkdtempSync(join(tmpdir(), "launch-agent-"));
    const tempFile = join(tempDir, "test.plist");

    try {
      await writeFile(tempFile, plist);

      // Run plutil -lint to verify it's valid
      const lintProc = Bun.spawn(["plutil", "-lint", tempFile], { stdout: "pipe", stderr: "pipe" });
      const lintExitCode = await lintProc.exited;
      expect(lintExitCode).toBe(0);

      // Convert to JSON and parse
      const proc = Bun.spawn(["plutil", "-convert", "json", "-o", "-", tempFile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const jsonText = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(jsonText);

      // Verify the working directory is unescaped
      expect(parsed.WorkingDirectory).toBe(workingDirWithSpecials);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});

describe("installLaunchAgent", () => {
  test("executes bootout, bootstrap, enable, kickstart in order", async () => {
    const execCalls: Array<{ command: string; args: string[] }> = [];
    const writeCalls: Array<{ path: string; contents: string }> = [];

    const fakeDeps: LaunchAgentDeps = {
      writeFile: async (path, contents) => {
        writeCalls.push({ path, contents });
      },
      mkdir: async () => {
        // noop
      },
      rm: async () => {
        // noop
      },
      exec: async (command, args) => {
        execCalls.push({ command, args: Array.from(args) });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistContents = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    await installLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
        plistContents,
      },
      fakeDeps
    );

    // Verify write happened first
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0]!.path).toBe(plistPath);
    expect(writeCalls[0]!.contents).toBe(plistContents);

    // Verify exec sequence
    expect(execCalls.length).toBe(4);
    expect(execCalls[0]!).toEqual({ command: "launchctl", args: ["bootout", "gui/501/com.test.pwa"] });
    expect(execCalls[1]!).toEqual({ command: "launchctl", args: ["bootstrap", "gui/501", plistPath] });
    expect(execCalls[2]!).toEqual({ command: "launchctl", args: ["enable", "gui/501/com.test.pwa"] });
    expect(execCalls[3]!).toEqual({ command: "launchctl", args: ["kickstart", "-k", "gui/501/com.test.pwa"] });
  });

  test("succeeds when bootout returns non-zero", async () => {
    const execCalls: Array<{ command: string; args: string[] }> = [];

    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      exec: async (command, args) => {
        execCalls.push({ command, args: Array.from(args) });
        // First call (bootout) returns non-zero
        if (execCalls.length === 1) {
          return { exitCode: 1, stdout: "", stderr: "not loaded" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistContents = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    // Should not throw
    await installLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
        plistContents,
      },
      fakeDeps
    );

    expect(execCalls.length).toBe(4);
  });

  test("succeeds when enable returns non-zero", async () => {
    const execCalls: Array<{ command: string; args: string[] }> = [];

    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      exec: async (command, args) => {
        execCalls.push({ command, args: Array.from(args) });
        // enable (call 3) returns non-zero
        if (execCalls.length === 3) {
          return { exitCode: 1, stdout: "", stderr: "already enabled" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistContents = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    // Should not throw
    await installLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
        plistContents,
      },
      fakeDeps
    );

    expect(execCalls.length).toBe(4);
  });

  test("rejects when bootstrap returns non-zero", async () => {
    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      exec: async (command, args) => {
        if (command === "launchctl" && args[0] === "bootstrap") {
          return { exitCode: 1, stdout: "", stderr: "bad plist" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistContents = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    try {
      await installLaunchAgent(
        {
          label: LABEL,
          uid: 501,
          plistPath,
          plistContents,
        },
        fakeDeps
      );
      throw new Error("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("launchctl bootstrap");
      expect((err as Error).message).toContain("exit code 1");
      expect((err as Error).message).toContain("bad plist");
    }
  });

  test("rejects when kickstart returns non-zero", async () => {
    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      exec: async (command, args) => {
        if (command === "launchctl" && args[0] === "kickstart") {
          return { exitCode: 1, stdout: "", stderr: "service failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistContents = renderPlist({
      label: LABEL,
      bunPath: BUN_PATH,
      serverScript: SERVER_SCRIPT,
      workingDirectory: WORKING_DIR,
      port: PORT,
      bundleRoot: BUNDLE_ROOT,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
    });

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    try {
      await installLaunchAgent(
        {
          label: LABEL,
          uid: 501,
          plistPath,
          plistContents,
        },
        fakeDeps
      );
      throw new Error("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("launchctl kickstart");
      expect((err as Error).message).toContain("exit code 1");
      expect((err as Error).message).toContain("service failed");
    }
  });
});

describe("uninstallLaunchAgent", () => {
  test("issues bootout and removes plist file", async () => {
    const execCalls: Array<{ command: string; args: string[] }> = [];
    const rmCalls: string[] = [];

    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async (path) => {
        rmCalls.push(path);
      },
      exec: async (command, args) => {
        execCalls.push({ command, args: Array.from(args) });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    await uninstallLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
      },
      fakeDeps
    );

    // Verify exec
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toEqual({ command: "launchctl", args: ["bootout", "gui/501/com.test.pwa"] });

    // Verify rm
    expect(rmCalls.length).toBe(1);
    expect(rmCalls[0]).toBe(plistPath);
  });

  test("tolerates bootout non-zero exit", async () => {
    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {},
      exec: async () => {
        return { exitCode: 1, stdout: "", stderr: "not loaded" };
      },
    };

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    // Should not throw
    await uninstallLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
      },
      fakeDeps
    );
  });

  test("tolerates missing plist file", async () => {
    const fakeDeps: LaunchAgentDeps = {
      writeFile: async () => {},
      mkdir: async () => {},
      rm: async () => {
        throw new Error("ENOENT: no such file");
      },
      exec: async () => {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const plistPath = launchAgentPlistPath(LABEL, HOME);

    // Should not throw
    await uninstallLaunchAgent(
      {
        label: LABEL,
        uid: 501,
        plistPath,
      },
      fakeDeps
    );
  });
});

describe("LAUNCH_AGENT_LABEL", () => {
  test("is set to correct value", () => {
    expect(LAUNCH_AGENT_LABEL).toBe("com.ryankenny.phone-pwa");
  });
});
