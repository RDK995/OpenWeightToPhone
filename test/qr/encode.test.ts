import { describe, it, expect } from "bun:test";
import { encodeQr } from "../../src/qr/encode.ts";
import { matrixToPng } from "../../src/qr/png.ts";
import { rsEncode } from "../../src/qr/reed-solomon.ts";
import { isInFunctionArea, applyMask, BLOCK_STRUCTURE } from "../../src/qr/tables.ts";
import { writeFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { spawnSync } from "bun";
import { join } from "path";
import type { QrMatrix } from "../../src/qr/types.ts";
import type { EccLevel } from "../../src/qr/types.ts";

const SWIFT_PATH = "/usr/bin/swift";

// --- Independent oracle #1: a reverse reader ------------------------------
//
// Walks the same two-module-wide, right-to-left, zig-zagging traversal that
// the encoder uses to place data (skipping the vertical timing column at 6
// by substituting 5, exactly as encode.ts does), reads the raw module
// values back out, un-applies a candidate mask, and reassembles the
// interleaved codeword byte stream. This is a total oracle for placement +
// masking that is independent of Python and of the Swift/Vision decoder.
function reverseReadCodewords(matrix: QrMatrix, mask: number): number[] {
	const clone = matrix.modules.map((row) => [...row]);
	applyMask(clone, mask, matrix.version);

	const size = matrix.size;
	const bits: number[] = [];
	let col = size - 1;
	let goingUp = true;
	while (col >= 1) {
		if (col === 6) col = 5;
		for (let row = 0; row < size; row++) {
			const actualRow = goingUp ? size - 1 - row : row;
			for (let offset = 0; offset < 2; offset++) {
				const c = col - offset;
				if (c < 0) continue;
				if (isInFunctionArea(actualRow, c, matrix.version)) continue;
				const rowArr = clone[actualRow];
				bits.push(rowArr && rowArr[c] ? 1 : 0);
			}
		}
		goingUp = !goingUp;
		col -= 2;
	}

	const bytes: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		let b = 0;
		for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0);
		bytes.push(b);
	}
	return bytes;
}

// Try every mask and return the codeword stream that a correctly-formed
// symbol must expose for exactly one of them (the mask the encoder chose).
function findCodewordStream(matrix: QrMatrix): number[] {
	for (let mask = 0; mask < 8; mask++) {
		const bytes = reverseReadCodewords(matrix, mask);
		// A correct reconstruction round-trips through Reed-Solomon for every
		// block; use that as the selection criterion so the test does not need
		// to know which mask encodeQr picked internally.
		if (verifyBlocksAgainstReedSolomon(matrix.version, matrix.ecc, bytes)) {
			return bytes;
		}
	}
	throw new Error("No mask reproduced a Reed-Solomon-consistent codeword stream");
}

function verifyBlocksAgainstReedSolomon(
	version: number,
	ecc: EccLevel,
	bytes: number[]
): boolean {
	const structure = BLOCK_STRUCTURE[version]?.[ecc];
	if (!structure) throw new Error(`No block structure for v${version}/${ecc}`);

	const blocks: Array<{ dataBytes: number; ecBytes: number }> = [];
	for (const group of structure.groups) {
		for (let i = 0; i < group.count; i++) {
			blocks.push({ dataBytes: group.dataBytes, ecBytes: structure.ecBytesPerBlock });
		}
	}

	const totalData = blocks.reduce((sum, b) => sum + b.dataBytes, 0);
	const maxDataBytes = Math.max(...blocks.map((b) => b.dataBytes));
	const maxEcBytes = structure.ecBytesPerBlock;

	// De-interleave data codewords.
	const blockData: number[][] = blocks.map(() => []);
	let idx = 0;
	for (let i = 0; i < maxDataBytes; i++) {
		for (let b = 0; b < blocks.length; b++) {
			const block = blocks[b];
			if (block && i < block.dataBytes) {
				const byte = bytes[idx++];
				if (byte === undefined) return false;
				blockData[b]?.push(byte);
			}
		}
	}
	// De-interleave EC codewords.
	const blockEc: number[][] = blocks.map(() => []);
	for (let i = 0; i < maxEcBytes; i++) {
		for (let b = 0; b < blocks.length; b++) {
			const block = blocks[b];
			if (block && i < block.ecBytes) {
				const byte = bytes[idx++];
				if (byte === undefined) return false;
				blockEc[b]?.push(byte);
			}
		}
	}

	if (idx !== totalData + blocks.length * maxEcBytes) return false;

	for (let b = 0; b < blocks.length; b++) {
		const block = blocks[b];
		const data = blockData[b];
		const ec = blockEc[b];
		if (!block || !data || !ec) return false;
		const expectedEc = Array.from(rsEncode(new Uint8Array(data), block.ecBytes));
		if (expectedEc.length !== ec.length) return false;
		for (let i = 0; i < expectedEc.length; i++) {
			if (expectedEc[i] !== ec[i]) return false;
		}
	}
	return true;
}

