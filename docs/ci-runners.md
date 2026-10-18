# CI runners

Every GitHub Actions job in this repository runs on self-hosted Apple Silicon Mac minis.

```yaml
runs-on: [self-hosted, macOS, ARM64]
```

The runner must carry those three labels exactly. Workflows do not use `apt`, `sudo`, Homebrew, or Docker.

## Trusted publishing is unavailable

[npm trusted publishing does not support self-hosted runners](https://docs.npmjs.com/trusted-publishers/). The publish job therefore authenticates with the org-level `NPM_TOKEN` secret (`NODE_AUTH_TOKEN`). That **drops OIDC trusted publishing and automatic provenance**.

## What the runner must already have

Install these on the Mac mini before registering the GitHub Actions runner. Workflows never elevate privileges.

| Tool | Why |
| --- | --- |
| macOS on Apple Silicon | Matches the `macOS` and `ARM64` labels. |
| GitHub Actions runner | Registered with labels `self-hosted`, `macOS`, `ARM64` (runner group JWS). |
| Xcode Command Line Tools | `git`, `clang`, and the headers native packages (Bun, sharp, Playwright) expect. |
| `curl`, `tar`, `unzip`, `sed`, `shasum`, `bash`, `tee` | Stock macOS. Workflow scripts stay BSD-portable and write scratch files under `$RUNNER_TEMP` (exported as `TMPDIR` via `$GITHUB_ENV` in a setup step; job-level `env` cannot use the `runner` context). |

Do not install CI tools with `apt` or `sudo` for these workflows. Homebrew is not required for this repository.

The runner currently also has **`gpg`** (GnuPG), **`gh`**, and **`gtar`** (Homebrew `gnu-tar`). This repository does not call them: Codecov uses a pinned CLI, publish reads the version with Bun, and archives use stock `tar`. Sibling repos that call `codecov-action` or `actions/upload-pages-artifact` directly need those host tools.

`actions/setup-python` cannot install on these minis (`/Users/runner` is not writable). This repository does not need Python.

The runner user must be able to write the workspace and `$RUNNER_TEMP`. The machine needs enough free disk for a Bun install, a perf worktree, and Playwright's Chromium download (a few gigabytes in total).

## What workflows install themselves

These are not machine prerequisites. The jobs fetch them into the job environment or `$RUNNER_TEMP`:

- **Bun canary** — downloaded into `$RUNNER_TEMP` (`bun-darwin-aarch64` zip) on every job that runs workspace scripts. `oven-sh/setup-bun` is not used: it installs into `~/.bun`, which is shared across runner instances on the same Mac mini, and a mid-job overwrite makes the perf gate see two Bun versions.
- **Node.js 24** — `actions/setup-node` on the npm publish job only (the npm CLI used to publish `@bloxwap/hyperliquid`).
- **Playwright Chromium** — `bunx playwright install chromium` in the docs job. `--with-deps` is omitted; that flag installs Linux apt packages. Chromium's macOS libraries ship with the OS. The first docs run downloads the browser into Playwright's cache on the runner.
- **lychee v0.24.2** (`aarch64-apple-darwin`) — downloaded into `$RUNNER_TEMP`, checksum-verified, and used for the same Markdown link scan as before. The `lychee-action` composite only ships a Linux GNU binary.
- **Codecov CLI v11.3.1** (`codecovcli_macos`, universal x86_64/arm64) — downloaded into `$RUNNER_TEMP`, checksum-verified, and used for the same `upload-coverage` call as `codecov-action` (`--file`, `--disable-search`, `--fail-on-error`). The action is not used because it requires host `gpg`.
- **OSV-Scanner v2.3.8** (`osv-scanner_darwin_arm64`) — downloaded into `$RUNNER_TEMP`, checksum-verified, and used for the same lockfile scan as `google/osv-scanner-action` v2.3.8 (`bun.lock` and `packages/hyperliquid/.dev/ts7/bun.lock`, fail on any vulnerability). The reusable workflow pins `ubuntu-latest` and a Linux container, so it cannot run here.

## Network egress

The runner needs outbound HTTPS to:

- `github.com` (checkout, Actions APIs, Pages deploy, lychee / OSV-Scanner / Codecov CLI release assets)
- the Bun and npm registries
- Playwright's browser CDN
- `codecov.io` and `coveralls.io` (coverage uploads)
- Hyperliquid testnet (the online test job)
- `registry.npmjs.org` (publish)
- `api.osv.dev` (OSV vulnerability queries)

## Secrets

Unchanged: `CODECOV_TOKEN`, `PRIVATE_KEY` (online tests), and the default `GITHUB_TOKEN`. npm publish uses the org-level `NPM_TOKEN` secret (`NODE_AUTH_TOKEN`), not OIDC trusted publishing.

## Jobs

| Workflow | Job | Runner |
| --- | --- | --- |
| `code_quality.yml` | `quality` | self-hosted Mac mini |
| `coverage.yml` | `coverage` | self-hosted Mac mini |
| `docs.yml` | `docs` | self-hosted Mac mini |
| `docs.yml` | `deploy` | self-hosted Mac mini |
| `perf.yml` | `perf` | self-hosted Mac mini |
| `publish_npm.yml` | `publish` | self-hosted Mac mini; `NPM_TOKEN`; release / workflow_dispatch |
| `tests_offline.yml` | `test` | self-hosted Mac mini |
| `tests_online.yml` | `test` | self-hosted Mac mini |
| `security.yml` | `osv-scan` | self-hosted Mac mini |
