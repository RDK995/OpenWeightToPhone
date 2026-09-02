// QR Code specification tables per ISO/IEC 18004:2015

import type { EccLevel } from "./types.ts";

// Block structure per ISO/IEC 18004:2015 Table 9 / Annex block table: for each
// version and ECC level, the codewords are split into one or two *groups* of
// blocks. Every block in a group has the same number of data codewords; the
// number of EC codewords per block is constant across both groups.
export interface BlockGroup {
  count: number; // number of blocks in this group
  dataBytes: number; // data codewords per block in this group
}

export interface BlockStructure {
  ecBytesPerBlock: number;
  groups: BlockGroup[]; // 1 or 2 groups
}

// Verified against ISO/IEC 18004:2015: for every entry, sum(count * dataBytes)
// + ecBytesPerBlock * sum(count) equals the version's total codeword count
// (26, 44, 70, 100, 134, 172, 196, 242, 292, 346 for versions 1-10).
export const BLOCK_STRUCTURE: Record<number, Record<EccLevel, BlockStructure>> = {
  1: {
    L: { ecBytesPerBlock: 7, groups: [{ count: 1, dataBytes: 19 }] },
    M: { ecBytesPerBlock: 10, groups: [{ count: 1, dataBytes: 16 }] },
    Q: { ecBytesPerBlock: 13, groups: [{ count: 1, dataBytes: 13 }] },
    H: { ecBytesPerBlock: 17, groups: [{ count: 1, dataBytes: 9 }] },
  },
  2: {
    L: { ecBytesPerBlock: 10, groups: [{ count: 1, dataBytes: 34 }] },
    M: { ecBytesPerBlock: 16, groups: [{ count: 1, dataBytes: 28 }] },
    Q: { ecBytesPerBlock: 22, groups: [{ count: 1, dataBytes: 22 }] },
    H: { ecBytesPerBlock: 28, groups: [{ count: 1, dataBytes: 16 }] },
  },
  3: {
    L: { ecBytesPerBlock: 15, groups: [{ count: 1, dataBytes: 55 }] },
    M: { ecBytesPerBlock: 26, groups: [{ count: 1, dataBytes: 44 }] },
    Q: { ecBytesPerBlock: 18, groups: [{ count: 2, dataBytes: 17 }] },
    H: { ecBytesPerBlock: 22, groups: [{ count: 2, dataBytes: 13 }] },
  },
  4: {
    L: { ecBytesPerBlock: 20, groups: [{ count: 1, dataBytes: 80 }] },
    M: { ecBytesPerBlock: 18, groups: [{ count: 2, dataBytes: 32 }] },
    Q: { ecBytesPerBlock: 26, groups: [{ count: 2, dataBytes: 24 }] },
    H: { ecBytesPerBlock: 16, groups: [{ count: 4, dataBytes: 9 }] },
  },
  5: {
    L: { ecBytesPerBlock: 26, groups: [{ count: 1, dataBytes: 108 }] },
    M: { ecBytesPerBlock: 24, groups: [{ count: 2, dataBytes: 43 }] },
    Q: {
      ecBytesPerBlock: 18,
      groups: [
        { count: 2, dataBytes: 15 },
        { count: 2, dataBytes: 16 },
      ],
    },
    H: {
      ecBytesPerBlock: 22,
      groups: [
        { count: 2, dataBytes: 11 },
        { count: 2, dataBytes: 12 },
      ],
    },
  },
  6: {
    L: { ecBytesPerBlock: 18, groups: [{ count: 2, dataBytes: 68 }] },
    M: { ecBytesPerBlock: 16, groups: [{ count: 4, dataBytes: 27 }] },
    Q: { ecBytesPerBlock: 24, groups: [{ count: 4, dataBytes: 19 }] },
    H: { ecBytesPerBlock: 28, groups: [{ count: 4, dataBytes: 15 }] },
  },
  7: {
    L: { ecBytesPerBlock: 20, groups: [{ count: 2, dataBytes: 78 }] },
    M: { ecBytesPerBlock: 18, groups: [{ count: 4, dataBytes: 31 }] },
    Q: {
      ecBytesPerBlock: 18,
      groups: [
        { count: 2, dataBytes: 14 },
        { count: 4, dataBytes: 15 },
      ],
    },
    H: {
      ecBytesPerBlock: 26,
      groups: [
        { count: 4, dataBytes: 13 },
        { count: 1, dataBytes: 14 },
      ],
    },
  },
  8: {
    L: { ecBytesPerBlock: 24, groups: [{ count: 2, dataBytes: 97 }] },
    M: {
      ecBytesPerBlock: 22,
      groups: [
        { count: 2, dataBytes: 38 },
        { count: 2, dataBytes: 39 },
      ],
    },
    Q: {
      ecBytesPerBlock: 22,
      groups: [
        { count: 4, dataBytes: 18 },
        { count: 2, dataBytes: 19 },
      ],
    },
    H: {
      ecBytesPerBlock: 26,
      groups: [
        { count: 4, dataBytes: 14 },
        { count: 2, dataBytes: 15 },
      ],
    },
  },
  9: {
    L: { ecBytesPerBlock: 30, groups: [{ count: 2, dataBytes: 116 }] },
    M: {
      ecBytesPerBlock: 22,
      groups: [
        { count: 3, dataBytes: 36 },
        { count: 2, dataBytes: 37 },
      ],
    },
    Q: {
      ecBytesPerBlock: 20,
      groups: [
        { count: 4, dataBytes: 16 },
        { count: 4, dataBytes: 17 },
      ],
    },
    H: {
      ecBytesPerBlock: 24,
      groups: [
        { count: 4, dataBytes: 12 },
        { count: 4, dataBytes: 13 },
      ],
    },
  },
  10: {
    L: {
      ecBytesPerBlock: 18,
      groups: [
        { count: 2, dataBytes: 68 },
        { count: 2, dataBytes: 69 },
      ],
    },
    M: {
      ecBytesPerBlock: 26,
      groups: [
        { count: 4, dataBytes: 43 },
        { count: 1, dataBytes: 44 },
      ],
    },
    Q: {
      ecBytesPerBlock: 24,
      groups: [
        { count: 6, dataBytes: 19 },
        { count: 2, dataBytes: 20 },
      ],
    },
    H: {
      ecBytesPerBlock: 28,
      groups: [
        { count: 6, dataBytes: 15 },
        { count: 2, dataBytes: 16 },
      ],
    },
  },
};

