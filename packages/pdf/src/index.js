// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/pdf: PDF/A-2b with text in any script, for Le Space's tools
// (Belege, the Eigenbeleg API and web UI). Browser and Node.
export { pdfFonts, pdfText, wrapText } from './fonts.js';
export { createPdfA, makePdfA, savePdfA } from './pdfa.js';
export { asset, ASSETS, LOGOS, useAssetLoader } from './assets.js';
/** @typedef {import('./fonts.js').Face} Face */
/** @typedef {import('./pdfa.js').PdfAMeta} PdfAMeta */
