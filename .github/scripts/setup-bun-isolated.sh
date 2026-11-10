#!/bin/sh
# Install Bun into $RUNNER_TEMP so parallel jobs on the same Mac mini
# do not overwrite a shared ~/.bun (oven-sh/setup-bun's default). The perf
# gate records Bun.version per revision; a mid-job overwrite looks like an
# environment mismatch and fails the compare.
#
# Unset BUN_VERSION installs canary, which is what the existing jobs use.
# A job that must not float sets BUN_VERSION (for example 1.4.4) and
# BUN_SHA256, the SHASUMS256.txt line for bun-darwin-aarch64.zip. Canary has
# no stable checksum, so a checksum set for canary is refused.
set -eu

VERSION="${BUN_VERSION:-canary}"
case "$VERSION" in
  canary)
    if [ -n "${BUN_SHA256:-}" ]; then
      echo "BUN_SHA256 cannot be set for the unpinned canary" >&2
      exit 1
    fi
    URL="https://github.com/oven-sh/bun/releases/download/canary/bun-darwin-aarch64.zip"
    ;;
  *)
    if [ -z "${BUN_SHA256:-}" ]; then
      echo "BUN_SHA256 is required when BUN_VERSION is set" >&2
      exit 1
    fi
    URL="https://github.com/oven-sh/bun/releases/download/bun-v${VERSION}/bun-darwin-aarch64.zip"
    ;;
esac

DEST="$RUNNER_TEMP/bun"
mkdir -p "$DEST"
curl -fsSL "$URL" -o "$DEST/bun.zip"
if [ -n "${BUN_SHA256:-}" ]; then
  actual=$(shasum -a 256 "$DEST/bun.zip")
  actual=${actual%% *}
  if [ "$actual" != "$BUN_SHA256" ]; then
    echo "bun archive checksum mismatch: got $actual want $BUN_SHA256" >&2
    exit 1
  fi
fi
unzip -o -q "$DEST/bun.zip" -d "$DEST"
BIN="$DEST/bun-darwin-aarch64/bun"
if [ ! -f "$BIN" ]; then
  echo "bun binary missing after extract" >&2
  exit 1
fi
chmod +x "$BIN"
# The zip ships only `bun` (canary and the pinned releases). setup-bun also linked `bunx`.
ln -sf bun "$(dirname "$BIN")/bunx"
# Isolate bun's own home (install cache, etc.) from the shared ~/.bun.
echo "BUN_INSTALL=$DEST/home" >> "$GITHUB_ENV"
echo "$(dirname "$BIN")" >> "$GITHUB_PATH"
"$BIN" --revision
