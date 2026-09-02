import type { EccLevel, QrMatrix } from "./types.ts";
import { rsEncode } from "./reed-solomon.ts";
import {
  CAPACITY,
  BLOCK_STRUCTURE,
  ALIGNMENT_PATTERNS,
  totalDataCodewords,
  applyMask,
  isInFunctionArea,
  bchFormat,
  bchVersion,
} from "./tables.ts";

export interface EncodeOptions {
  ecc?: EccLevel;
}

export function encodeQr(text: string, options?: EncodeOptions): QrMatrix {
  const ecc = options?.ecc ?? "M";

  // Encode text to UTF-8 bytes
  const data = new TextEncoder().encode(text);

  // Find minimum version
  let version: number | null = null;
  for (let v = 1; v <= 10; v++) {
    const capacity = CAPACITY[v]?.[ecc];
    if (capacity !== undefined && data.length <= capacity) {
      version = v;
      break;
    }
  }

  if (version === null) {
    throw new Error(
      `Text too large to encode: ${data.length} bytes exceeds version 10 capacity at ECC level ${ecc}`
    );
  }

  const size = 4 * version + 17;

  // Create the data codewords
  const dataCodewords = createDataCodewords(data, version, ecc);

  // Split into ECC blocks, generate EC codewords per block, and interleave
  // data codewords across blocks followed by EC codewords across blocks.
  const interleavedData = interleaveCodwords(dataCodewords, version, ecc);

  // Create modules grid
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  // Place finder patterns and other function patterns
  placeFunctionPatterns(modules, version);

  // Place data modules in zig-zag pattern
  placeDataModules(modules, interleavedData, version);

  // Evaluate all mask patterns and choose the best one
  const bestMask = evaluateMasks(modules, version);

  // Apply the best mask
  applyMask(modules, bestMask, version);

  // Write format information
  writeFormatInformation(modules, version, ecc, bestMask);

  // Write version information for v >= 7
  if (version >= 7) {
    writeVersionInformation(modules, version);
  }

  return {
    size,
    version,
    ecc,
    modules: modules as ReadonlyArray<ReadonlyArray<boolean>>,
  };
}

function createDataCodewords(data: Uint8Array, version: number, ecc: EccLevel): Uint8Array {
  // Mode indicator: 0100 (byte mode)
  // Character count indicator: 8 bits for v1-9, 16 bits for v10
  const charCountBits = version <= 9 ? 8 : 16;

  // The total number of data codewords this version+ECC level requires (sum
  // of data codewords across all blocks) - the pad bytes must fill up to
  // exactly this many bytes, not merely to the next byte boundary.
  const totalBytes = totalDataCodewords(version, ecc);

  // Calculate total bits needed so far
  let bits = 4 + charCountBits + data.length * 8; // mode + char count + data

  // Terminator (up to 4 bits of 0000, truncated if fewer bits remain)
  const terminatorBits = Math.max(0, Math.min(4, totalBytes * 8 - bits));
  bits += terminatorBits;

  // Pad to byte boundary
  const paddingBits = (8 - (bits % 8)) % 8;
  bits += paddingBits;

  // Build bit stream
  const bitArray: number[] = [];

  // Mode indicator (4 bits)
  addBits(bitArray, 0b0100, 4);

  // Character count indicator
  addBits(bitArray, data.length, charCountBits);

  // Data (8-bit bytes)
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === undefined) throw new Error("Unexpected undefined byte");
    addBits(bitArray, byte, 8);
  }

  // Terminator
  addBits(bitArray, 0, terminatorBits);

  // Pad to byte boundary
  if (paddingBits > 0) {
    addBits(bitArray, 0, paddingBits);
  }

  // Fill padding bytes
  const paddingByteCount = totalBytes - Math.ceil(bitArray.length / 8);
  for (let i = 0; i < paddingByteCount; i++) {
    addBits(bitArray, i % 2 === 0 ? 0xec : 0x11, 8);
  }

  // Convert bit array to byte array
  const byteArray = new Uint8Array(totalBytes);
  for (let i = 0; i < totalBytes; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      const bitIndex = i * 8 + j;
      byte = (byte << 1) | (bitArray[bitIndex] ?? 0);
    }
    byteArray[i] = byte;
  }

  return byteArray;
}

function addBits(bitArray: number[], value: number, bits: number): void {
  for (let i = bits - 1; i >= 0; i--) {
    bitArray.push((value >> i) & 1);
  }
}