export function totalDataCodewords(version: number, ecc: EccLevel): number {
  const structure = BLOCK_STRUCTURE[version]?.[ecc];
  if (!structure) throw new Error(`Invalid version ${version} or ECC level ${ecc}`);
  let total = 0;
  for (const group of structure.groups) {
    total += group.count * group.dataBytes;
  }
  return total;
}

// Capacity table: capacity[version][eccLevel] = maximum number of *input*
// bytes (byte mode) that fit, i.e. floor((totalDataCodewords*8 - modeBits -
// charCountBits) / 8), where the terminator is truncated/omitted rather than
// reserved for. Derived from BLOCK_STRUCTURE rather than transcribed, so it
// cannot drift out of sync with the block table.
export const CAPACITY: Record<number, Record<EccLevel, number>> = (() => {
  const eccLevels: EccLevel[] = ["L", "M", "Q", "H"];
  const capacity: Record<number, Record<EccLevel, number>> = {};
  for (let version = 1; version <= 10; version++) {
    const charCountBits = version <= 9 ? 8 : 16;
    const row = {} as Record<EccLevel, number>;
    for (const ecc of eccLevels) {
      const totalBits = totalDataCodewords(version, ecc) * 8;
      row[ecc] = Math.floor((totalBits - 4 - charCountBits) / 8);
    }
    capacity[version] = row;
  }
  return capacity;
})();

// Remainder bits for each version
export const REMAINDER_BITS: Record<number, number> = {
  1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7,
  7: 0, 8: 0, 9: 0, 10: 0,
};

// Alignment pattern coordinate lists per ISO/IEC 18004:2015 Annex E. Each
// version's list gives the row/column values used to build alignment
// pattern *centers*: every combination (r, c) drawn from this list is a
// candidate center, except the three combinations that coincide with a
// finder pattern (first,first) / (first,last) / (last,first).
const ALIGNMENT_COORDS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// Computed alignment pattern center coordinates for each version, as
// [row, col] pairs, with the three finder-overlapping combinations removed.
export const ALIGNMENT_PATTERNS: Record<number, number[][]> = (() => {
  const table: Record<number, number[][]> = {};
  for (let version = 1; version <= 10; version++) {
    const coords = ALIGNMENT_COORDS[version] ?? [];
    const first = coords[0];
    const last = coords[coords.length - 1];
    const centers: number[][] = [];
    for (const r of coords) {
      for (const c of coords) {
        const isTopLeft = r === first && c === first;
        const isTopRight = r === first && c === last;
        const isBottomLeft = r === last && c === first;
        if (isTopLeft || isTopRight || isBottomLeft) continue;
        centers.push([r, c]);
      }
    }
    table[version] = centers;
  }
  return table;
})();

