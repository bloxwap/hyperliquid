# CI runners

Jobs in this repository run on self-hosted Apple Silicon Mac minis.

```yaml
runs-on: [self-hosted, macOS, ARM64]
```

The runner must carry those three labels exactly. Workflows do not use `apt`, `sudo`, Homebrew, or Docker.

## Not migrated

`security.yml` calls Google's `osv-scanner-reusable.yml`. That reusable workflow pins `runs-on: ubuntu-latest` and a Linux container internally. This repository cannot set its runner, so the OSV scan stays on GitHub-hosted Ubuntu.

## What the runner must already have

Install these on the Mac mini before registering the GitHub Actions runner. Workflows never elevate privileges.

| Tool | Why |
| --- | --- |
| macOS on Apple Silicon | Matches the `macOS` and `ARM64` labels. |
| GitHub Actions runner | Registered with labels `self-hosted`, `macOS`, `ARM64`. |
| Xcode Command Line Tools | `git`, `clang`, and the headers native packages (Bun, sharp, Playwright) expect. |
| `curl`, `tar`, `sed`, `shasum`, `bash`, `tee` | Stock macOS. Workflow scripts stay BSD-portable and write scratch files under `$RUNNER_TEMP` (exported as `TMPDIR` via `$GITHUB_ENV` in a setup step; job-level `env` cannot use the `runner` context). |

Do not install CI tools with `apt` or `sudo` for these workflows. Homebrew is not required.

The runner currently lacks **`gpg`**. `codecov/codecov-action` refuses to start without it (it GPG-checks the Codecov CLI). These workflows do not need host `gpg`: they pin-download `codecovcli_macos` v11.3.1 and SHA256-verify it, the same way they install lychee. Sibling repos that still call `codecov-action` directly will need `gpg` on the Mac mini (GnuPG, on `PATH`). This repository also does not need host `gh`, `gtar`, or `jq`.

The runner user must be able to write the workspace and `$RUNNER_TEMP`. The machine needs enough free disk for a Bun install, a perf worktree, and Playwright's Chromium download (a few gigabytes in total).

## What workflows install themselves

These are not machine prerequisites. The jobs fetch them into the job environment or `$RUNNER_TEMP`:

- **Bun canary** — `oven-sh/setup-bun` on every job that runs workspace scripts.
- **Node.js 24** — `actions/setup-node` on the npm publish job only (OIDC trusted publishing needs npm ≥ 11.5.1).
- **Playwright Chromium** — `bunx playwright install chromium` in the docs job. `--with-deps` is omitted; that flag installs Linux apt packages. Chromium's macOS libraries ship with the OS. The first docs run downloads the browser into Playwright's cache on the runner.
- **lychee v0.24.2** (`aarch64-apple-darwin`) — downloaded into `$RUNNER_TEMP`, checksum-verified, and used for the same Markdown link scan as before. The `lychee-action` composite only ships a Linux GNU binary.
- **Codecov CLI v11.3.1** (`codecovcli_macos`, universal x86_64/arm64) — downloaded into `$RUNNER_TEMP`, checksum-verified, and used for the same `upload-coverage` call as `codecov-action` (`--file`, `--disable-search`, `--fail-on-error`). The action is not used because it requires host `gpg`.

## Network egress

The runner needs outbound HTTPS to:

- `github.com` (checkout, Actions APIs, Pages deploy, lychee release assets, OIDC)
- the Bun and npm registries
- Playwright's browser CDN
- `codecov.io` and `coveralls.io` (coverage uploads)
- Hyperliquid testnet (the online test job)
- `registry.npmjs.org` (publish)

## Secrets

Unchanged: `CODECOV_TOKEN`, `PRIVATE_KEY` (online tests), and the default `GITHUB_TOKEN`. npm publish uses OIDC trusted publishing (`id-token: write`), not an npm token.

## Jobs

| Workflow | Job | Runner |
| --- | --- | --- |
| `code_quality.yml` | `quality` | self-hosted Mac mini |
| `coverage.yml` | `coverage` | self-hosted Mac mini |
| `docs.yml` | `docs` | self-hosted Mac mini |
| `docs.yml` | `deploy` | self-hosted Mac mini |
| `perf.yml` | `perf` | self-hosted Mac mini |
| `publish_npm.yml` | `publish` | self-hosted Mac mini |
| `tests_offline.yml` | `test` | self-hosted Mac mini |
| `tests_online.yml` | `test` | self-hosted Mac mini |
| `security.yml` | `osv-scan` | GitHub-hosted Ubuntu (Google reusable workflow) |
