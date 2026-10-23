#!/bin/sh
# Pin-download the official macOS Codecov CLI and upload one lcov file.
# codecov-action requires host `gpg` to verify its downloaded CLI; these Mac minis
# do not have gpg. SHA256 of codecovcli_macos v11.3.1 matches cli.codecov.io.
set -eu

FILE=$1
VERSION=v11.3.1
EXPECTED_SHA256=ffb2b821551076b69d3267508b2d5dc10925c821c436521f2216f5ead62cb138
DEST="$RUNNER_TEMP/codecov"
BIN="$DEST/codecov"

mkdir -p "$DEST"
curl -fsSL "https://github.com/codecov/codecov-cli/releases/download/${VERSION}/codecovcli_macos" \
  -o "$BIN"
actual=$(shasum -a 256 "$BIN")
actual=${actual%% *}
if [ "$actual" != "$EXPECTED_SHA256" ]; then
  echo "codecov CLI checksum mismatch: got $actual want $EXPECTED_SHA256" >&2
  exit 1
fi
chmod +x "$BIN"

"$BIN" upload-coverage \
  -t "$CODECOV_TOKEN" \
  --file "$FILE" \
  --disable-search \
  --fail-on-error \
  --git-service github
