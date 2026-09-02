import { describe, expect, test } from "bun:test";
import {
  diagnose,
  findHandlers,
  planServeInstall,
  runServeInstall,
  type Exec,
  type ServeStatus,
} from "../../src/host/serve-install.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REAL_STATUS: ServeStatus = {
  TCP: { "443": { HTTPS: true } },
  Web: {
    "ryans-mac-studio.tailc3648a.ts.net:443": {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:7787" },
      },
    },
  },
};

const CORRECT_STATUS: ServeStatus = {
  TCP: { "443": { HTTPS: true } },
  Web: {
    "ryans-mac-studio.tailc3648a.ts.net:443": {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:7787" },
        "/app": { Proxy: "http://127.0.0.1:7788" },
      },
    },
  },
};

const WRONG_TARGET_STATUS: ServeStatus = {
  TCP: { "443": { HTTPS: true } },
  Web: {
    "ryans-mac-studio.tailc3648a.ts.net:443": {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:7787" },
        "/app": { Proxy: "http://127.0.0.1:9999" },
      },
    },
  },
};

const PORT = 7788;
const MOUNT = "/app";

describe("findHandlers", () => {
  test("locates root but not app in the real absent status", () => {
    const { root, app, hostKey } = findHandlers(REAL_STATUS, MOUNT);
    expect(root).toEqual({ path: "/", proxy: "http://127.0.0.1:7787" });
    expect(app).toBeNull();
    expect(hostKey).toBe("ryans-mac-studio.tailc3648a.ts.net:443");
  });

  test("tolerates missing Web, host key, and Handlers", () => {
    expect(findHandlers({}, MOUNT)).toEqual({ root: null, app: null, hostKey: null });
    expect(findHandlers({ Web: {} }, MOUNT)).toEqual({ root: null, app: null, hostKey: null });
    expect(
      findHandlers({ Web: { "host:443": {} } }, MOUNT)
    ).toEqual({ root: null, app: null, hostKey: "host:443" });
  });
});

describe("diagnose", () => {
  test("exit code 3 when /app handler is absent, includes copyable command and 401 explanation", () => {
    const result = diagnose(REAL_STATUS, { port: PORT, mountPath: MOUNT });
    expect(result.exitCode).toBe(3);
    expect(result.ok).toBe(false);
    const joined = result.lines.join("\n");
    expect(joined).toContain("tailscale serve --bg --set-path /app http://127.0.0.1:7788");
    expect(joined).toContain("401");
    expect(joined.toLowerCase()).toContain("/ handler");
    expect(joined).toContain("http://127.0.0.1:7787");
  });

  test("exit code 0 when /app is present and correct", () => {
    const result = diagnose(CORRECT_STATUS, { port: PORT, mountPath: MOUNT });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
  });

  test("exit code 4 when /app points elsewhere, states both found and expected targets", () => {
    const result = diagnose(WRONG_TARGET_STATUS, { port: PORT, mountPath: MOUNT });
    expect(result.exitCode).toBe(4);
    expect(result.ok).toBe(false);
    const joined = result.lines.join("\n");
    expect(joined).toContain("http://127.0.0.1:9999");
    expect(joined).toContain("http://127.0.0.1:7788");
  });
});

describe("planServeInstall", () => {
  test("returns noop with empty command when already correct", () => {
    const plan = planServeInstall(CORRECT_STATUS, { port: PORT, mountPath: MOUNT });
    expect(plan.action).toBe("noop");
    expect(plan.command).toEqual([]);
  });

  test("returns apply command when absent", () => {
    const plan = planServeInstall(REAL_STATUS, { port: PORT, mountPath: MOUNT });
    expect(plan.action).toBe("apply");
    expect(plan.command).toEqual([
      "tailscale",
      "serve",
      "--bg",
      "--set-path",
      "/app",
      "http://127.0.0.1:7788",
    ]);
  });

  test("command never contains dangerous subcommands or flags", () => {
    for (const status of [REAL_STATUS, WRONG_TARGET_STATUS, CORRECT_STATUS]) {
      const plan = planServeInstall(status, { port: PORT, mountPath: MOUNT });
      const joined = plan.command.join(" ");
      expect(joined).not.toContain("reset");
      expect(joined).not.toContain("clear");
      expect(joined).not.toContain("drain");
      expect(joined).not.toContain("off");
      expect(joined).not.toContain("--funnel");
      expect(joined).not.toContain("sudo");
    }
  });
});

