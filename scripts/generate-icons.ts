import { mkdirSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { createPng } from "./png.ts";

export async function generateIcons(options?: {
	root?: string;
}): Promise<{ outdir: string; files: string[] }> {
	// Resolve root from import.meta.url, one directory up from this script
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const root = options?.root ?? dirname(scriptDir);

	const iconsDir = resolve(root, "web", "public", "icons");
	mkdirSync(iconsDir, { recursive: true });

	const icons = [
		{ size: 192, filename: "icon-192.png" },
		{ size: 512, filename: "icon-512.png" },
		{ size: 180, filename: "apple-touch-icon-180.png" },
	];

	const files: string[] = [];

	for (const icon of icons) {
		const pngData = createPng(icon.size, icon.size);
		const filePath = resolve(iconsDir, icon.filename);
		writeFileSync(filePath, pngData);

		// Track relative path from root
		const relPath = relative(root, filePath);
		files.push(relPath);
	}

	return {
		outdir: root,
		files: files.sort(),
	};
}

// Run generateIcons if this is the entry point
if (import.meta.main) {
	try {
		const result = await generateIcons();
		console.log("Generated icon files:");
		for (const file of result.files) {
			console.log(`  ${file}`);
		}
		process.exit(0);
	} catch (error) {
		console.error(
			"Icon generation failed:",
			error instanceof Error ? error.message : error
		);
		process.exit(1);
	}
}
