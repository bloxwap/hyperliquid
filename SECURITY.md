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