function interleaveCodwords(
  dataCodewords: Uint8Array,
  version: number,
  ecc: EccLevel
): Uint8Array {
  const structure = BLOCK_STRUCTURE[version]?.[ecc];
  if (!structure) throw new Error(`Invalid version ${version} or ECC level ${ecc}`);

  // Expand the (count, dataBytes) groups into one entry per actual block.
  const blocks: Array<{ dataBytes: number; ecBytes: number }> = [];
  for (const group of structure.groups) {
    for (let i = 0; i < group.count; i++) {
      blocks.push({ dataBytes: group.dataBytes, ecBytes: structure.ecBytesPerBlock });
    }
  }
  const totalEcBytes = blocks.length * structure.ecBytesPerBlock;

  const result = new Uint8Array(dataCodewords.length + totalEcBytes);
  let resultIndex = 0;

  // Split data codewords into blocks, generating EC codewords per block.
  const blockDataArrays: Uint8Array[] = [];
  const blockEccArrays: Uint8Array[] = [];

  let dataIndex = 0;
  for (const blockInfo of blocks) {
    const blockData = new Uint8Array(blockInfo.dataBytes);
    for (let i = 0; i < blockInfo.dataBytes; i++) {
      blockData[i] = dataCodewords[dataIndex++] ?? 0;
    }
    blockDataArrays.push(blockData);
    blockEccArrays.push(rsEncode(blockData, blockInfo.ecBytes));
  }

  // Interleave data codewords
  let maxDataBytes: number = 0;
  for (const block of blocks) {
    const dataBytes = block.dataBytes ?? 0;
    if (dataBytes > maxDataBytes) {
      maxDataBytes = dataBytes;
    }
  }
  for (let i = 0; i < maxDataBytes; i++) {
    for (const blockData of blockDataArrays) {
      if (i < blockData.length) {
        const byte = blockData[i];
        if (byte !== undefined) {
          result[resultIndex++] = byte;
        }
      }
    }
  }

  // Interleave ECC codewords
  let maxEccBytes: number = 0;
  for (const block of blocks) {
    const ecBytes = block.ecBytes ?? 0;
    if (ecBytes > maxEccBytes) {
      maxEccBytes = ecBytes;
    }
  }
  for (let i = 0; i < maxEccBytes; i++) {
    for (const blockEcc of blockEccArrays) {
      if (i < blockEcc.length) {
        const byte = blockEcc[i];
        if (byte !== undefined) {
          result[resultIndex++] = byte;
        }
      }
    }
  }

  // Remainder bits (0, or 7 for versions 2-6) are always 0 and require no
  // explicit representation here: the data-placement pass fills any
  // remaining non-function modules with 0 once the codeword stream is
  // exhausted, which is exactly what the remainder bits are.
  return result.slice(0, resultIndex);
}

function placeFunctionPatterns(modules: boolean[][], version: number): void {
  const size = 4 * version + 17;

  // Place finder patterns (7x7) with separators
  placeFinder(modules, 0, 0, size); // Top-left
  placeFinder(modules, 0, size - 7, size); // Top-right
  placeFinder(modules, size - 7, 0, size); // Bottom-left

  // Place timing patterns
  // Horizontal timing (row 6)
  for (let i = 8; i < size - 8; i++) {
    const row = modules[6];
    if (row) {
      row[i] = i % 2 === 0;
    }
  }

  // Vertical timing (col 6)
  for (let i = 8; i < size - 8; i++) {
    const row = modules[i];
    if (row) {
      row[6] = i % 2 === 0;
    }
  }

  // Dark module
  const row = modules[4 * version + 9];
  if (row) {
    row[8] = true;
  }

  // Place alignment patterns (version 2+)
  if (version >= 2) {
    const centers = ALIGNMENT_PATTERNS[version] ?? [];
    for (const pair of centers) {
      const ar = pair[0];
      const ac = pair[1];
      if (ar !== undefined && ac !== undefined) {
        placeAlignment(modules, ar, ac, size);
      }
    }
  }
}

