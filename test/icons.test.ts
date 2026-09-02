import { describe, it, expect } from "bun:test";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { inflateSync } from "zlib";
import { generateIcons } from "../scripts/generate-icons";

describe("icons", () => {
	const iconConfigs = [
		{ filename: "icon-192.png", width: 192, height: 192 },
		{ filename: "icon-512.png", width: 512, height: 512 },
		{ filename: "apple-touch-icon-180.png", width: 180, height: 180 },
	];

	function computeCrc32(data: Uint8Array): number {
		const poly = 0xedb88320;
		const crcTable = new Array<number>(256);
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let j = 0; j < 8; j++) {
				c = (c & 1) ? poly ^ (c >>> 1) : c >>> 1;
			}
			crcTable[i] = c >>> 0;
		}

		let crc = 0xffffffff;
		for (let i = 0; i < data.length; i++) {
			const byte = data[i];
			if (byte === undefined) {
				throw new Error("Unexpected undefined byte in data");
			}
			const tableEntry = crcTable[(crc ^ byte) & 0xff];
			if (tableEntry === undefined) {
				throw new Error("CRC table entry is undefined");
			}
			crc = tableEntry ^ (crc >>> 8);
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	it("should generate valid PNG icons", async () => {
		const tmpDir = `/tmp/test-icons-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			const result = await generateIcons({ root: tmpDir });
			const iconsDir = join(result.outdir, "web/public/icons");

			// Test each icon
			for (const config of iconConfigs) {
				const filePath = join(iconsDir, config.filename);
				const data = readFileSync(filePath);

				// Assert file exists and is larger than 100 bytes
				expect(data.length).toBeGreaterThan(100);

				// Parse PNG header
				const view = new DataView(data.buffer, data.byteOffset, data.length);

				// Validate 8-byte signature
				const sig = new Uint8Array(data.buffer, data.byteOffset, 8);
				expect(sig[0]).toBe(0x89);
				expect(sig[1]).toBe(0x50);
				expect(sig[2]).toBe(0x4e);
				expect(sig[3]).toBe(0x47);
				expect(sig[4]).toBe(0x0d);
				expect(sig[5]).toBe(0x0a);
				expect(sig[6]).toBe(0x1a);
				expect(sig[7]).toBe(0x0a);

				// Parse chunks
				let offset = 8;
				let foundIDAT = false;
				let foundIEND = false;
				const idatDataArray: Uint8Array[] = [];

				while (offset < data.length) {
					if (offset + 8 > data.length) {
						throw new Error("Unexpected EOF while reading chunk length");
					}

					// Read chunk length (big-endian)
					const length = view.getUint32(offset, false);
					offset += 4;

					if (offset + 4 + length > data.length) {
						throw new Error("Chunk extends beyond file");
					}

					// Read chunk type (4 bytes)
					const typeBytes = new Uint8Array(
						data.buffer,
						data.byteOffset + offset,
						4
					);
					const chunkType = String.fromCharCode(
						typeBytes[0] ?? 0,
						typeBytes[1] ?? 0,
						typeBytes[2] ?? 0,
						typeBytes[3] ?? 0
					);
					offset += 4;

					// Read chunk data
					const chunkData = new Uint8Array(
						data.buffer,
						data.byteOffset + offset,
						length
					);
					offset += length;

					// Read and verify CRC32
					if (offset + 4 > data.length) {
						throw new Error("Unexpected EOF while reading chunk CRC");
					}
					const storedCrc = view.getUint32(offset, false);
					offset += 4;

					// Compute CRC over chunk type + data
					const crcData = new Uint8Array(4 + length);
					for (let i = 0; i < 4; i++) {
						const byte = typeBytes[i];
						if (byte === undefined) {
							throw new Error("Unexpected undefined byte in type");
						}
						crcData[i] = byte;
					}
					for (let i = 0; i < length; i++) {
						const byte = chunkData[i];
						if (byte === undefined) {
							throw new Error("Unexpected undefined byte in chunk data");
						}
						crcData[4 + i] = byte;
					}
					const computedCrc = computeCrc32(crcData);

					expect(storedCrc).toBe(computedCrc);

					// Handle IHDR chunk
					if (chunkType === "IHDR") {
						expect(length).toBe(13);
						const ihdrView = new DataView(
							chunkData.buffer,
							chunkData.byteOffset,
							13
						);
						const width = ihdrView.getUint32(0, false);
						const height = ihdrView.getUint32(4, false);
						const bitDepth = chunkData[8];
						const colorType = chunkData[9];
						const compressionMethod = chunkData[10];
						const filterMethod = chunkData[11];
						const interlaceMethod = chunkData[12];

						expect(width).toBe(config.width);
						expect(height).toBe(config.height);
						expect(bitDepth).toBe(8);
						expect(colorType).toBe(2); // RGB
						expect(compressionMethod).toBe(0); // deflate
						expect(filterMethod).toBe(0);
						expect(interlaceMethod).toBe(0); // no interlace
					}

					// Collect IDAT data
					if (chunkType === "IDAT") {
						foundIDAT = true;
						idatDataArray.push(chunkData);
					}

					// Check for IEND
					if (chunkType === "IEND") {
						foundIEND = true;
						expect(length).toBe(0);
					}
				}

					// Verify we found at least one IDAT and that IEND is last
					expect(foundIDAT).toBe(true);
					expect(foundIEND).toBe(true);

					// Verify IDAT decompression
					const idatBuffer = new Uint8Array(
						idatDataArray.reduce((sum, data) => sum + data.length, 0)
					);
					let pos = 0;
					for (const chunk of idatDataArray) {
						for (let i = 0; i < chunk.length; i++) {
							const byte = chunk[i];
							if (byte === undefined) {
								throw new Error("Unexpected undefined byte in IDAT");
							}
							idatBuffer[pos++] = byte;
						}
					}

					const decompressed = inflateSync(idatBuffer);
					const expectedSize = config.height * (1 + config.width * 3);
					expect(decompressed.length).toBe(expectedSize);
			}
		} finally {
			// Cleanup
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should generate deterministic icons", async () => {
		// Generate to first temp directory
		const tmpDir1 = `/tmp/test-icons-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir1, { recursive: true });

		try {
			const result1 = await generateIcons({ root: tmpDir1 });
			const tempIconsDir1 = join(tmpDir1, "web/public/icons");

			// Generate again to second temp directory
			const tmpDir2 = `/tmp/test-icons-${Date.now()}-${Math.random()}-2`;
			mkdirSync(tmpDir2, { recursive: true });

			try {
				const result2 = await generateIcons({ root: tmpDir2 });
				const tempIconsDir2 = join(tmpDir2, "web/public/icons");

				// Compare all icons between two generations
				for (const config of iconConfigs) {
					const file1 = readFileSync(join(tempIconsDir1, config.filename));
					const file2 = readFileSync(join(tempIconsDir2, config.filename));
					expect(file1.equals(file2)).toBe(true);
				}
			} finally {
				// Cleanup second temp dir
				if (existsSync(tmpDir2)) {
					rmSync(tmpDir2, { recursive: true, force: true });
				}
			}
		} finally {
			// Cleanup first temp dir
			if (existsSync(tmpDir1)) {
				rmSync(tmpDir1, { recursive: true, force: true });
			}
		}
	});

	it("should match checked-in icons with generated ones", async () => {
		// Generate icons to temp directory
		const tmpDir = `/tmp/test-icons-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			const result = await generateIcons({ root: tmpDir });
			const tempIconsDir = join(tmpDir, "web/public/icons");
			const checkedInIconsDir = resolve(__dirname, "..", "web/public/icons");

			// Compare each icon
			for (const config of iconConfigs) {
				const checkedInFile = readFileSync(
					join(checkedInIconsDir, config.filename)
				);
				const generatedFile = readFileSync(
					join(tempIconsDir, config.filename)
				);
				expect(generatedFile.equals(checkedInFile)).toBe(true);
			}
		} finally {
			// Cleanup
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});
});
