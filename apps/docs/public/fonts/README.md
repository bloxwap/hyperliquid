# Documentation fonts

Web body text uses Bloxwap Sans and code uses Bloxwap Mono from the exact
`@bloxwap/font@0.1.1` dependency. The Next.js exports self-host variable weights
100–900, italics, and script companions without requests to Google Fonts.
Space Grotesk Bold remains the heading face, with its adjacent OFL notice.

`BloxwapSans-Bold.ttf` (700) and `BloxwapSans-Black.ttf` (900) are static
instances of `fonts/BloxwapSans/BloxwapSans-Variable.woff2` from the published
`@bloxwap/font@0.1.1` npm tarball. FontTools 4.66.1 `instantiateVariableFont`
sets `wght` to 700/900 and removes WOFF2 compression (`font.flavor = None`)
for the Open Graph renderer. Keep `Bloxwap-OFL.txt` with these derived faces.
