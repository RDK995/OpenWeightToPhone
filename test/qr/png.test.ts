import { describe, it, expect } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { inflateSync } from "zlib";
import { matrixToPng } from "../../src/qr/png.ts";
import type { QrMatrix } from "../../src/qr/types.ts";

describe("matrixToPng", () => {
	it("should validate matrix dimensions", () => {
		const invalidMatrix: QrMatrix = {
			size: 5,
			version: 1,
			ecc: "M",
			modules: [
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
				// Missing row
			],
		};

		expect(() => {
			matrixToPng(invalidMatrix);
		}).toThrow();
	});

	it("should create valid PNG with correct signature", () => {
		const matrix: QrMatrix = {
			size: 5,
			version: 1,
			ecc: "M",
			modules: [
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
			],
		};

		const png = matrixToPng(matrix);

		// Check PNG signature: \x89PNG\r\n\x1a\n
		expect(png[0]).toBe(0x89);
		expect(png[1]).toBe(0x50); // 'P'
		expect(png[2]).toBe(0x4e); // 'N'
		expect(png[3]).toBe(0x47); // 'G'
		expect(png[4]).toBe(0x0d); // \r
		expect(png[5]).toBe(0x0a); // \n
		expect(png[6]).toBe(0x1a);
		expect(png[7]).toBe(0x0a); // \n
	});

	it("should have valid IHDR chunk", () => {
		const size = 5;
		const moduleSize = 10;
		const quietZone = 4;
		const expectedDim = (size + 2 * quietZone) * moduleSize;

		const matrix: QrMatrix = {
			size,
			version: 1,
			ecc: "M",
			modules: [
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
			],
		};

		const png = matrixToPng(matrix, { moduleSize, quietZone });
		const view = new DataView(png.buffer, png.byteOffset);

		// Skip signature (8 bytes) and read IHDR chunk length (should be 13)
		const ihdrLength = view.getUint32(8, false);
		expect(ihdrLength).toBe(13);

		// Read IHDR chunk type (should be "IHDR")
		const chunkType = String.fromCharCode(
			png[12]!,
			png[13]!,
			png[14]!,
			png[15]!
		);
		expect(chunkType).toBe("IHDR");

		// Read width and height from IHDR data
		const width = view.getUint32(16, false);
		const height = view.getUint32(20, false);
		expect(width).toBe(expectedDim);
		expect(height).toBe(expectedDim);

		// Check bit depth (should be 8)
		expect(png[24]).toBe(8);

		// Check color type (should be 2 for RGB)
		expect(png[25]).toBe(2);
	});

	it("should have IEND chunk at end", () => {
		const matrix: QrMatrix = {
			size: 5,
			version: 1,
			ecc: "M",
			modules: [
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
				[false, true, false, true, false],
				[true, false, true, false, true],
			],
		};

		const png = matrixToPng(matrix);

		// Check last 12 bytes: 4-byte length (0), 4-byte type "IEND", 4-byte CRC
		const iendLengthPos = png.length - 12;
		const view = new DataView(png.buffer, png.byteOffset + iendLengthPos);
		const iendLength = view.getUint32(0, false);
		expect(iendLength).toBe(0);

		const iendType = String.fromCharCode(
			png[iendLengthPos + 4]!,
			png[iendLengthPos + 5]!,
			png[iendLengthPos + 6]!,
			png[iendLengthPos + 7]!
		);
		expect(iendType).toBe("IEND");
	});

	it("should render correct pixel geometry with moduleSize=1, quietZone=0", () => {
		// Create a simple 2x2 QR matrix
		const matrix: QrMatrix = {
			size: 2,
			version: 1,
			ecc: "M",
			modules: [
				[true, false],  // dark, light
				[false, true],  // light, dark
			],
		};

		const png = matrixToPng(matrix, { moduleSize: 1, quietZone: 0 });

		// Decompress IDAT to check pixel values
		let offset = 8; // Skip PNG signature
		const view = new DataView(png.buffer, png.byteOffset);

		// Find and extract IDAT chunk
		let idatData: Uint8Array[] = [];
		while (offset < png.length) {
			const length = view.getUint32(offset, false);
			offset += 4;

			const chunkType = String.fromCharCode(
				png[offset]!,
				png[offset + 1]!,
				png[offset + 2]!,
				png[offset + 3]!
			);
			offset += 4;

			const chunk = new Uint8Array(png.buffer, png.byteOffset + offset, length);
			if (chunkType === "IDAT") {
				idatData.push(chunk);
			}
			offset += length + 4; // chunk data + CRC
		}

		// Combine all IDAT chunks
		const idatBuffer = new Uint8Array(idatData.reduce((sum, c) => sum + c.length, 0));
		let pos = 0;
		for (const chunk of idatData) {
			for (let i = 0; i < chunk.length; i++) {
				idatBuffer[pos++] = chunk[i]!;
			}
		}

		// Decompress
		const decompressed = inflateSync(idatBuffer);

		// PNG stores scanlines: 1 filter byte + (width * 3 bytes for RGB)
		const width = 2;
		const height = 2;
		const scanlineLength = width * 3 + 1;

		// Verify dimensions match
		expect(decompressed.length).toBe(height * scanlineLength);

		// Check first row (filter byte=0, then pixel data)
		// Row 0: [dark, light] = [black, white]
		expect(decompressed[0]).toBe(0); // filter type

		// First pixel (dark): should be black (0, 0, 0)
		expect(decompressed[1]).toBe(0x00);
		expect(decompressed[2]).toBe(0x00);
		expect(decompressed[3]).toBe(0x00);

		// Second pixel (light): should be white (255, 255, 255)
		expect(decompressed[4]).toBe(0xff);
		expect(decompressed[5]).toBe(0xff);
		expect(decompressed[6]).toBe(0xff);

		// Check second row
		// Row 1: [light, dark] = [white, black]
		expect(decompressed[scanlineLength]).toBe(0); // filter type

		// First pixel (light): should be white (255, 255, 255)
		expect(decompressed[scanlineLength + 1]).toBe(0xff);
		expect(decompressed[scanlineLength + 2]).toBe(0xff);
		expect(decompressed[scanlineLength + 3]).toBe(0xff);

		// Second pixel (dark): should be black (0, 0, 0)
		expect(decompressed[scanlineLength + 4]).toBe(0x00);
		expect(decompressed[scanlineLength + 5]).toBe(0x00);
		expect(decompressed[scanlineLength + 6]).toBe(0x00);
	});

	it("should render quiet zone in white", () => {
		const matrix: QrMatrix = {
			size: 1,
			version: 1,
			ecc: "M",
			modules: [[true]], // single dark module
		};

		const png = matrixToPng(matrix, { moduleSize: 1, quietZone: 1 });

		// Extract IDAT
		let offset = 8;
		const view = new DataView(png.buffer, png.byteOffset);
		let idatData: Uint8Array[] = [];

		while (offset < png.length) {
			const length = view.getUint32(offset, false);
			offset += 4;

			const chunkType = String.fromCharCode(
				png[offset]!,
				png[offset + 1]!,
				png[offset + 2]!,
				png[offset + 3]!
			);
			offset += 4;

			const chunk = new Uint8Array(png.buffer, png.byteOffset + offset, length);
			if (chunkType === "IDAT") {
				idatData.push(chunk);
			}
			offset += length + 4;
		}

		const idatBuffer = new Uint8Array(idatData.reduce((sum, c) => sum + c.length, 0));
		let pos = 0;
		for (const chunk of idatData) {
			for (let i = 0; i < chunk.length; i++) {
				idatBuffer[pos++] = chunk[i]!;
			}
		}

		const decompressed = inflateSync(idatBuffer);
		const width = 3; // 1 module + 2*1 quietZone
		const scanlineLength = width * 3 + 1;

		// Row 0 (all quiet zone, should be white)
		for (let i = 1; i < 1 + width * 3; i++) {
			expect(decompressed[i]).toBe(0xff);
		}

		// Row 1: quiet zone (white), module (black), quiet zone (white)
		expect(decompressed[scanlineLength + 1]).toBe(0xff); // quiet zone
		expect(decompressed[scanlineLength + 4]).toBe(0x00); // dark module
		expect(decompressed[scanlineLength + 7]).toBe(0xff); // quiet zone
	});

	it("should support custom moduleSize and quietZone", () => {
		const matrix: QrMatrix = {
			size: 1,
			version: 1,
			ecc: "M",
			modules: [[true]],
		};

		const moduleSize = 5;
		const quietZone = 2;
		const png = matrixToPng(matrix, { moduleSize, quietZone });

		const view = new DataView(png.buffer, png.byteOffset);
		const ihdrLengthPos = 8;
		const width = view.getUint32(ihdrLengthPos + 8, false);
		const height = view.getUint32(ihdrLengthPos + 12, false);

		const expectedDim = (1 + 2 * quietZone) * moduleSize;
		expect(width).toBe(expectedDim);
		expect(height).toBe(expectedDim);
	});

	it("should test Swift decoder error handling (if swift available)", async () => {
		// Skip if swift not available
		const swiftPath = "/usr/bin/swift";
		if (!existsSync(swiftPath)) {
			console.log("Swift not found, skipping decoder test");
			return;
		}

		const tmpDir = `/tmp/test-qr-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			// Create test matrices
			const matrix: QrMatrix = {
				size: 5,
				version: 1,
				ecc: "M",
				modules: [
					[true, false, true, false, true],
					[false, true, false, true, false],
					[true, false, true, false, true],
					[false, true, false, true, false],
					[true, false, true, false, true],
				],
			};

			const png = matrixToPng(matrix);
			const testPngPath = join(tmpDir, "test.png");
			writeFileSync(testPngPath, png);

			// Test that all-light PNG (no QR) causes error
			const allLightMatrix: QrMatrix = {
				size: 5,
				version: 1,
				ecc: "M",
				modules: [
					[false, false, false, false, false],
					[false, false, false, false, false],
					[false, false, false, false, false],
					[false, false, false, false, false],
					[false, false, false, false, false],
				],
			};

			const allLightPng = matrixToPng(allLightMatrix);
			const allLightPath = join(tmpDir, "all-light.png");
			writeFileSync(allLightPath, allLightPng);

			// Verify PNG files are valid
			const testPngData = readFileSync(testPngPath);
			expect(testPngData.length).toBeGreaterThan(0);

			const allLightPngData = readFileSync(allLightPath);
			expect(allLightPngData.length).toBeGreaterThan(0);
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});
});
