`sRGB-v2-micro.icc`: from https://github.com/saucecontrol/Compact-ICC-Profiles, CC0 1.0 (public domain). Used as the PDF/A output intent.

Fonts, from npm, embedded as subsets when a PDF is drawn:

- DejaVu Sans Condensed (regular, bold) and DejaVu Sans Mono – `dejavu-fonts-ttf`, Bitstream Vera / DejaVu licence.
- Noto Sans Arabic – `@expo-google-fonts/noto-sans-arabic`, SIL Open Font License 1.1.

## Chain marks (`logos/`)

Drawn only when a document is asked for its `logo`: small, beside the title, next to the chain's name – to tell the receipts apart in a stack, never as if the network issued the document (the Eigenbeleg says who issues it). Each mark was taken from the network's own site on 2026-11-07, rasterised once with Chromium to 192 × 192 px on white (no transparency, so a PDF/A gets an opaque RGB image) and committed as it is; the SVG sources are not kept here. The marks are their owners' trademarks, used here to name the chain, unchanged, as their brand pages allow; they are not under this package's licence.

| File | Source | Terms |
| --- | --- | --- |
| `near.png` | NEAR's mark, `favicon.svg` of docs.near.org (the NEAR Foundation's documentation site) | NEAR Foundation brand use: the logo for naming NEAR in articles and products, unchanged, with clear space; not as one's own avatar or brand |
| `akash.png` | The Akash sign, the three triangles of `akash-logo.svg` in the official logo kit, https://akash.network/brand/resources (`akash-logos.zip`) | "Akash Network's trademarks, logos, and brand elements should be used without any changes, and their sole purpose is to represent Akash Network." (brand page) |
| `filecoin.png` | `filecoin-mark.svg` from https://filecoin.io/assets/brand/ | Filecoin Foundation brand assets, for naming Filecoin, unchanged |
| `aleph.png` | `favicon.svg` of https://aleph.cloud/ (the Aleph Cloud mark) | Aleph Cloud's mark, for naming Aleph Cloud, unchanged |
