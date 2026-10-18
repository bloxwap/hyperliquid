#!/bin/sh
# Pin-download OSV-Scanner v2.3.8 for darwin-arm64 and scan the same lockfiles
# as google/osv-scanner-action's reusable workflow. That callee pins
# `runs-on: ubuntu-latest` and a Linux container, so it cannot run on these
# Mac minis. The standalone binary is the same scanner version.
#
# Fail closed on any vulnerability (scanner exit 1). Results stay in the
# workspace so the workflow can upload them even when the scan fails.
set -eu

VERSION=v2.3.8
ARCHIVE=osv-scanner_darwin_arm64
EXPECTED_SHA256=a8cd6507b06239f463a7642430cfd2d154882f150f6e30cdc0653e28dfc34216
DEST="$RUNNER_TEMP/osv-scanner"
BIN="$DEST/osv-scanner"
RESULTS="${OSV_RESULTS:-$GITHUB_WORKSPACE/osv-results.json}"

mkdir -p "$DEST"
curl -fsSL "https://github.com/google/osv-scanner/releases/download/${VERSION}/${ARCHIVE}" \
  -o "$BIN"
actual=$(shasum -a 256 "$BIN")
actual=${actual%% *}
if [ "$actual" != "$EXPECTED_SHA256" ]; then
  echo "osv-scanner checksum mismatch: got $actual want $EXPECTED_SHA256" >&2
  exit 1
fi
chmod +x "$BIN"

# Same lockfiles as security.yml previously passed to the reusable workflow.
# Known residual gap (verified 2026-07-26 against OSV-Scanner v2.4.0): OSV has
# no JSR ecosystem, and @jsr/scope__name aliases do not match npm advisories.
# npm-named packages (the vast majority, including npm transitives) are covered.
set +e
"$BIN" \
  --format json \
  --output "$RESULTS" \
  --lockfile=bun.lock \
  --lockfile=packages/hyperliquid/.dev/ts7/bun.lock
status=$?
set -e

if [ ! -s "$RESULTS" ]; then
  echo "osv-scanner produced no results at $RESULTS" >&2
  exit 1
fi

exit "$status"
