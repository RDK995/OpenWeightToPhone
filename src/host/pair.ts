import { readToken, resolveBaseUrl, pairingUrlWithToken } from "./config.ts";
import { encodeQr } from "../qr/encode.ts";
import { renderToAnsi } from "../qr/render.ts";

/**
 * Renders the pairing information (QR code and base URL).
 * This function is exported for testability.
 */
export function renderPairing(deps: {
  token: string;
  baseUrl: string;
  showUrl?: boolean;
}): string {
  const pairingUrl = pairingUrlWithToken(deps.token, {
    OPENWEIGHT_HARNESS_BASE_URL: deps.baseUrl,
  });

  const matrix = encodeQr(pairingUrl, { ecc: "M" });
  const qrRendered = renderToAnsi(matrix);

  let output =
    qrRendered +
    "\n\n" +
    deps.baseUrl +
    "\n\n" +
    "Scan this QR code with your phone to pair this machine.\n";

  if (deps.showUrl) {
    output +=
      "\n" +
      "WARNING: The following URL contains a secret token. Do not share it.\n" +
      pairingUrl +
      "\n";
  }

  return output;
}

/**
 * Parses CLI arguments to extract pairing options.
 * @param argv User arguments (what you get from process.argv.slice(2))
 * @returns Object with parsed options
 * @throws Error if an unknown argument is provided
 */
export function parsePairArgs(argv: string[]): { showUrl: boolean } {
  let showUrl = false;

  for (const arg of argv) {
    if (arg === "--show-url") {
      showUrl = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { showUrl };
}

/**
 * Main entry point for the pair CLI.
 */
async function main() {
  try {
    const args = parsePairArgs(process.argv.slice(2));
    const token = readToken();
    const baseUrl = resolveBaseUrl();

    const output = renderPairing({ token, baseUrl, showUrl: args.showUrl });
    console.log(output);
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(errorMessage);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
