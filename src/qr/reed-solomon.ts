// GF(256) arithmetic for Reed-Solomon error correction
// Primitive polynomial: 0x11D, Generator element: 2

// Build exp and log tables at module load
const PRIM_POLY = 0x11d;
const GENERATOR = 2;

// Initialize exp and log tables
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

function initFieldTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;

    x = x << 1;
    if (x >= 256) {
      x ^= PRIM_POLY;
    }
  }

  // Extend exp table for easier lookup (cyclic)
  for (let i = 255; i < 512; i++) {
    const prevVal = gfExp[i - 255];
    // For i = 255-509, this reads from gfExp[0-254] which are initialized.
    // For i = 510-511, this reads uninitialized indices (unreachable in practice).
    gfExp[i] = prevVal ?? 0;
  }

  // gfLog[0] is undefined in GF(256); set to 0 for convenience
  gfLog[0] = 0;
}

// Initialize tables once at module load
initFieldTables();

/**
 * Multiply two elements in GF(256) with primitive polynomial 0x11D
 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }

  const logA = gfLog[a] ?? 0;
  const logB = gfLog[b] ?? 0;
  const expIdx = (logA + logB) % 255;
  const result = gfExp[expIdx];
  return result ?? 0;
}

/**
 * Generate the QR generator polynomial of the given degree.
 * Returns coefficients highest-order first, with leading coefficient 1.
 * Degree n polynomial has n+1 coefficients.
 * Roots are at α^0, α^1, ..., α^(degree-1).
 */
export function generatorPoly(degree: number): Uint8Array {
  // Generator polynomial for Reed-Solomon is:
  // g(x) = (x - α^0)(x - α^1)...(x - α^(degree-1))
  // where α = 2 (generator element in GF(256))

  // Start with g(x) = 1 (constant polynomial)
  const poly = new Uint8Array(degree + 1);
  poly[0] = 1;

  // Multiply by each (x - α^i) for i = 0 to degree-1
  for (let i = 0; i < degree; i++) {
    const alpha_i = gfExp[i] ?? 0;

    // Multiply current polynomial by (x - α^i)
    // If poly = [p0, p1, ..., p(i-1)] represents p0*x^i + p1*x^(i-1) + ... + p(i-1),
    // then (x - α^i) * poly = [p0, p1^α^i*p0, p2^α^i*p1, ..., p(i-1)^α^i*p(i-2), α^i*p(i-1)]
    // Process from right to left to avoid overwriting values we still need
    for (let j = i + 1; j >= 1; j--) {
      const pj = poly[j] ?? 0;
      const pj_minus_1 = poly[j - 1] ?? 0;
      poly[j] = (pj ^ gfMul(alpha_i, pj_minus_1)) as number;
    }
    // poly[0] (the leading coefficient) stays the same
  }

  return poly;
}

/**
 * Encode data to produce ecLen error-correction codewords.
 * Returns exactly ecLen error-correction codewords.
 * Does not mutate the input data.
 */
export function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  if (ecLen < 1) {
    throw new Error("ecLen must be at least 1");
  }

  // Get the generator polynomial
  const gen = generatorPoly(ecLen);

  // Create a working buffer: data + ecLen zeros for the remainder
  // We work with message polynomial where data[0] is the highest-order coefficient
  const msgLen = data.length + ecLen;
  const msg = new Uint8Array(msgLen);

  // Copy data into the message buffer
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    msg[i] = byte ?? 0;
  }

  // Polynomial long division: divide msg by gen to get remainder
  // The remainder will be the error correction codewords
  for (let i = 0; i < data.length; i++) {
    const coeff = msg[i] ?? 0;

    if (coeff === 0) {
      continue;
    }

    // Multiply generator by coeff and subtract from msg
    // Since gen[0] should be 1, we're essentially shifting and adding
    for (let j = 0; j < ecLen + 1; j++) {
      const genCoeff = gen[j] ?? 0;
      const product = gfMul(genCoeff, coeff);
      const msgIdx = i + j;
      const msgByte = msg[msgIdx] ?? 0;
      msg[msgIdx] = (msgByte ^ product) as number;
    }
  }

  // Extract the remainder (last ecLen bytes)
  const result = new Uint8Array(ecLen);
  for (let i = 0; i < ecLen; i++) {
    const byte = msg[data.length + i];
    result[i] = byte ?? 0;
  }

  return result;
}
