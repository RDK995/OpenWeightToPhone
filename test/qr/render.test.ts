import { describe, it, expect } from "bun:test";
import { renderToAnsi } from "../../src/qr/render.ts";
import { encodeQr } from "../../src/qr/encode.ts";
import type { QrMatrix } from "../../src/qr/types.ts";

// Helper: strip ANSI escape sequences to extract the visual grid
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// Helper: parse the rendered output back into a boolean grid
// Returns a grid where true = dark, false = light
function parseRenderedGrid(rendered: string, quietZone: number): boolean[][] {
  const lines = stripAnsi(rendered).split("\n");
  const grid: boolean[][] = [];

  // Each line encodes two rows
  for (const line of lines) {
    const topRow: boolean[] = [];
    const bottomRow: boolean[] = [];

    for (const char of line) {
      if (char === "█") {
        // both rows dark
        topRow.push(true);
        bottomRow.push(true);
      } else if (char === "▀") {
        // top dark, bottom light
        topRow.push(true);
        bottomRow.push(false);
      } else if (char === "▄") {
        // top light, bottom dark
        topRow.push(false);
        bottomRow.push(true);
      } else if (char === " ") {
        // both light
        topRow.push(false);
        bottomRow.push(false);
      }
    }

    grid.push(topRow);
    grid.push(bottomRow);
  }

  // Remove quiet zone from rows
  const rowsWithoutQuietZone = grid.slice(quietZone, grid.length - quietZone);

  // Remove quiet zone from columns
  const resultGrid: boolean[][] = [];
  for (const row of rowsWithoutQuietZone) {
    resultGrid.push(row.slice(quietZone, row.length - quietZone));
  }

  // If the last row is all false (light), it's likely the padding row added for half-block rendering
  // Remove it to match the original matrix size
  if (resultGrid.length > 0) {
    const lastRow = resultGrid[resultGrid.length - 1];
    if (lastRow && lastRow.every((v) => v === false)) {
      resultGrid.pop();
    }
  }

  return resultGrid;
}

