# HIG plain CSS distribution

Pinned candidate: HIG 0.1.0, bloxwap/hig commit
`1a776b9326c6ba03702894943b3edbfd178c4b40` (main, 2026-10-13).

The migration kit permits the plain CSS distribution for shared presentation.
No npm release exists; this private local package distributes the two upstream
CSS files unchanged, with their MIT license. It has no runtime dependencies.

- `tokens.css`: `packages/tokens/generated/tokens.css`, SHA-256
  `1c60086af561070fdc1ee6056d6bc43bd8eed78614c318d466ee3850dc317609`
- `styles.css`: `packages/react/src/styles.css`, SHA-256
  `f0ef3dd51ae6a67a34bf32fc20a4949c5a39ec5b0de4ad2c3813a28c2cdfad49`

Update from a reviewed HIG commit, replace both files byte for byte, update
these hashes/version and rerun the production export and browser tests.
Do not hand-edit this distribution. Consumer aliases live in app/global.css.
Replace this local distribution with official package imports after #32 ships.
