import { rmSync, mkdirSync, readdirSync, copyFileSync, statSync, existsSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

export async function build(options?: { root?: string }): Promise<{
	outdir: string;
	files: string[];
}> {
	// Resolve root from import.meta.url, one directory up from this script
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const root = options?.root ?? dirname(scriptDir);

	const dist = resolve(root, "web", "dist");

	// Guard against removing the wrong directory
	if (!dist.endsWith("web/dist")) {
		throw new Error(`Refusing to remove directory not ending in "web/dist": ${dist}`);
	}

	// Remove web/dist if it exists
	if (existsSync(dist)) {
		rmSync(dist, { recursive: true, force: true });
	}

	// Recreate web/dist
	mkdirSync(dist, { recursive: true });

	// Copy everything from web/public to web/dist
	const publicDir = resolve(root, "web", "public");
	const files: Set<string> = new Set();

	function copyDir(src: string, dest: string) {
		mkdirSync(dest, { recursive: true });

		const entries = readdirSync(src);
		for (const entry of entries) {
			const srcPath = join(src, entry);
			const destPath = join(dest, entry);
			const stat = statSync(srcPath);

			if (stat.isDirectory()) {
				copyDir(srcPath, destPath);
			} else {
				copyFileSync(srcPath, destPath);
				// Track relative paths from dist root
				const relPath = relative(dist, destPath);
				files.add(relPath);
			}
		}
	}

	copyDir(publicDir, dist);

	// Run Bun.build
	const result = await Bun.build({
		entrypoints: [resolve(root, "web", "src", "main.ts")],
		outdir: dist,
		target: "browser",
		format: "esm",
		naming: "[name].js",
		minify: false,
		sourcemap: "none",
	});

	if (!result.success) {
		throw new Error(`Bun.build failed:\n${result.logs.join("\n")}`);
	}

	// Track main.js as written file
	files.add("main.js");

	// Build the service worker as a classic (non-module) IIFE script
	const swResult = await Bun.build({
		entrypoints: [resolve(root, "web", "src", "sw.ts")],
		outdir: dist,
		target: "browser",
		format: "iife",
		naming: "[name].js",
		minify: false,
		sourcemap: "none",
	});

	if (!swResult.success) {
		throw new Error(`Bun.build (sw.ts) failed:\n${swResult.logs.join("\n")}`);
	}

	// Track sw.js as written file
	files.add("sw.js");

	return {
		outdir: dist,
		files: Array.from(files).sort(),
	};
}

// Run build if this is the entry point
if (import.meta.main) {
	try {
		const result = await build();
		console.log("Built files:");
		for (const file of result.files) {
			console.log(`  ${file}`);
		}
		process.exit(0);
	} catch (error) {
		console.error("Build failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
