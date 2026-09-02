#!/bin/sh
# Thin wrapper around src/host/launch-agent.ts. All logic (including every
# launchctl invocation) lives in that TypeScript module so it is testable
# with an injected exec. This script only resolves paths and hands off.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
if [ -x "$BUN_BIN" ]; then
  BUN="$BUN_BIN"
elif command -v bun >/dev/null 2>&1; then
  BUN=$(command -v bun)
else
  echo "error: bun not found. Install it, or set BUN_BIN, or ensure ~/.bun/bin/bun exists." >&2
  exit 7
fi

exec "$BUN" run "$ROOT/src/host/launch-agent.ts" "$@"
