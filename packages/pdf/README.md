# @le-space/pdf

PDF/A-2b for Le Space's tools – [Belege](https://github.com/Le-Space/belege) and the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI – on [pdf-lib](https://pdf-lib.js.org). Runs in a browser and in Node; the same document is the same file in both.

- **Text in any script** (`pdfFonts(pdf)` → `{ regular, bold, mono }`): each face measures (`width`) and draws (`draw`) a line in runs, each in the font that has its letters – DejaVu Sans Condensed (Latin, Cyrillic, Greek), Noto Sans Arabic (shaped, right to left, numbers left to right), DejaVu Sans Mono for hashes and addresses. A letter no font has is a `?`; control and format characters (bidi overrides) are dropped (`pdfText`). `wrapText(text, face, size, width)` wraps at spaces and breaks a word wider than the line without cutting it.
- **PDF/A-2b** (`createPdfA()` → `{ pdf, fonts }`, `savePdfA(pdf, meta)`, `makePdfA(pdf, meta)`): every font embedded as a subset, the document info and XMP metadata from the same values (`title`, `author`, `subject`, `creator`, `producer`, `created`, `language`), an sRGB output intent, a document id from a seed (SHA-256), never from the clock or chance.
- **Font bytes and the chains' marks** (`asset(name)`, `LOGOS[chain]`): Node reads them from the installed font packages and `assets/`; a browser build (the `browser` condition of `#load-asset`) fetches them – Vite copies them next to the page (`?url`), and they are loaded only when a PDF is drawn. A page bundled otherwise, or one that serves the files itself, hands in a loader: `useAssetLoader((name) => …)`. The marks (NEAR, Akash, Filecoin, Aleph) are 192 × 192 PNGs on white, no transparency: `pdf.embedPng(await asset(LOGOS.near))` gives an opaque RGB image, fine for PDF/A.
- `@le-space/pdf/testing/pdfa-structure` – what a PDF/A file shows of itself (XMP, info, intent, id, fonts, images), for tests.

Fonts: DejaVu (Bitstream Vera / DejaVu licence), Noto Sans Arabic (SIL OFL 1.1); the sRGB profile is CC0; the chains' marks are their owners' trademarks, used to name the chain, not under this package's licence (sources and terms in `assets/README.md`).

```bash
pnpm --filter @le-space/pdf test   # Node, and the same file in Chromium
```

`fonts.js` came from Belege's `app/src/lib/pdf/fonts.js` (moved with its history; Courier, which is not embedded, gave way to DejaVu Sans Mono); `pdfa.js` and the asset loaders from Eigenbeleg's `packages/eigenbeleg` at e6cde90. AGPL-3.0-or-later.