// Mask patterns - 8 different masks
export function applyMask(modules: boolean[][], mask: number, version: number): void {
  const size = 4 * version + 17;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isInFunctionArea(r, c, version)) continue;

      let shouldInvert = false;
      switch (mask) {
        case 0: // (i + j) % 2 === 0
          shouldInvert = (r + c) % 2 === 0;
          break;
        case 1: // i % 2 === 0
          shouldInvert = r % 2 === 0;
          break;
        case 2: // j % 3 === 0
          shouldInvert = c % 3 === 0;
          break;
        case 3: // (i + j) % 3 === 0
          shouldInvert = (r + c) % 3 === 0;
          break;
        case 4: // (i/2 + j/3) % 2 === 0
          shouldInvert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
          break;
        case 5: // (i*j) % 2 + (i*j) % 3 === 0
          shouldInvert = ((r * c) % 2) + ((r * c) % 3) === 0;
          break;
        case 6: // ((i*j) % 2 + (i*j) % 3) % 2 === 0
          shouldInvert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
          break;
        case 7: // ((i+j) % 2 + (i*j) % 3) % 2 === 0
          shouldInvert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
          break;
      }

      if (shouldInvert) {
        const row = modules[r];
        if (row) {
          row[c] = !row[c];
        }
      }
    }
  }
}

// Determine if a module is part of a function pattern
export function isInFunctionArea(r: number, c: number, version: number): boolean {
  const size = 4 * version + 17;

  // Finder patterns and separators: 7x7 + 1 wide separator
  // Top-left: rows 0-7, cols 0-7
  if (r < 8 && c < 8) return true;
  // Top-right: rows 0-7, cols (size-8) to (size-1)
  if (r < 8 && c >= size - 8) return true;
  // Bottom-left: rows (size-8) to (size-1), cols 0-7
  if (r >= size - 8 && c < 8) return true;

  // Timing patterns: row 6 and column 6
  if (r === 6 || c === 6) return true;

  // Dark module: always at (4*v+9, 8)
  if (r === 4 * version + 9 && c === 8) return true;

  // Alignment patterns (version 2+)
  if (version >= 2) {
    const alignmentCenters = ALIGNMENT_PATTERNS[version] ?? [];
    for (const pair of alignmentCenters) {
      const ar = pair[0];
      const ac = pair[1];
      if (ar !== undefined && ac !== undefined) {
        if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
      }
    }
  }

  // Format information areas
  // Top-left horizontal: row 8, cols 0-8 (except col 6)
  if (r === 8 && c < 9) return true;
  // Top-left vertical: col 8, rows 0-8 (except row 6)
  if (c === 8 && r < 9) return true;
  // Top-right: row 8, cols (size-8) to (size-1)
  if (r === 8 && c >= size - 8) return true;
  // Bottom-left: col 8, rows (size-7) to (size-1)
  if (c === 8 && r >= size - 7) return true;

  // Version information (version 7+)
  if (version >= 7) {
    // Bottom-left: rows (size-11) to (size-9), cols 0-5
    if (r >= size - 11 && r <= size - 9 && c <= 5) return true;
    // Top-right: rows 0-5, cols (size-11) to (size-9)
    if (r <= 5 && c >= size - 11 && c <= size - 9) return true;
  }

  return false;
}

// BCH(15, 5) for format information
export function bchFormat(data: number): number {
  const generator = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + 1
  let result = data << 10;

  for (let i = 4; i >= 0; i--) {
    if ((result & (1 << (i + 10))) !== 0) {
      result ^= generator << i;
    }
  }

  return result & 0x3ff;
}

// BCH(18, 6) for version information
export function bchVersion(version: number): number {
  const generator = 0x1f25; // x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1
  let result = version << 12;

  for (let i = 5; i >= 0; i--) {
    if ((result & (1 << (i + 12))) !== 0) {
      result ^= generator << i;
    }
  }

  return result & 0xfff;
}
