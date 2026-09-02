import type { QrMatrix } from "./types.ts";

/**
 * Renders a QR matrix to an ANSI string that displays as a scannable QR code in a terminal.
 *
 * Uses half-block rendering: each output line encodes two matrix rows using half-block
 * characters (█, ▀, ▄, space). This results in a square-ish code rather than one that's
 * twice as tall as it is wide.
 *
 * Dark modules render dark and light modules render light against the terminal's actual
 * background by using explicit ANSI color codes: white background and black foreground
 * for the entire block, reset at the end of each line. This ensures correct rendering
 * on both light and dark terminal themes.
 *
 * The output is invertible: parsing the rendered text back through the block characters
 * reconstructs the original matrix exactly.
 */
export function renderToAnsi(
  matrix: QrMatrix,
  options?: { quietZone?: number }
): string {
  const quietZone = options?.quietZone ?? 4;

  // Add quiet zone: white border of requested width
  const withQuietZone = addQuietZone(matrix, quietZone);

  // Render using half-block characters
  return renderHalfBlocks(withQuietZone);
}

// Add quiet zone padding to the matrix
function addQuietZone(matrix: QrMatrix, quietZone: number): boolean[][] {
  const size = matrix.size;
  const paddedSize = size + 2 * quietZone;

  const padded: boolean[][] = Array.from({ length: paddedSize }, () =>
    Array(paddedSize).fill(false)
  );

  // Copy original matrix into the center, with quiet zone of false values around
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const row = matrix.modules[i];
      if (row !== undefined) {
        const value = row[j];
        if (value !== undefined) {
          padded[i + quietZone]![j + quietZone] = value;
        }
      }
    }
  }

  return padded;
}

// Render a matrix to half-block characters with ANSI color codes
function renderHalfBlocks(matrix: boolean[][]): string {
  const lines: string[] = [];
  const rows = matrix.length;

  // ANSI codes for white background and black foreground
  const colorStart = "\x1b[47;30m";
  const colorReset = "\x1b[0m";

  // Process rows in pairs
  for (let i = 0; i < rows; i += 2) {
    const topRow = matrix[i];
    const bottomRow = i + 1 < rows ? matrix[i + 1] : undefined;

    // If bottom row is undefined, it's because we have an odd number of rows
    // In this case, we treat the missing row as all light (false)
    if (topRow === undefined) {
      break;
    }

    const cols = topRow.length;
    let line = colorStart;

    for (let j = 0; j < cols; j++) {
      const topValue = topRow[j];
      const bottomValue = bottomRow ? bottomRow[j] : false;

      // Determine which block character to use
      if (topValue && bottomValue) {
        line += "█"; // both dark
      } else if (topValue && !bottomValue) {
        line += "▀"; // top dark, bottom light
      } else if (!topValue && bottomValue) {
        line += "▄"; // top light, bottom dark
      } else {
        line += " "; // both light
      }
    }

    line += colorReset;
    lines.push(line);
  }

  return lines.join("\n");
}
