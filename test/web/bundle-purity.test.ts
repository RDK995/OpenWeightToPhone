import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { build } from "../../scripts/build.ts";
import { readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

describe("bundle-purity", () => {
	const distDir = join(import.meta.dir, "..", "..", "web", "dist");

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

	it("should not bundle happy-dom into main.js", async () => {
		await build();

		const mainJs = readFileSync(
			join(distDir, "main.js"),
			"utf-8"
		);

		// Should not contain happy-dom (case insensitive)
		expect(mainJs.toLowerCase()).not.toContain("happy-dom");
		expect(mainJs).not.toContain("HappyDOM");
	});

	it("should not bundle happy-dom into sw.js", async () => {
		await build();

		const swJs = readFileSync(
			join(distDir, "sw.js"),
			"utf-8"
		);

		// Should not contain happy-dom (case insensitive)
		expect(swJs.toLowerCase()).not.toContain("happy-dom");
		expect(swJs).not.toContain("HappyDOM");
	});

	it("should have happy-dom only as devDependency, not in dependencies", async () => {
		const packageJson = JSON.parse(
			readFileSync(
				join(import.meta.dir, "..", "..", "package.json"),
				"utf-8"
			)
		);

		// happy-dom should not be in dependencies
		const hasDependencies = "dependencies" in packageJson;
		if (hasDependencies) {
			expect(packageJson.dependencies).not.toHaveProperty("happy-dom");
		}

		// happy-dom should be in devDependencies
		expect(packageJson.devDependencies).toHaveProperty("happy-dom");
	});
});
