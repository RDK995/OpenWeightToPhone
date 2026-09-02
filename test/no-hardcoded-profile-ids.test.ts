import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

describe("no-hardcoded-profile-ids", () => {
	const profileIds = ["reasoning-baseline", "reasoning-capable", "reasoning-deep"];
	const rootDir = join(import.meta.dir, "..");
	const sourceDirs = ["web/src", "src", "scripts"];

	function getAllTypescriptFiles(basePath: string): string[] {
		const files: string[] = [];

		function traverse(dir: string) {
			try {
				const entries = readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const fullPath = join(dir, entry.name);
					if (entry.isDirectory()) {
						traverse(fullPath);
					} else if (entry.isFile() && entry.name.endsWith(".ts")) {
						files.push(fullPath);
					}
				}
			} catch (error) {
				// Directory may not exist, skip it
			}
		}

		traverse(basePath);
		return files;
	}

	it("should not contain hardcoded profile ids in source files", () => {
		const allFiles: string[] = [];

		for (const sourceDir of sourceDirs) {
			const dirPath = join(rootDir, sourceDir);
			const files = getAllTypescriptFiles(dirPath);
			allFiles.push(...files);
		}

		// Assert that we actually scanned files - at least 8
		expect(allFiles.length).toBeGreaterThanOrEqual(8);

		// Check each file for hardcoded profile ids
		for (const filePath of allFiles) {
			const content = readFileSync(filePath, "utf-8");

			for (const profileId of profileIds) {
				if (content.includes(profileId)) {
					throw new Error(
						`Found hardcoded profile id "${profileId}" in ${filePath}`
					);
				}
			}
		}
	});
});