function placeFinder(modules: boolean[][], startRow: number, startCol: number, size: number): void {
  // 7x7 pattern
  const pattern = [
    [true, true, true, true, true, true, true],
    [true, false, false, false, false, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, false, false, false, false, true],
    [true, true, true, true, true, true, true],
  ];

  for (let r = 0; r < 7; r++) {
    if (startRow + r >= size) break;
    const row = modules[startRow + r];
    if (!row) continue;
    for (let c = 0; c < 7; c++) {
      if (startCol + c >= size) break;
      const patternRow = pattern[r];
      if (!patternRow) continue;
      row[startCol + c] = patternRow[c] ?? false;
    }
  }

  // Separator (white border)
  // Below finder pattern
  if (startRow + 7 < size) {
    const separatorRow = modules[startRow + 7];
    if (separatorRow) {
      for (let c = 0; c <= 7 && startCol + c < size; c++) {
        separatorRow[startCol + c] = false;
      }
    }
  }

  // Right of finder pattern
  for (let r = 0; r <= 7 && startRow + r < size; r++) {
    const row = modules[startRow + r];
    if (row && startCol + 7 < size) {
      row[startCol + 7] = false;
    }
  }
}

function placeAlignment(modules: boolean[][], centerRow: number, centerCol: number, size: number): void {
  // 5x5 pattern centered at (centerRow, centerCol)
  const pattern = [
    [true, true, true, true, true],
    [true, false, false, false, true],
    [true, false, true, false, true],
    [true, false, false, false, true],
    [true, true, true, true, true],
  ];

  for (let r = -2; r <= 2; r++) {
    const actualRow = centerRow + r;
    if (actualRow < 0 || actualRow >= size) continue;
    const row = modules[actualRow];
    if (!row) continue;
    for (let c = -2; c <= 2; c++) {
      const actualCol = centerCol + c;
      if (actualCol < 0 || actualCol >= size) continue;
      const patternRow = pattern[r + 2];
      if (!patternRow) continue;
      row[actualCol] = patternRow[c + 2] ?? false;
    }
  }
}

function placeDataModules(modules: boolean[][], data: Uint8Array, version: number): void {
  const size = 4 * version + 17;
  let dataIndex = 0;
  let bitIndex = 0;
  let goingUp = true;

  // Process two-module-wide columns from right to left, zig-zagging.
  // Column 6 is the vertical timing pattern and holds no data: whenever the
  // right-hand column of a pair would be 6, treat it as 5 instead, so that
  // columns 5 and 4 are traversed together as a single pair (and column 6 is
  // skipped entirely rather than merely left unwritten).
  let col = size - 1;
  while (col >= 1) {
    if (col === 6) {
      col = 5;
    }

    for (let row = 0; row < size; row++) {
      const actualRow = goingUp ? size - 1 - row : row;
      const modules_row = modules[actualRow];
      if (!modules_row) continue;

      // Visit the right-hand module of the pair before the left-hand one.
      for (let offset = 0; offset < 2; offset++) {
        const c = col - offset;
        if (c < 0) continue;

        if (!isInFunctionArea(actualRow, c, version)) {
          let bit = false;
          if (dataIndex < data.length) {
            const dataByte = data[dataIndex];
            if (dataByte === undefined) throw new Error("Undefined data byte");
            bit = ((dataByte >> (7 - bitIndex)) & 1) === 1;

            bitIndex++;
            if (bitIndex === 8) {
              bitIndex = 0;
              dataIndex++;
            }
          }
          modules_row[c] = bit;
        }
      }
    }

    goingUp = !goingUp;
    col -= 2;
  }
}

function evaluateMasks(modules: boolean[][], version: number): number {
  let bestMask = 0;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    // Clone modules for this mask evaluation
    const testModules = modules.map((row) => [...row]);

    // Apply mask
    applyMask(testModules, mask, version);

    // Calculate penalty score
    const score = calculatePenalty(testModules, version);

    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }

  return bestMask;
}

