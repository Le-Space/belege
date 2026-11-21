// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/charts: the charts of Le Space's tools (Belege, the Eigenbeleg
// API and web UI, their PDFs), drawn the same way everywhere. Bookings →
// series (series.js), series → a scene of plain shapes (scene.js), a scene →
// SVG (svg.js) or whatever else draws rectangles, lines and text.
export { buckets, bucketOf, granularity, balanceSeries, sumSeries, OTHERS } from './series.js';
export { lineChart, stackedBars, niceTicks, clip, estimate, PALETTE, SERIES } from './scene.js';
export { svg } from './svg.js';
/** @typedef {import('./series.js').By} By */
/** @typedef {import('./series.js').BalanceSeries} BalanceSeries */
/** @typedef {import('./series.js').SumSeries} SumSeries */
/** @typedef {import('./scene.js').Scene} Scene */
/** @typedef {import('./scene.js').Shape} Shape */
/** @typedef {import('./scene.js').Role} Role */
/** @typedef {import('./scene.js').Measure} Measure */
