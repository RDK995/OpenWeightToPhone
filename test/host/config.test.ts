import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  APP_MOUNT_PATH,
  DEFAULT_PWA_PORT,
  resolvePwaPort,
  resolveBaseUrl,
  resolveTokenPath,
  resolveBundleRoot,
  pairingUrl,
  pairingUrlWithToken,
  readToken,
} from "../../src/host/config";
import { join } from "node:path";
import {
  writeFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";

describe("config", () => {
  describe("constants", () => {
    it("APP_MOUNT_PATH is /app", () => {
      expect(APP_MOUNT_PATH).toBe("/app");
    });

    it("DEFAULT_PWA_PORT is 7788", () => {
      expect(DEFAULT_PWA_PORT).toBe(7788);
    });
  });

  describe("resolvePwaPort", () => {
    it("returns DEFAULT_PWA_PORT when PHONE_PWA_PORT is unset", () => {
      const result = resolvePwaPort({});
      expect(result).toBe(DEFAULT_PWA_PORT);
    });

    it("returns DEFAULT_PWA_PORT when PHONE_PWA_PORT is empty", () => {
      const result = resolvePwaPort({ PHONE_PWA_PORT: "" });
      expect(result).toBe(DEFAULT_PWA_PORT);
    });

    it("parses PHONE_PWA_PORT as base-10 integer", () => {
      const result = resolvePwaPort({ PHONE_PWA_PORT: "8080" });
      expect(result).toBe(8080);
    });

    it("throws on non-integer PHONE_PWA_PORT", () => {
      expect(() => {
        resolvePwaPort({ PHONE_PWA_PORT: "abc" });
      }).toThrow();
      const error = expect(() => {
        resolvePwaPort({ PHONE_PWA_PORT: "abc" });
      }).toThrow();
      try {
        resolvePwaPort({ PHONE_PWA_PORT: "abc" });
      } catch (e: any) {
        expect(e.message).toContain("PHONE_PWA_PORT");
      }
    });

    it("throws on PHONE_PWA_PORT < 1", () => {
      expect(() => {
        resolvePwaPort({ PHONE_PWA_PORT: "0" });
      }).toThrow();
      try {
        resolvePwaPort({ PHONE_PWA_PORT: "0" });
      } catch (e: any) {
        expect(e.message).toContain("PHONE_PWA_PORT");
      }
    });

    it("throws on PHONE_PWA_PORT > 65535", () => {
      expect(() => {
        resolvePwaPort({ PHONE_PWA_PORT: "70000" });
      }).toThrow();
      try {
        resolvePwaPort({ PHONE_PWA_PORT: "70000" });
      } catch (e: any) {
        expect(e.message).toContain("PHONE_PWA_PORT");
      }
    });

    it("throws on decimal PHONE_PWA_PORT", () => {
      expect(() => {
        resolvePwaPort({ PHONE_PWA_PORT: "12.5" });
      }).toThrow();
      try {
        resolvePwaPort({ PHONE_PWA_PORT: "12.5" });
      } catch (e: any) {
        expect(e.message).toContain("PHONE_PWA_PORT");
      }
    });
  });

  describe("resolveBaseUrl", () => {
    it("returns default when OPENWEIGHT_HARNESS_BASE_URL is unset", () => {
      const result = resolveBaseUrl({});
      expect(result).toBe("https://ryans-mac-studio.tailc3648a.ts.net");
    });

    it("returns default when OPENWEIGHT_HARNESS_BASE_URL is empty", () => {
      const result = resolveBaseUrl({ OPENWEIGHT_HARNESS_BASE_URL: "" });
      expect(result).toBe("https://ryans-mac-studio.tailc3648a.ts.net");
    });

    it("uses OPENWEIGHT_HARNESS_BASE_URL when set", () => {
      const result = resolveBaseUrl({
        OPENWEIGHT_HARNESS_BASE_URL: "https://example.com",
      });
      expect(result).toBe("https://example.com");
    });

    it("strips trailing slash from OPENWEIGHT_HARNESS_BASE_URL", () => {
      const result = resolveBaseUrl({
        OPENWEIGHT_HARNESS_BASE_URL: "https://example.com/",
      });
      expect(result).toBe("https://example.com");
    });

    it("strips multiple trailing slashes from OPENWEIGHT_HARNESS_BASE_URL", () => {
      const result = resolveBaseUrl({
        OPENWEIGHT_HARNESS_BASE_URL: "https://example.com///",
      });
      expect(result).toBe("https://example.com");
    });
  });

  describe("resolveTokenPath", () => {
    it("returns path ending with .openweight-harness/token by default", () => {
      const result = resolveTokenPath({});
      expect(result).toMatch(/\.openweight-harness[/\\]token$/);
    });

    it("returns path in home directory by default", () => {
      const result = resolveTokenPath({});
      expect(result).toContain(homedir());
    });

    it("uses OPENWEIGHT_HARNESS_TOKEN_FILE when set", () => {
      const result = resolveTokenPath({
        OPENWEIGHT_HARNESS_TOKEN_FILE: "/custom/token/path",
      });
      expect(result).toBe("/custom/token/path");
    });

    it("ignores OPENWEIGHT_HARNESS_TOKEN_FILE when empty", () => {
      const result = resolveTokenPath({
        OPENWEIGHT_HARNESS_TOKEN_FILE: "",
      });
      expect(result).toMatch(/\.openweight-harness[/\\]token$/);
    });
  });

  describe("resolveBundleRoot", () => {
    it("returns absolute path ending with web/dist by default", () => {
      const result = resolveBundleRoot({});
      expect(result).toMatch(/web[/\\]dist$/);
    });

    it("returns absolute path by default", () => {
      const result = resolveBundleRoot({});
      expect(result.startsWith("/")).toBe(true);
    });

    it("uses PHONE_PWA_BUNDLE_ROOT when set", () => {
      const result = resolveBundleRoot({
        PHONE_PWA_BUNDLE_ROOT: "/custom/bundle",
      });
      expect(result).toBe("/custom/bundle");
    });

    it("ignores PHONE_PWA_BUNDLE_ROOT when empty", () => {
      const result = resolveBundleRoot({
        PHONE_PWA_BUNDLE_ROOT: "",
      });
      expect(result).toMatch(/web[/\\]dist$/);
    });
  });

  describe("pairingUrl", () => {
    it("returns URL ending with /app/", () => {
      const result = pairingUrl({});
      expect(result).toMatch(/\/app\/$/);
    });

    it("contains base URL", () => {
      const result = pairingUrl({});
      expect(result).toContain("https://ryans-mac-studio.tailc3648a.ts.net");
    });

    it("does not contain hash character", () => {
      const result = pairingUrl({});
      expect(result).not.toContain("#");
    });

    it("combines custom base URL with /app/", () => {
      const result = pairingUrl({
        OPENWEIGHT_HARNESS_BASE_URL: "https://custom.example.com/",
      });
      expect(result).toBe("https://custom.example.com/app/");
    });
  });

  describe("pairingUrlWithToken", () => {
    it("returns URL with token in fragment with plain token", () => {
      const result = pairingUrlWithToken("my-test-token", {});
      expect(result).toBe(
        "https://ryans-mac-studio.tailc3648a.ts.net/app/#t=my-test-token"
      );
    });

    it("returns URL ending with /#t=...", () => {
      const result = pairingUrlWithToken("token123", {});
      expect(result).toMatch(/#t=token123$/);
    });

    it("contains base URL", () => {
      const result = pairingUrlWithToken("token123", {});
      expect(result).toContain("https://ryans-mac-studio.tailc3648a.ts.net");
    });

    it("honors custom OPENWEIGHT_HARNESS_BASE_URL", () => {
      const result = pairingUrlWithToken("token123", {
        OPENWEIGHT_HARNESS_BASE_URL: "https://custom.example.com",
      });
      expect(result).toBe("https://custom.example.com/app/#t=token123");
    });

    it("honors custom OPENWEIGHT_HARNESS_BASE_URL with trailing slash", () => {
      const result = pairingUrlWithToken("token123", {
        OPENWEIGHT_HARNESS_BASE_URL: "https://custom.example.com/",
      });
      expect(result).toBe("https://custom.example.com/app/#t=token123");
    });

    it("percent-encodes token with special characters", () => {
      const specialToken = "token#with&special/chars+=";
      const result = pairingUrlWithToken(specialToken, {});
      expect(result).toContain(encodeURIComponent(specialToken));
    });

    it("token with special characters round-trips through decodeURIComponent", () => {
      const specialToken = "token#with&special/chars+=";
      const result = pairingUrlWithToken(specialToken, {});
      // Extract the fragment part after #t=
      const fragmentMatch = result.match(/#t=(.+)$/);
      expect(fragmentMatch).not.toBeNull();
      if (fragmentMatch && fragmentMatch[1] !== undefined) {
        const encodedToken = fragmentMatch[1];
        const decodedToken = decodeURIComponent(encodedToken);
        expect(decodedToken).toBe(specialToken);
      }
    });

    it("throws on empty token", () => {
      expect(() => {
        pairingUrlWithToken("", {});
      }).toThrow();
    });

    it("throws on whitespace-only token", () => {
      expect(() => {
        pairingUrlWithToken("   ", {});
      }).toThrow();

      expect(() => {
        pairingUrlWithToken("\n\t  ", {});
      }).toThrow();
    });

    it("throws on empty token with error message", () => {
      try {
        pairingUrlWithToken("", {});
        expect(false).toBe(true); // Should not reach here
      } catch (e: any) {
        expect(e.message).toContain("Token");
      }
    });
  });

  describe("readToken", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "cfg-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns trimmed token from file with mode 0o600", () => {
      const tokenPath = join(tempDir, "token");
      const tokenContent = "my-test-token";
      writeFileSync(tokenPath, tokenContent);
      chmodSync(tokenPath, 0o600);

      const result = readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      expect(result).toBe(tokenContent);
    });

    it("returns trimmed token when file has leading/trailing whitespace", () => {
      const tokenPath = join(tempDir, "token");
      const tokenContent = "  \n  my-test-token  \n  ";
      writeFileSync(tokenPath, tokenContent);
      chmodSync(tokenPath, 0o600);

      const result = readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      expect(result).toBe("my-test-token");
    });

    it("throws when file has mode 0o644 (world-readable)", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "token-value");
      chmodSync(tokenPath, 0o644);

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();

      try {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      } catch (e: any) {
        expect(e.message).toContain(tokenPath);
      }
    });

    it("throws when file has mode 0o640 (group-readable)", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "token-value");
      chmodSync(tokenPath, 0o640);

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();

      try {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      } catch (e: any) {
        expect(e.message).toContain(tokenPath);
      }
    });

    it("throws when file has mode 0o604 (other-readable)", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "token-value");
      chmodSync(tokenPath, 0o604);

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();

      try {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      } catch (e: any) {
        expect(e.message).toContain(tokenPath);
      }
    });

    it("throws when token file is empty", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "");
      chmodSync(tokenPath, 0o600);

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();

      try {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      } catch (e: any) {
        expect(e.message).toContain(tokenPath);
      }
    });

    it("throws when token file is whitespace-only", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "   \n  \t  \n   ");
      chmodSync(tokenPath, 0o600);

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();

      try {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      } catch (e: any) {
        expect(e.message).toContain(tokenPath);
      }
    });

    it("propagates missing file error from statSync", () => {
      const tokenPath = join(tempDir, "nonexistent");

      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();
    });

    it("does not read file contents when permissions are wrong (stat -> check -> read order)", () => {
      const tokenPath = join(tempDir, "token");
      writeFileSync(tokenPath, "should-not-be-read");
      chmodSync(tokenPath, 0o644);

      // The test passes if the function throws before attempting to read
      // We can't directly verify that readFileSync wasn't called, but the error
      // should be thrown during permission check
      expect(() => {
        readToken({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath });
      }).toThrow();
    });
  });
});