function calculatePenalty(modules: boolean[][], version: number): number {
  const size = 4 * version + 17;
  let penalty = 0;

  // N1: Penalties for 3 or more adjacent modules in a line
  // Check horizontal
  for (let r = 0; r < size; r++) {
    let count = 1;
    let lastColor = modules[r]?.[0];
    for (let c = 1; c < size; c++) {
      const color = modules[r]?.[c];
      if (color === lastColor) {
        count++;
      } else {
        if (count >= 3) {
          penalty += 3 + (count - 3);
        }
        count = 1;
        lastColor = color;
      }
    }
    if (count >= 3) {
      penalty += 3 + (count - 3);
    }
  }

  // Check vertical
  for (let c = 0; c < size; c++) {
    let count = 1;
    let lastColor = modules[0]?.[c];
    for (let r = 1; r < size; r++) {
      const color = modules[r]?.[c];
      if (color === lastColor) {
        count++;
      } else {
        if (count >= 3) {
          penalty += 3 + (count - 3);
        }
        count = 1;
        lastColor = color;
      }
    }
    if (count >= 3) {
      penalty += 3 + (count - 3);
    }
  }

  // N2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r]?.[c];
      if (
        color === modules[r]?.[c + 1] &&
        color === modules[r + 1]?.[c] &&
        color === modules[r + 1]?.[c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // N3: Patterns similar to finder patterns
  const patterns = [
    [true, false, true, true, true, false, true],
    [true, false, true, false, true, true, true],
  ];

  // Check horizontal
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 6; c++) {
      for (const pattern of patterns) {
        let matches = true;
        for (let i = 0; i < 7; i++) {
          if (modules[r]?.[c + i] !== pattern[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          penalty += 40;
        }
      }
    }
  }

  // Check vertical
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size - 6; r++) {
      for (const pattern of patterns) {
        let matches = true;
        for (let i = 0; i < 7; i++) {
          if (modules[r + i]?.[c] !== pattern[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          penalty += 40;
        }
      }
    }
  }

  // N4: Dark/light balance
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]?.[c]) darkCount++;
    }
  }
  const total = size * size;
  const darkPercent = (darkCount / total) * 100;
  const deviation = Math.abs(darkPercent - 50);
  penalty += Math.floor(deviation / 5) * 10;

  return penalty;
}

function writeFormatInformation(
  modules: boolean[][],
  version: number,
  ecc: EccLevel,
  mask: number
): void {
  const size = 4 * version + 17;

  // Format info: 5 bits = 2 ECC bits + 3 mask bits
  const eccBits: Record<EccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  const eccValue = eccBits[ecc] ?? 0;
  const format = (eccValue << 3) | mask;

  // Apply BCH
  const bch = bchFormat(format);
  const formatInfo = (format << 10) | bch;

  // XOR with mask pattern
  const formatMasked = formatInfo ^ 0x5412;

  // Write to both locations
  // Top-left horizontal (row 8, cols 0-8)
  // Read bits from MSB (bit 14) to LSB (bit 7), skipping bit 6
  let bitIndex = 14;
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue; // Skip timing column
    const bit = (formatMasked >> bitIndex) & 1;
    const row = modules[8];
    if (row) {
      row[i] = bit === 1;
    }
    bitIndex--;
  }

  // Top-left vertical (col 8, rows [7, 5, 4, 3, 2, 1, 0] for bits [6, 5, 4, 3, 2, 1, 0])
  const verticalRows = [7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < verticalRows.length; i++) {
    const bitIndex = 6 - i;
    const row_idx = verticalRows[i];
    if (row_idx === undefined) continue;
    const bit = (formatMasked >> bitIndex) & 1;
    const modules_row = modules[row_idx];
    if (modules_row) {
      modules_row[8] = bit === 1;
    }
  }

  // Top-right (row 8, cols size-8 to size-1): bits 7 down to 0
  for (let i = 0; i < 8; i++) {
    const bit = (formatMasked >> (7 - i)) & 1;
    const row = modules[8];
    if (row) {
      row[size - 8 + i] = bit === 1;
    }
  }

  // Bottom-left (col 8, rows size-7 to size-1)
  for (let i = 0; i < 7; i++) {
    const bit = (formatMasked >> (14 - i)) & 1;
    const row = modules[size - 7 + i];
    if (row) {
      row[8] = bit === 1;
    }
  }
}

function writeVersionInformation(modules: boolean[][], version: number): void {
  const size = 4 * version + 17;
  const versionInfo = (version << 12) | bchVersion(version);

  // Both copies are filled column-major: for each column, the 3 rows are
  // filled top-to-bottom, LSB first, before moving to the next column.

  // Bottom-left: rows (size-11) to (size-9), cols 0-5
  let bitIndex = 0;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 3; i++) {
      const bit = (versionInfo >> bitIndex) & 1;
      const row = modules[size - 11 + i];
      if (row) {
        row[j] = bit === 1;
      }
      bitIndex++;
    }
  }

  // Top-right: rows 0-5, cols (size-11) to (size-9)
  bitIndex = 0;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 3; i++) {
      const bit = (versionInfo >> bitIndex) & 1;
      const row = modules[i];
      if (row) {
        row[size - 11 + j] = bit === 1;
      }
      bitIndex++;
    }
  }
}