function toHex(bytes: number[]): string {
	return bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function forceVersion(version: number, ecc: EccLevel): string {
	for (let len = 1; len <= 4000; len++) {
		const text = "A".repeat(len);
		const matrix = encodeQr(text, { ecc });
		if (matrix.version === version) return text;
		if (matrix.version > version) break;
	}
	throw new Error(`Could not find text forcing version ${version} at ECC ${ecc}`);
}

describe("encodeQr", () => {
	it("should encode a simple string", () => {
		const matrix = encodeQr("Hello");
		expect(matrix.version).toBeGreaterThanOrEqual(1);
		expect(matrix.version).toBeLessThanOrEqual(10);
		expect(matrix.ecc).toBe("M");
		expect(matrix.size).toBe(4 * matrix.version + 17);
		expect(matrix.modules.length).toBe(matrix.size);
		for (const row of matrix.modules) {
			expect(row.length).toBe(matrix.size);
		}
	});

	it("should use default ECC level M", () => {
		const matrix = encodeQr("Test");
		expect(matrix.ecc).toBe("M");
	});

	it("should respect custom ECC levels", () => {
		const text = "Test data for ECC";
		for (const ecc of ["L", "M", "Q", "H"] as const) {
			const matrix = encodeQr(text, { ecc });
			expect(matrix.ecc).toBe(ecc);
		}
	});

	it("should have correct size formula: 4*version+17", () => {
		const testCases = [
			{ text: "A", minVersion: 1 },
			{ text: "Hello, World!", minVersion: 1 },
		];

		for (const tc of testCases) {
			const matrix = encodeQr(tc.text);
			const expectedSize = 4 * matrix.version + 17;
			expect(matrix.size).toBe(expectedSize);
		}
	});

	it("should find smallest version that fits", () => {
		const v1Matrix = encodeQr("A");
		expect(v1Matrix.version).toBe(1);

		const longText = "A".repeat(100);
		const vlargerMatrix = encodeQr(longText, { ecc: "L" });
		expect(vlargerMatrix.version).toBeGreaterThanOrEqual(1);
		expect(vlargerMatrix.version).toBeLessThanOrEqual(10);
	});

	it("should have dark module at (4*version+9, 8) for every version", () => {
		for (let v = 1; v <= 10; v++) {
			const text = forceVersion(v, "L");
			const matrix = encodeQr(text, { ecc: "L" });
			const row = matrix.modules[4 * v + 9];
			expect(row).toBeDefined();
			expect(row?.[8]).toBe(true);
		}
	});

	it("should have finder patterns at three corners", () => {
		const matrix = encodeQr("Test", { ecc: "L" });

		expect(matrix.modules[0]?.[0]).toBe(true);
		const lastCol = matrix.size - 1;
		expect(matrix.modules[0]?.[lastCol]).toBe(true);
		const lastRow = matrix.size - 1;
		expect(matrix.modules[lastRow]?.[0]).toBe(true);
	});

	it("should have alternating timing patterns", () => {
		const matrix = encodeQr(forceVersion(3, "M"), { ecc: "M" });
		for (let i = 8; i < matrix.size - 8; i++) {
			expect(matrix.modules[6]?.[i]).toBe(i % 2 === 0);
			expect(matrix.modules[i]?.[6]).toBe(i % 2 === 0);
		}
	});

	it("should encode UTF-8 correctly", () => {
		const text = "héllo-é✓";
		const matrix = encodeQr(text);
		expect(matrix).toBeDefined();
		expect(matrix.size).toBeGreaterThan(0);
	});

	// --- Stage A: codeword stream, checkable by hand ------------------------
	// "hello" in byte mode, version 1, ECC M: mode 0100, count 00000101, the
	// 5 UTF-8 bytes of "hello", terminator, pad to byte boundary, then
	// alternating 0xEC/0x11 up to 16 data codewords. This literal is derived
	// by hand from the bit stream (see task packet) and is a permanent
	// regression guard independent of Python or Swift.
	const HELLO_M_DATA_CODEWORDS = [
		0x40, 0x56, 0x86, 0x56, 0xc6, 0xc6, 0xf0, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
	];

	it("Stage A+B: 'hello'/ECC M codeword stream matches a hand-derived literal", () => {
		const matrix = encodeQr("hello", { ecc: "M" });
		expect(matrix.version).toBe(1);

		const expectedEc = Array.from(rsEncode(new Uint8Array(HELLO_M_DATA_CODEWORDS), 10));
		const expected = [...HELLO_M_DATA_CODEWORDS, ...expectedEc];

		const actual = findCodewordStream(matrix);
		expect(toHex(actual)).toBe(toHex(expected));
	});

	// --- Stage B, generalised: every version x every ECC level --------------
	// For every version/ECC combination, reverse-read the placed matrix and
	// verify each Reed-Solomon block's EC codewords are exactly what
	// rsEncode produces from that block's data codewords. This is a total,
	// self-contained oracle for codeword generation + block interleaving +
	// data placement + masking, independent of Python and Swift, and it is
	// what actually catches multi-block interleaving bugs (v3 Q/H onward).
	it("Stage B: every version/ECC codeword stream is internally Reed-Solomon consistent", () => {
		for (const ecc of ["L", "M", "Q", "H"] as const) {
			for (let version = 1; version <= 10; version++) {
				const text = forceVersion(version, ecc);
				const matrix = encodeQr(text, { ecc });
				expect(matrix.version).toBe(version);
				expect(() => findCodewordStream(matrix)).not.toThrow();
			}
		}
	});

	it("should round-trip with Swift decoder for short text", () => {
		if (!existsSync(SWIFT_PATH)) {
			console.log("Swift not found, skipping round-trip test");
			return;
		}

		const tmpDir = `/tmp/qr-test-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			for (const text of ["A", "hello"]) {
				const matrix = encodeQr(text, { ecc: "M" });
				const png = matrixToPng(matrix);
				const pngPath = join(tmpDir, `test-${text}.png`);
				writeFileSync(pngPath, png);

				const result = spawnSync([SWIFT_PATH, "scripts/qr-decode.swift", pngPath], {
					cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
				});

				expect(result.exitCode).toBe(0);
				expect(result.stdout.toString().trim()).toBe(text);
			}
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should encode a string needing percent/UTF-8 care and round-trip it", () => {
		if (!existsSync(SWIFT_PATH)) {
			console.log("Swift not found, skipping UTF-8 round-trip test");
			return;
		}

		const tmpDir = `/tmp/qr-test-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			const text = "héllo-é✓";
			const matrix = encodeQr(text, { ecc: "M" });
			const png = matrixToPng(matrix);
			const pngPath = join(tmpDir, "utf8.png");
			writeFileSync(pngPath, png);

			const result = spawnSync([SWIFT_PATH, "scripts/qr-decode.swift", pngPath], {
				cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString().trim()).toBe(text);
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should encode pairing URL", () => {
		if (!existsSync(SWIFT_PATH)) {
			console.log("Swift not found, skipping pairing URL test");
			return;
		}

		const tmpDir = `/tmp/qr-test-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			const token = "A".repeat(43);
			const text = `https://ryans-mac-studio.tailc3648a.ts.net/app/#t=${token}`;

			const matrix = encodeQr(text, { ecc: "M" });
			const png = matrixToPng(matrix);
			const pngPath = join(tmpDir, "pairing-url.png");
			writeFileSync(pngPath, png);

			const result = spawnSync([SWIFT_PATH, "scripts/qr-decode.swift", pngPath], {
				cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString().trim()).toBe(text);
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should round-trip every version 1-10 (forcing both 8-bit and 16-bit char count paths)", () => {
		if (!existsSync(SWIFT_PATH)) {
			console.log("Swift not found, skipping per-version round-trip test");
			return;
		}

		const tmpDir = `/tmp/qr-test-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			for (let version = 1; version <= 10; version++) {
				const text = forceVersion(version, "M");
				const matrix = encodeQr(text, { ecc: "M" });
				expect(matrix.version).toBe(version);

				const png = matrixToPng(matrix);
				const pngPath = join(tmpDir, `v${version}.png`);
				writeFileSync(pngPath, png);

				const result = spawnSync([SWIFT_PATH, "scripts/qr-decode.swift", pngPath], {
					cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
				});

				expect(result.exitCode).toBe(0);
				expect(result.stdout.toString().trim()).toBe(text);
			}
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should round-trip with every ECC level", () => {
		if (!existsSync(SWIFT_PATH)) {
			console.log("Swift not found, skipping ECC level test");
			return;
		}

		const tmpDir = `/tmp/qr-test-${Date.now()}-${Math.random()}`;
		mkdirSync(tmpDir, { recursive: true });

		try {
			const text = "Test ECC levels";

			for (const ecc of ["L", "M", "Q", "H"] as const) {
				const matrix = encodeQr(text, { ecc });
				const png = matrixToPng(matrix);
				const pngPath = join(tmpDir, `test-${ecc}.png`);
				writeFileSync(pngPath, png);

				const result = spawnSync([SWIFT_PATH, "scripts/qr-decode.swift", pngPath], {
					cwd: "/Users/ryankenny/Projects/phoneToLocalModel",
				});

				expect(result.exitCode).toBe(0);
				expect(result.stdout.toString().trim()).toBe(text);
			}
		} finally {
			if (existsSync(tmpDir)) {
				rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});

	it("should throw for text too large for version 10", () => {
		const tooLargeText = "A".repeat(10000);
		expect(() => {
			encodeQr(tooLargeText, { ecc: "M" });
		}).toThrow();
	});

	it("should encode the largest string that fits a version, and roll over on one more byte", () => {
		// Version 1, ECC M capacity is 14 bytes (byte mode): verify the boundary
		// precisely rather than just "some version is found".
		const atCapacity = encodeQr("A".repeat(14), { ecc: "M" });
		expect(atCapacity.version).toBe(1);

		const overCapacity = encodeQr("A".repeat(15), { ecc: "M" });
		expect(overCapacity.version).toBe(2);
	});

	it("should test capacity boundaries for each version", () => {
		for (let version = 1; version <= 10; version++) {
			const text = forceVersion(version, "M");
			const matrix = encodeQr(text, { ecc: "M" });
			expect(matrix.version).toBe(version);
		}
	});
});
