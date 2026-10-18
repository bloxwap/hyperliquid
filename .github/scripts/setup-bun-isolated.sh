#!/bin/sh
# Install Bun canary into $RUNNER_TEMP so parallel jobs on the same Mac mini
# do not overwrite a shared ~/.bun (oven-sh/setup-bun's default). The perf
# gate records Bun.version per revision; a mid-job overwrite looks like an
# environment mismatch and fails the compare.
set -eu

DEST="$RUNNER_TEMP/bun"
mkdir -p "$DEST"
curl -fsSL "https://github.com/oven-sh/bun/releases/download/canary/bun-darwin-aarch64.zip" \
  -o "$DEST/bun.zip"
unzip -o -q "$DEST/bun.zip" -d "$DEST"
BIN="$DEST/bun-darwin-aarch64/bun"
if [ ! -f "$BIN" ]; then
  echo "bun binary missing after extract" >&2
  exit 1
fi
chmod +x "$BIN"
# The canary zip ships only `bun`. setup-bun also linked `bunx` (same binary).
ln -sf bun "$(dirname "$BIN")/bunx"
# Isolate bun's own home (install cache, etc.) from the shared ~/.bun.
echo "BUN_INSTALL=$DEST/home" >> "$GITHUB_ENV"
echo "$(dirname "$BIN")" >> "$GITHUB_PATH"
"$BIN" --revision
