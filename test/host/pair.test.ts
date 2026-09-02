import { describe, it, expect } from "bun:test";
import { renderPairing, parsePairArgs } from "../../src/host/pair.ts";
import { pairingUrlWithToken, readToken } from "../../src/host/config.ts";
import { encodeQr } from "../../src/qr/encode.ts";
import { matrixToPng } from "../../src/qr/png.ts";
import { renderToAnsi } from "../../src/qr/render.ts";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { execSync, spawnSync } from "child_process";
import { join } from "path";

describe("pair.ts", () => {
  describe("renderPairing", () => {
    it("should return a string", () => {
      const result = renderPairing({
        token: "test-token-43-chars-exactly-here!!",
        baseUrl: "https://example.com",
      });
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should contain the base URL in output", () => {
      const baseUrl = "https://example.com";
      const result = renderPairing({
        token: "test-token-43-chars-exactly-here!!",
        baseUrl,
      });
      expect(result).toContain(baseUrl);
    });

    it("should contain a QR block character", () => {
      const result = renderPairing({
        token: "test-token-43-chars-exactly-here!!",
        baseUrl: "https://example.com",
      });
      const hasQrChar =
        result.includes("█") || result.includes("▀") || result.includes("▄");
      expect(hasQrChar).toBe(true);
    });

    it("should not contain the full token", () => {
      const token = "test-token-43-chars-exactly-here!!";
      const result = renderPairing({
        token,
        baseUrl: "https://example.com",
      });
      expect(result).not.toContain(token);
    });

    it("should not contain any 8-character substring of the token", () => {
      const token = "A".repeat(43);
      const result = renderPairing({
        token,
        baseUrl: "https://example.com",
      });

      // Check all 8-character windows
      for (let i = 0; i <= token.length - 8; i++) {
        const window = token.slice(i, i + 8);
        expect(result).not.toContain(window);
      }
    });

    it("should not contain percent-encoded token", () => {
      const token = "test#token&special";
      const result = renderPairing({
        token,
        baseUrl: "https://example.com",
      });
      const encoded = encodeURIComponent(token);
      expect(result).not.toContain(encoded);
    });

    it("should not contain the pairing URL", () => {
      const token = "test-token-43-chars-exactly-here!!";
      const baseUrl = "https://example.com";
      const result = renderPairing({
        token,
        baseUrl,
      });
      const pairingUrl = pairingUrlWithToken(token, {
        OPENWEIGHT_HARNESS_BASE_URL: baseUrl,
      });
      expect(result).not.toContain(pairingUrl);
    });

    it("should include human-readable instruction", () => {
      const result = renderPairing({
        token: "test-token-43-chars-exactly-here!!",
        baseUrl: "https://example.com",
      });
      // Should have some instruction about scanning
      const lower = result.toLowerCase();
      expect(
        lower.includes("scan") ||
          lower.includes("qr") ||
          lower.includes("code")
      ).toBe(true);
    });

    it("should fail gracefully when token file has insecure permissions (mode 0644)", () => {
      // Create a temporary fixture token file with insecure permissions
      const tempDir = mkdtempSync(join("/tmp", "pair-test-perm-"));
      const tokenPath = join(tempDir, "token");
      const fixtureToken = "ThistestToken1234567890123456789012345";

      writeFileSync(tokenPath, fixtureToken);
      chmodSync(tokenPath, 0o644); // World-readable: insecure

      const prevEnv = process.env.OPENWEIGHT_HARNESS_TOKEN_FILE;
      try {
        // Set the environment variable to point to the fixture
        process.env.OPENWEIGHT_HARNESS_TOKEN_FILE = tokenPath;

        let errorThrown = false;
        let errorMessage = "";

        try {
          // Attempt to read the token (which should fail due to permissions)
          readToken();
        } catch (error) {
          errorThrown = true;
          errorMessage = error instanceof Error ? error.message : String(error);
        }

        // Should have thrown
        expect(errorThrown).toBe(true);

        // Error message should mention the permission issue
        expect(errorMessage).toContain("mode");

        // Error message should NOT contain the token
        expect(errorMessage).not.toContain(fixtureToken);

        // Also check no 8-character substring of token appears
        for (let i = 0; i <= fixtureToken.length - 8; i++) {
          const window = fixtureToken.slice(i, i + 8);
          expect(errorMessage).not.toContain(window);
        }
      } finally {
        // Restore environment
        if (prevEnv !== undefined) {
          process.env.OPENWEIGHT_HARNESS_TOKEN_FILE = prevEnv;
        } else {
          delete process.env.OPENWEIGHT_HARNESS_TOKEN_FILE;
        }

        // Clean up fixture
        chmodSync(tokenPath, 0o600);
        rmSync(tempDir, { recursive: true });
      }
    });

    it("should round-trip through QR decode correctly (swift)", () => {
      // Create a temporary fixture token file
      const tempDir = mkdtempSync(join("/tmp", "pair-test-swift-"));
      const tokenPath = join(tempDir, "token");
      const fixtureToken = "FixtureToken1234567890123456789012345678";
      const fixtureBaseUrl = "https://machine.tailcXXXX.ts.net";

      writeFileSync(tokenPath, fixtureToken);
      chmodSync(tokenPath, 0o600); // Secure permissions

      try {
        // The pairing URL we expect to encode
        const expectedPairingUrl = pairingUrlWithToken(fixtureToken, {
          OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
        });

        // Encode the URL into a QR matrix
        const matrix = encodeQr(expectedPairingUrl, { ecc: "M" });

        // Render to PNG (in-memory)
        const pngData = matrixToPng(matrix);

        // Write to a temporary file
        const pngPath = join(tempDir, "qr.png");
        writeFileSync(pngPath, pngData);

        // Check if swift is available
        try {
          execSync("which swift", { stdio: "ignore" });
        } catch {
          // Swift not available, skip this test gracefully
          console.warn("Swift not found on PATH; round-trip assertion did not run");
          return;
        }

        // Decode using swift
        const projectRoot = "/Users/ryankenny/Projects/phoneToLocalModel";
        const swiftDecoderPath = join(projectRoot, "scripts", "qr-decode.swift");

        const decodedPayload = execSync(`swift "${swiftDecoderPath}" "${pngPath}"`, {
          encoding: "utf-8",
        }).trim();

        // The decoded payload should match the expected pairing URL
        expect(decodedPayload).toBe(expectedPairingUrl);
      } finally {
        // Clean up fixture
        chmodSync(tokenPath, 0o600);
        rmSync(tempDir, { recursive: true });
      }
    });

    // Test (a): Default output is unchanged
    it("should produce byte-for-byte identical output to the original when showUrl is not provided", () => {
      const token = "test-token-43-chars-exactly-here!!";
      const baseUrl = "https://example.com";

      const result = renderPairing({
        token,
        baseUrl,
      });

      // Reconstruct the expected output exactly as specified
      const pairingUrl = pairingUrlWithToken(token, {
        OPENWEIGHT_HARNESS_BASE_URL: baseUrl,
      });
      const matrix = encodeQr(pairingUrl, { ecc: "M" });
      const qrRendered = renderToAnsi(matrix);

      const expected =
        qrRendered +
        "\n\n" +
        baseUrl +
        "\n\n" +
        "Scan this QR code with your phone to pair this machine.\n";

      expect(result).toBe(expected);
    });

    // Test (b): showUrl: false should equal the default
    it("should produce identical output when showUrl is false vs when showUrl is undefined", () => {
      const token = "test-token-43-chars-exactly-here!!";
      const baseUrl = "https://example.com";

      const resultWithoutFlag = renderPairing({
        token,
        baseUrl,
      });

      const resultWithFalseFlag = renderPairing({
        token,
        baseUrl,
        showUrl: false,
      });

      expect(resultWithoutFlag).toBe(resultWithFalseFlag);
    });

    // Test (c): showUrl: true should emit the URL
    it("should include the pairing URL when showUrl is true", () => {
      const token = "test-token-43-chars-exactly-here!!";
      const baseUrl = "https://example.com";

      const result = renderPairing({
        token,
        baseUrl,
        showUrl: true,
      });

      const expectedUrl = pairingUrlWithToken(token, {
        OPENWEIGHT_HARNESS_BASE_URL: baseUrl,
      });

      expect(result).toContain(expectedUrl);
    });

    // Test (d): parsePairArgs tests
    it("parsePairArgs should return { showUrl: false } for empty arguments", () => {
      const result = parsePairArgs([]);
      expect(result).toEqual({ showUrl: false });
    });

    it("parsePairArgs should return { showUrl: true } for --show-url", () => {
      const result = parsePairArgs(["--show-url"]);
      expect(result).toEqual({ showUrl: true });
    });

    it("parsePairArgs should throw for unknown argument --nope", () => {
      expect(() => {
        parsePairArgs(["--nope"]);
      }).toThrow();

      try {
        parsePairArgs(["--nope"]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("--nope");
      }
    });

    it("parsePairArgs should throw for near-miss spelling --show-urls", () => {
      expect(() => {
        parsePairArgs(["--show-urls"]);
      }).toThrow();
    });

    // Test (e): End-to-end through the real CLI entry point
    it("should not print token by default when run as subprocess", () => {
      const tempDir = mkdtempSync(join("/tmp", "pair-test-e2e-default-"));
      const tokenPath = join(tempDir, "token");
      const fixtureToken = "A".repeat(43);
      const fixtureBaseUrl = "https://example.com";

      writeFileSync(tokenPath, fixtureToken);
      chmodSync(tokenPath, 0o600);

      try {
        const result = spawnSync("bun", ["run", "src/host/pair.ts"], {
          cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
          env: {
            ...process.env,
            OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath,
            OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
          },
          encoding: "utf-8",
        });

        expect(result.status).toBe(0);
        const stdout = result.stdout || "";

        // Should not contain the token
        expect(stdout).not.toContain(fixtureToken);

        // Should not contain any 8-character window of the token
        for (let i = 0; i <= fixtureToken.length - 8; i++) {
          const window = fixtureToken.slice(i, i + 8);
          expect(stdout).not.toContain(window);
        }

        // Should not contain percent-encoded token
        const encoded = encodeURIComponent(fixtureToken);
        expect(stdout).not.toContain(encoded);

        // Should not contain the pairing URL
        const pairingUrl = pairingUrlWithToken(fixtureToken, {
          OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
        });
        expect(stdout).not.toContain(pairingUrl);
      } finally {
        chmodSync(tokenPath, 0o600);
        rmSync(tempDir, { recursive: true });
      }
    });

    it("should print pairing URL when run with --show-url", () => {
      const tempDir = mkdtempSync(join("/tmp", "pair-test-e2e-showurl-"));
      const tokenPath = join(tempDir, "token");
      const fixtureToken = "test-token-43-chars-exactly-here!!";
      const fixtureBaseUrl = "https://example.com";

      writeFileSync(tokenPath, fixtureToken);
      chmodSync(tokenPath, 0o600);

      try {
        const result = spawnSync("bun", ["run", "src/host/pair.ts", "--show-url"], {
          cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
          env: {
            ...process.env,
            OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath,
            OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
          },
          encoding: "utf-8",
        });

        expect(result.status).toBe(0);
        const stdout = result.stdout || "";

        const pairingUrl = pairingUrlWithToken(fixtureToken, {
          OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
        });

        expect(stdout).toContain(pairingUrl);
      } finally {
        chmodSync(tokenPath, 0o600);
        rmSync(tempDir, { recursive: true });
      }
    });

    it("should exit with non-zero and report error for unknown argument", () => {
      const tempDir = mkdtempSync(join("/tmp", "pair-test-e2e-error-"));
      const tokenPath = join(tempDir, "token");
      const fixtureToken = "test-token-43-chars-exactly-here!!";
      const fixtureBaseUrl = "https://example.com";

      writeFileSync(tokenPath, fixtureToken);
      chmodSync(tokenPath, 0o600);

      try {
        const result = spawnSync("bun", ["run", "src/host/pair.ts", "--bogus"], {
          cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
          env: {
            ...process.env,
            OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath,
            OPENWEIGHT_HARNESS_BASE_URL: fixtureBaseUrl,
          },
          encoding: "utf-8",
        });

        expect(result.status).not.toBe(0);
        const stderr = result.stderr || "";
        const stdout = result.stdout || "";

        // stderr should name the offending argument
        expect(stderr).toContain("--bogus");

        // Neither stdout nor stderr should contain the token
        expect(stdout).not.toContain(fixtureToken);
        expect(stderr).not.toContain(fixtureToken);
      } finally {
        chmodSync(tokenPath, 0o600);
        rmSync(tempDir, { recursive: true });
      }
    });
  });
});
