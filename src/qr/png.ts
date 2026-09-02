import { deflateSync } from "zlib";
import type { QrMatrix } from "./types.ts";

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

export function matrixToPng(
	matrix: QrMatrix,
	options?: { moduleSize?: number; quietZone?: number }
): Uint8Array {
	const moduleSize = options?.moduleSize ?? 10;
	const quietZone = options?.quietZone ?? 4;

	// Validate that modules is size x size
	if (matrix.modules.length !== matrix.size) {
		throw new Error(
			`Expected ${matrix.size} rows in modules, got ${matrix.modules.length}`
		);
	}
	for (let i = 0; i < matrix.modules.length; i++) {
		const row = matrix.modules[i];
		if (row === undefined) {
			throw new Error(`Row ${i} is undefined`);
		}
		if (row.length !== matrix.size) {
			throw new Error(
				`Expected row ${i} to have ${matrix.size} modules, got ${row.length}`
			);
		}
	}

	// Calculate PNG dimensions: (size + 2*quietZone) * moduleSize
	const pngWidth = (matrix.size + 2 * quietZone) * moduleSize;
	const pngHeight = (matrix.size + 2 * quietZone) * moduleSize;

	// Create PNG signature
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	// Create IHDR chunk
	const ihdrData = new Uint8Array(13);
	const ihdrView = new DataView(ihdrData.buffer);
	ihdrView.setUint32(0, pngWidth, false);
	ihdrView.setUint32(4, pngHeight, false);
	ihdrData[8] = 8; // bit depth
	ihdrData[9] = 2; // color type: RGB
	ihdrData[10] = 0; // compression method
	ihdrData[11] = 0; // filter method
	ihdrData[12] = 0; // interlace method

	// Create IHDR chunk with CRC
	const ihdrChunkType = new Uint8Array([0x49, 0x48, 0x44, 0x52]); // "IHDR"
	const ihdrCrcData = new Uint8Array(4 + 13);
	for (let i = 0; i < 4; i++) {
		const byte = ihdrChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IHDR type");
		ihdrCrcData[i] = byte;
	}
	for (let i = 0; i < 13; i++) {
		const byte = ihdrData[i];
		if (byte === undefined) throw new Error("Undefined byte in IHDR data");
		ihdrCrcData[4 + i] = byte;
	}
	const ihdrCrc = computeCrc32(ihdrCrcData);

	// Create image data
	const scanlineLength = pngWidth * 3 + 1; // 1 filter byte + width * 3 bytes (RGB)
	const imageData = new Uint8Array(pngHeight * scanlineLength);

	for (let y = 0; y < pngHeight; y++) {
		const rowOffset = y * scanlineLength;
		imageData[rowOffset] = 0; // filter type: None

		for (let x = 0; x < pngWidth; x++) {
			const pixelOffset = rowOffset + 1 + x * 3;

			// Determine if this pixel is in the QR matrix or quiet zone
			const moduleX = Math.floor(x / moduleSize) - quietZone;
			const moduleY = Math.floor(y / moduleSize) - quietZone;

			let isDark = false;
			if (moduleX >= 0 && moduleX < matrix.size && moduleY >= 0 && moduleY < matrix.size) {
				const row = matrix.modules[moduleY];
				if (row === undefined) {
					throw new Error(`Row ${moduleY} is undefined`);
				}
				const module = row[moduleX];
				if (module === undefined) {
					throw new Error(`Module at [${moduleY}][${moduleX}] is undefined`);
				}
				isDark = module; // true = dark, false = light
			}
			// isDark stays false for quiet zone (white)

			// Dark modules = black (0, 0, 0), light modules and quiet zone = white (255, 255, 255)
			const color = isDark ? 0x00 : 0xff;

			const byte0 = imageData[pixelOffset];
			const byte1 = imageData[pixelOffset + 1];
			const byte2 = imageData[pixelOffset + 2];
			if (byte0 === undefined || byte1 === undefined || byte2 === undefined) {
				throw new Error("Undefined bytes in image data");
			}

			imageData[pixelOffset] = color;
			imageData[pixelOffset + 1] = color;
			imageData[pixelOffset + 2] = color;
		}
	}

	// Compress image data with zlib (deflate)
	const compressedData = deflateSync(imageData);

	// Create IDAT chunk
	const idatChunkType = new Uint8Array([0x49, 0x44, 0x41, 0x54]); // "IDAT"
	const idatCrcData = new Uint8Array(4 + compressedData.length);
	for (let i = 0; i < 4; i++) {
		const byte = idatChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IDAT type");
		idatCrcData[i] = byte;
	}
	for (let i = 0; i < compressedData.length; i++) {
		const byte = compressedData[i];
		if (byte === undefined) throw new Error("Undefined byte in compressed data");
		idatCrcData[4 + i] = byte;
	}
	const idatCrc = computeCrc32(idatCrcData);

	// Create IEND chunk (empty)
	const iendChunkType = new Uint8Array([0x49, 0x45, 0x4e, 0x44]); // "IEND"
	const iendCrcData = new Uint8Array(4);
	for (let i = 0; i < 4; i++) {
		const byte = iendChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IEND type");
		iendCrcData[i] = byte;
	}
	const iendCrc = computeCrc32(iendCrcData);

	// Assemble PNG file
	let totalSize =
		8 + // signature
		4 + // IHDR length
		4 + // IHDR type
		13 + // IHDR data
		4 + // IHDR CRC
		4 + // IDAT length
		4 + // IDAT type
		compressedData.length + // IDAT data
		4 + // IDAT CRC
		4 + // IEND length
		4 + // IEND type
		4; // IEND CRC

	const png = new Uint8Array(totalSize);
	let offset = 0;

	// Write signature
	for (let i = 0; i < 8; i++) {
		const byte = signature[i];
		if (byte === undefined) throw new Error("Undefined byte in signature");
		png[offset++] = byte;
	}

	// Write IHDR chunk
	const ihdrLengthView = new DataView(png.buffer);
	ihdrLengthView.setUint32(offset, 13, false);
	offset += 4;
	for (let i = 0; i < 4; i++) {
		const byte = ihdrChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IHDR type");
		png[offset++] = byte;
	}
	for (let i = 0; i < 13; i++) {
		const byte = ihdrData[i];
		if (byte === undefined) throw new Error("Undefined byte in IHDR data");
		png[offset++] = byte;
	}
	ihdrLengthView.setUint32(offset, ihdrCrc, false);
	offset += 4;

	// Write IDAT chunk
	ihdrLengthView.setUint32(offset, compressedData.length, false);
	offset += 4;
	for (let i = 0; i < 4; i++) {
		const byte = idatChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IDAT type");
		png[offset++] = byte;
	}
	for (let i = 0; i < compressedData.length; i++) {
		const byte = compressedData[i];
		if (byte === undefined) throw new Error("Undefined byte in compressed data");
		png[offset++] = byte;
	}
	ihdrLengthView.setUint32(offset, idatCrc, false);
	offset += 4;

	// Write IEND chunk
	ihdrLengthView.setUint32(offset, 0, false);
	offset += 4;
	for (let i = 0; i < 4; i++) {
		const byte = iendChunkType[i];
		if (byte === undefined) throw new Error("Undefined byte in IEND type");
		png[offset++] = byte;
	}
	ihdrLengthView.setUint32(offset, iendCrc, false);
	offset += 4;

	return png;
}
