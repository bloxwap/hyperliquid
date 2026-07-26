# Security Policy

## Supported Versions

This SDK is pre-`1.0.0` and ships fixes in new minor releases (see
[Versioning](README.md#versioning)). Only the **latest minor release** receives security fixes — once `0.(N+1).x` is
published, `0.N.x` no longer gets patched. Always upgrade to the latest release for security fixes.

## For Issues in Hyperliquid

If you have discovered a vulnerability or security issue related to the Hyperliquid service (e.g., buffer overflow, SQL
injection, cross-site scripting, etc.), please refer to the
[Hyperliquid Security Policy](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/SECURITY.md).

## For Issues in this SDK

If you found a security problem in this SDK itself, report it privately at
https://github.com/bloxwap/hyperliquid/security/advisories/new.

### Response timeline

- **Acknowledgement** of your report within 3 business days.
- **Triage and severity assessment** within 7 days, including whether the report is accepted.
- **Fix**: critical issues (key leakage, signature forgery, supply-chain compromise) are patched and released as soon
  as possible; lower-severity issues ship with the next scheduled release.

Please do not open public issues or pull requests for undisclosed vulnerabilities.

## Dependency auditing

`bun audit` skips every `@jsr/*` package ("do not come from the default registry"), and this repository resolves
crypto-critical dependencies (`@noble/hashes`, `valibot`) through JSR in `.dev/ts7`. CI therefore runs
[OSV-Scanner](https://google.github.io/osv-scanner/) (`.github/workflows/security.yml`, pinned by commit SHA) over
both `bun.lock` and `.dev/ts7/bun.lock` on every pull request and weekly; the job fails when any known vulnerability
is found.

Known residual gap (verified 2026-07-26 against OSV-Scanner v2.4.0): OSV has no JSR ecosystem, and the
`@jsr/scope__name` aliases in `bun.lock` do not match npm advisories — e.g. `@jsr/valibot__valibot@1.4.1` is not
flagged although npm `valibot@1.4.1` maps to [GHSA-5qjj-4xww-7phc](https://osv.dev/GHSA-5qjj-4xww-7phc). npm-named
packages in both lockfiles (the vast majority, including all npm transitives) are covered; JSR-aliased entries are
extracted and queried but only match if OSV ever learns the alias.