function spyExec(responses: Array<{ code: number; stdout: string; stderr: string }>): {
  exec: Exec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const exec: Exec = async (argv: string[]) => {
    calls.push(argv);
    const response = responses[calls.length - 1];
    if (!response) {
      throw new Error(`spyExec called more times than expected: ${calls.length}`);
    }
    return response;
  };
  return { exec, calls };
}

describe("runServeInstall", () => {
  test("mode:check calls exec exactly once with status --json", async () => {
    const { exec, calls } = spyExec([
      { code: 0, stdout: JSON.stringify(REAL_STATUS), stderr: "" },
    ]);
    const result = await runServeInstall({ mode: "check", port: PORT, mountPath: MOUNT, exec });
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(["tailscale", "serve", "status", "--json"]);
    expect(result.exitCode).toBe(3);
  });

  test("mode:apply against already-correct status calls exec exactly once (idempotent)", async () => {
    const { exec, calls } = spyExec([
      { code: 0, stdout: JSON.stringify(CORRECT_STATUS), stderr: "" },
    ]);
    const result = await runServeInstall({ mode: "apply", port: PORT, mountPath: MOUNT, exec });
    expect(calls.length).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  test("mode:apply, dryRun:true against absent status calls exec exactly once and returns 0", async () => {
    const { exec, calls } = spyExec([
      { code: 0, stdout: JSON.stringify(REAL_STATUS), stderr: "" },
    ]);
    const result = await runServeInstall({
      mode: "apply",
      port: PORT,
      mountPath: MOUNT,
      dryRun: true,
      exec,
    });
    expect(calls.length).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  test("mode:apply against absent status applies, verifies, and returns 0", async () => {
    const { exec, calls } = spyExec([
      { code: 0, stdout: JSON.stringify(REAL_STATUS), stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: JSON.stringify(CORRECT_STATUS), stderr: "" },
    ]);
    const result = await runServeInstall({ mode: "apply", port: PORT, mountPath: MOUNT, exec });
    expect(result.exitCode).toBe(0);
    expect(calls[1]).toEqual([
      "tailscale",
      "serve",
      "--bg",
      "--set-path",
      "/app",
      "http://127.0.0.1:7788",
    ]);
  });

  test("returns exit code 5 and restore command when / vanishes after apply", async () => {
    const postApplyRootDestroyed: ServeStatus = {
      Web: {
        "ryans-mac-studio.tailc3648a.ts.net:443": {
          Handlers: {
            "/app": { Proxy: "http://127.0.0.1:7788" },
          },
        },
      },
    };
    const { exec } = spyExec([
      { code: 0, stdout: JSON.stringify(REAL_STATUS), stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: JSON.stringify(postApplyRootDestroyed), stderr: "" },
    ]);
    const result = await runServeInstall({ mode: "apply", port: PORT, mountPath: MOUNT, exec });
    expect(result.exitCode).toBe(5);
    const joined = result.lines.join("\n");
    expect(joined).toContain("http://127.0.0.1:7787");
    expect(joined).toContain("tailscale serve --bg --set-path / http://127.0.0.1:7787");
  });

  test("returns exit code 6 and reports authorisation refusal", async () => {
    const { exec } = spyExec([
      { code: 0, stdout: JSON.stringify(REAL_STATUS), stderr: "" },
      { code: 1, stdout: "", stderr: "access denied" },
    ]);
    const result = await runServeInstall({ mode: "apply", port: PORT, mountPath: MOUNT, exec });
    expect(result.exitCode).toBe(6);
    const joined = result.lines.join("\n");
    expect(joined).toContain("access denied");
    expect(joined).toContain("tailscale serve --bg --set-path /app http://127.0.0.1:7788");
  });

  test("malformed status JSON returns exit code 6", async () => {
    const { exec } = spyExec([{ code: 0, stdout: "not json{{", stderr: "" }]);
    const result = await runServeInstall({ mode: "check", port: PORT, mountPath: MOUNT, exec });
    expect(result.exitCode).toBe(6);
  });
});

describe("deploy/install-serve.sh", () => {
  test("contains none of the dangerous strings", () => {
    const script = readFileSync(
      join(import.meta.dir, "..", "..", "deploy", "install-serve.sh"),
      "utf-8"
    );
    expect(script).not.toContain("sudo");
    expect(script).not.toContain("serve reset");
    expect(script).not.toContain("serve clear");
  });
});
