import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

describe("PWA Manifest", () => {
  const manifestPath = "web/public/app.webmanifest";
  const indexPath = "web/public/index.html";

  describe("Manifest file", () => {
    it("reads and parses manifest JSON successfully", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      expect(manifest).toBeDefined();
    });

    it("has display set to standalone", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      expect(manifest.display).toBe("standalone");
    });

    it("has start_url starting with /app/", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      expect(typeof manifest.start_url).toBe("string");
      expect(manifest.start_url.startsWith("/app/")).toBe(true);
    });

    it("has scope starting with /app/", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      expect(typeof manifest.scope).toBe("string");
      expect(manifest.scope.startsWith("/app/")).toBe(true);
    });

    it("has icons as non-empty array with required properties", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length > 0).toBe(true);

      for (const icon of manifest.icons) {
        expect(icon.src).toBeDefined();
        expect(icon.sizes).toBeDefined();
        expect(icon.type).toBeDefined();
        expect(typeof icon.type).toBe("string");
        expect(icon.type.startsWith("image/")).toBe(true);
      }
    });

    it("has all icon files existing on disk and non-empty", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);

      for (const icon of manifest.icons) {
        // Convert /app/<rest> to web/public/<rest>
        const src = icon.src as string;
        if (!src.startsWith("/app/")) {
          throw new Error(`Icon src does not start with /app/: ${src}`);
        }
        const rest = src.substring("/app/".length);
        const filePath = join("web/public", rest);

        expect(existsSync(filePath)).toBe(true);
        const stat = statSync(filePath);
        expect(stat.size > 0).toBe(true);
      }
    });

    it("has icon pixel dimensions matching PNG IHDR", () => {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);

      for (const icon of manifest.icons) {
        const src = icon.src as string;
        const rest = src.substring("/app/".length);
        const filePath = join("web/public", rest);

        // Read PNG IHDR chunk to get width and height
        const buffer = readFileSync(filePath);

        // PNG signature is 8 bytes, then IHDR chunk
        // Width is at bytes 16-19, height is at bytes 20-23 (big-endian)
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);

        const expectedSizes = `${width}x${height}`;
        expect(icon.sizes).toBe(expectedSizes);
      }
    });
  });

  describe("Index HTML", () => {
    it("contains manifest link with correct href", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).toContain('rel="manifest"');
      expect(htmlContent).toContain('href="/app/app.webmanifest"');
    });

    it("contains apple-touch-icon link", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).toContain('rel="apple-touch-icon"');
      expect(htmlContent).toContain('sizes="180x180"');
      expect(htmlContent).toContain('href="/app/icons/apple-touch-icon-180.png"');
    });

    it("contains apple-mobile-web-app-capable meta with content yes", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).toContain('name="apple-mobile-web-app-capable"');
      expect(htmlContent).toContain('content="yes"');
    });

    it("contains mobile-web-app-capable meta with content yes", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).toContain('name="mobile-web-app-capable"');
      expect(htmlContent).toContain('content="yes"');
    });

    it("still contains the main.js script tag", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).toContain('type="module"');
      expect(htmlContent).toContain('src="/app/main.js"');
    });

    it("does not contain any relative ./ paths in href or src attributes", () => {
      const htmlContent = readFileSync(indexPath, "utf-8");
      expect(htmlContent).not.toContain('href="./');
      expect(htmlContent).not.toContain('src="./');
    });
  });
});
