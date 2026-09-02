import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { build } from "../scripts/build.ts";
import { readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

describe("build", () => {
	const distDir = join(import.meta.dir, "..", "web", "dist");

	// Clean up before each test
	beforeEach(() => {
		if (existsSync(distDir)) {
			rmSync(distDir, { recursive: true, force: true });
		}
	});

	// Clean up after tests
	afterEach(() => {
		if (existsSync(distDir)) {
			rmSync(distDir, { recursive: true, force: true });
		}
	});

	it("should copy index.html from web/public to web/dist", async () => {
		const result = await build();

		expect(existsSync(join(distDir, "index.html"))).toBe(true);

		const publicHtml = readFileSync(
			join(import.meta.dir, "..", "web", "public", "index.html"),
			"utf-8"
		);
		const distHtml = readFileSync(
			join(distDir, "index.html"),
			"utf-8"
		);

		expect(distHtml).toBe(publicHtml);
	});

	it("should bundle main.ts to main.js", async () => {
		const result = await build();

		expect(existsSync(join(distDir, "main.js"))).toBe(true);

		const mainJs = readFileSync(
			join(distDir, "main.js"),
			"utf-8"
		);

		// Should be non-empty
		expect(mainJs.length).toBeGreaterThan(0);
		// Should be valid JavaScript (not TypeScript)
		expect(mainJs).not.toContain("interface");
	});

	it("should return files array containing index.html and main.js", async () => {
		const result = await build();

		expect(result.files).toContain("index.html");
		expect(result.files).toContain("main.js");
	});

	it("should return outdir", async () => {
		const result = await build();

		expect(result.outdir).toBeDefined();
		expect(existsSync(result.outdir)).toBe(true);
	});

	it("should be idempotent - calling build twice should succeed and produce same files", async () => {
		const result1 = await build();
		const files1 = result1.files.sort();

		const result2 = await build();
		const files2 = result2.files.sort();

		expect(files1).toEqual(files2);
	});

	it("should build sw.ts to sw.js as a classic (non-module) script", async () => {
		const result = await build();

		expect(result.files).toContain("sw.js");
		expect(existsSync(join(distDir, "sw.js"))).toBe(true);

		const swJs = readFileSync(
			join(distDir, "sw.js"),
			"utf-8"
		);

		// Should be non-empty
		expect(swJs.length).toBeGreaterThan(0);
		// Should be an IIFE (classic script), not an ES module
		// IIFE starts with (() =>
		expect(swJs.startsWith("(() =>")).toBe(true);
		// Should NOT have "export default" or top-level "export " (ES6 module syntax)
		expect(/^\s*export\s+(default|const|function|class)/.test(swJs)).toBe(false);
	});

	it("should honour safe-area insets in source index.html for iOS viewport-fit=cover", () => {
		const publicHtml = readFileSync(
			join(import.meta.dir, "..", "web", "public", "index.html"),
			"utf-8"
		);

		// Extract the CSS from the <style> tag
		const styleMatch = publicHtml.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).toBeTruthy();
		const css = styleMatch![1];

		// Verify all four safe-area insets are present
		expect(css).toContain("env(safe-area-inset-top)");
		expect(css).toContain("env(safe-area-inset-right)");
		expect(css).toContain("env(safe-area-inset-bottom)");
		expect(css).toContain("env(safe-area-inset-left)");

		// Verify each is combined with a non-zero floor (max() with 1rem or greater)
		expect(css).toMatch(/padding-top:\s*max\([^,]+,\s*env\(safe-area-inset-top\)\)/);
		expect(css).toMatch(/padding-right:\s*max\([^,]+,\s*env\(safe-area-inset-right\)\)/);
		expect(css).toMatch(/padding-bottom:\s*max\([^,]+,\s*env\(safe-area-inset-bottom\)\)/);
		expect(css).toMatch(/padding-left:\s*max\([^,]+,\s*env\(safe-area-inset-left\)\)/);
	});

	it("should carry safe-area insets in built index.html", async () => {
		const result = await build();

		const distHtml = readFileSync(
			join(distDir, "index.html"),
			"utf-8"
		);

		// Extract the CSS from the <style> tag
		const styleMatch = distHtml.match(/<style>([\s\S]*?)<\/style>/);
		expect(styleMatch).toBeTruthy();
		const css = styleMatch![1];

		// Verify all four safe-area insets are present
		expect(css).toContain("env(safe-area-inset-top)");
		expect(css).toContain("env(safe-area-inset-right)");
		expect(css).toContain("env(safe-area-inset-bottom)");
		expect(css).toContain("env(safe-area-inset-left)");

		// Verify each is combined with a non-zero floor (max() with 1rem or greater)
		expect(css).toMatch(/padding-top:\s*max\([^,]+,\s*env\(safe-area-inset-top\)\)/);
		expect(css).toMatch(/padding-right:\s*max\([^,]+,\s*env\(safe-area-inset-right\)\)/);
		expect(css).toMatch(/padding-bottom:\s*max\([^,]+,\s*env\(safe-area-inset-bottom\)\)/);
		expect(css).toMatch(/padding-left:\s*max\([^,]+,\s*env\(safe-area-inset-left\)\)/);
	});
});
