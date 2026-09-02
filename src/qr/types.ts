export type EccLevel = "L" | "M" | "Q" | "H";
export type QrMatrix = {
  readonly size: number;      // modules per side, excluding any quiet zone
  readonly version: number;   // QR version, 1..10
  readonly ecc: EccLevel;
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>; // row-major; true = dark
};