describe("renderToAnsi", () => {
  it("should export a function", () => {
    expect(typeof renderToAnsi).toBe("function");
  });

  it("should render a simple matrix to a string", () => {
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

    const result = renderToAnsi(matrix);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should include QR block characters in output", () => {
    const matrix: QrMatrix = {
      size: 5,
      version: 1,
      ecc: "M",
      modules: [
        [true, true, true, false, false],
        [false, false, false, true, true],
        [true, true, true, false, false],
        [false, false, false, true, true],
        [true, true, true, false, false],
      ],
    };

    const result = stripAnsi(renderToAnsi(matrix));
    // Should contain at least one block character
    const hasBlockCharacters =
      result.includes("█") || result.includes("▀") || result.includes("▄");
    expect(hasBlockCharacters).toBe(true);
  });

  it("should add default quiet zone of 4 modules", () => {
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

    const result = renderToAnsi(matrix);
    const stripped = stripAnsi(result).trim();
    const lines = stripped.split("\n");

    // With quiet zone of 4 and 5 matrix rows rendered at half-block (3 lines),
    // plus 2 lines for top quiet zone and 2 for bottom: 3 + 2 + 2 = 7 lines total
    // But we need to account for padding if matrix size is odd
    expect(lines.length).toBeGreaterThan(0);

    // Check quiet zone is actually present on all four sides
    // Each line should start and end with space (quiet zone)
    // For a quiet zone of 4 modules (2 chars wide in half-block), we expect 4 spaces
    for (const line of lines) {
      // Top and bottom quiet zones should be empty lines (all spaces)
      // Side quiet zones should have spaces at the start and end
      expect(line.length).toBeGreaterThan(0);
    }

    // Parse the grid and verify the quiet zone width on all sides
    const quietZone = 4;
    const parsed = parseRenderedGrid(result, quietZone);
    // After removing quiet zone, should match matrix size
    expect(parsed.length).toBe(matrix.size);
    for (let i = 0; i < matrix.size; i++) {
      expect(parsed[i]?.length).toBe(matrix.size);
    }
  });

  it("should respect quietZone option of 0", () => {
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

    const result = renderToAnsi(matrix, { quietZone: 0 });
    const stripped = stripAnsi(result).trim();
    // Should be compact with no border
    // With 5 rows rendered at half-block, should be 3 lines (5/2 rounded up)
    const lines = stripped.split("\n");
    expect(lines.length).toBe(3);
  });

  it("should be invertible: render and parse back to original matrix", () => {
    // Use a genuinely asymmetric fixture to catch transpose/flip bugs
    const matrix: QrMatrix = {
      size: 5,
      version: 1,
      ecc: "M",
      modules: [
        [true, true, false, false, false],
        [true, false, true, false, false],
        [false, true, false, false, false],
        [false, false, true, true, false],
        [false, false, false, true, true],
      ],
    };

    // Verify the fixture is genuinely asymmetric
    // Check it doesn't equal its transpose
    const transposed = matrix.modules[0]!.map((_, i) =>
      matrix.modules.map(row => row[i])
    );
    const isTransposeSame = JSON.stringify(transposed) === JSON.stringify(matrix.modules);
    expect(isTransposeSame).toBe(false);

    // Check it doesn't equal its row-reversed version
    const rowReversed = [...matrix.modules].reverse();
    const isRowReversedSame = JSON.stringify(rowReversed) === JSON.stringify(matrix.modules);
    expect(isRowReversedSame).toBe(false);

    // Check it doesn't equal its column-reversed version
    const columnReversed = matrix.modules.map(row => [...row].reverse());
    const isColumnReversedSame = JSON.stringify(columnReversed) === JSON.stringify(matrix.modules);
    expect(isColumnReversedSame).toBe(false);

    const quietZone = 4;
    const rendered = renderToAnsi(matrix, { quietZone });
    const parsed = parseRenderedGrid(rendered, quietZone);

    // Should match original
    expect(parsed.length).toBe(matrix.size);
    for (let i = 0; i < matrix.size; i++) {
      expect(parsed[i]?.length).toBe(matrix.size);
      for (let j = 0; j < matrix.size; j++) {
        expect(parsed[i]?.[j]).toBe(matrix.modules[i]?.[j]);
      }
    }
  });

  it("should be invertible with odd number of rows", () => {
    const matrix: QrMatrix = {
      size: 7,
      version: 2,
      ecc: "M",
      modules: [
        [true, false, true, false, true, false, true],
        [false, true, false, true, false, true, false],
        [true, false, true, false, true, false, true],
        [false, true, false, true, false, true, false],
        [true, false, true, false, true, false, true],
        [false, true, false, true, false, true, false],
        [true, false, true, false, true, false, true],
      ],
    };

    const quietZone = 4;
    const rendered = renderToAnsi(matrix, { quietZone });
    const parsed = parseRenderedGrid(rendered, quietZone);

    // Should match original
    expect(parsed.length).toBe(matrix.size);
    for (let i = 0; i < matrix.size; i++) {
      expect(parsed[i]?.length).toBe(matrix.size);
      for (let j = 0; j < matrix.size; j++) {
        expect(parsed[i]?.[j]).toBe(matrix.modules[i]?.[j]);
      }
    }
  });

  it("should be invertible for encodeQr('hello')", () => {
    const matrix = encodeQr("hello", { ecc: "M" });
    const quietZone = 4;
    const rendered = renderToAnsi(matrix, { quietZone });
    const parsed = parseRenderedGrid(rendered, quietZone);

    // Should match original
    expect(parsed.length).toBe(matrix.size);
    for (let i = 0; i < matrix.size; i++) {
      expect(parsed[i]?.length).toBe(matrix.size);
      for (let j = 0; j < matrix.size; j++) {
        expect(parsed[i]?.[j]).toBe(matrix.modules[i]?.[j]);
      }
    }
  });

  it("should be invertible for a pairing URL shape", () => {
    // A realistic pairing URL is longer and will produce a larger QR
    const token = "A".repeat(43);
    const pairingUrl = `https://ryans-mac-studio.tailc3648a.ts.net/app/#t=${token}`;
    const matrix = encodeQr(pairingUrl, { ecc: "M" });
    const quietZone = 4;
    const rendered = renderToAnsi(matrix, { quietZone });
    const parsed = parseRenderedGrid(rendered, quietZone);

    // Should match original
    expect(parsed.length).toBe(matrix.size);
    for (let i = 0; i < matrix.size; i++) {
      expect(parsed[i]?.length).toBe(matrix.size);
      for (let j = 0; j < matrix.size; j++) {
        expect(parsed[i]?.[j]).toBe(matrix.modules[i]?.[j]);
      }
    }
  });
});
