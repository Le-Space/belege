// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A scene of @le-space/charts on a PDF page, as vectors: rectangles, lines,
// one path per series, text in the document's embedded faces. No image, no
// transparency: the page stays PDF/A-2b, and sharp at any size.

import { LineCapStyle, rgb } from 'pdf-lib';
import { PALETTE } from '@le-space/charts';
import { pdfText } from '@le-space/pdf';

/** @typedef {import('@le-space/charts').Role} Role */

/** @param {string} hex #rrggbb */
const color = (hex) =>
	rgb(
		parseInt(hex.slice(1, 3), 16) / 255,
		parseInt(hex.slice(3, 5), 16) / 255,
		parseInt(hex.slice(5, 7), 16) / 255
	);

/** Paper is light. */
const COLORS = /** @type {Record<Role, import('pdf-lib').Color>} */ (
	Object.fromEntries(Object.entries(PALETTE.light).map(([role, hex]) => [role, color(hex)]))
);

/**
 * How wide a text of a scene is in the document's faces: hand it to the chart, so labels sit
 * where the drawn text ends.
 *
 * @param {import('./layout.js').Fonts} fonts
 * @returns {import('@le-space/charts').Measure}
 */
export const sceneMeasure = (fonts) => (text, size, bold) =>
	(bold ? fonts.bold : fonts.regular).width(pdfText(text), size);

/**
 * @param {import('pdf-lib').PDFPage} page
 * @param {import('@le-space/charts').Scene} scene
 * @param {object} o
 * @param {number} o.x the scene's left edge on the page
 * @param {number} o.top its top edge (PDF's y runs up, a scene's down)
 * @param {import('./layout.js').Fonts} o.fonts
 */
export function drawScene(page, scene, { x, top, fonts }) {
	for (const s of scene.shapes) {
		if (s.type === 'rect') {
			if (s.w > 0 && s.h > 0)
				page.drawRectangle({
					x: x + s.x,
					y: top - s.y - s.h,
					width: s.w,
					height: s.h,
					color: COLORS[s.fill]
				});
		} else if (s.type === 'line') {
			page.drawLine({
				start: { x: x + s.x1, y: top - s.y1 },
				end: { x: x + s.x2, y: top - s.y2 },
				thickness: s.width,
				color: COLORS[s.stroke]
			});
		} else if (s.type === 'path') {
			if (s.points.length > 1)
				page.drawSvgPath(s.points.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' '), {
					x,
					y: top,
					borderColor: COLORS[s.stroke],
					borderWidth: s.width,
					borderLineCap: LineCapStyle.Round
				});
		} else {
			const face = s.bold ? fonts.bold : fonts.regular;
			const text = pdfText(s.text);
			const w = s.anchor === 'start' ? 0 : face.width(text, s.size);
			face.draw(page, text, {
				x: x + s.x - (s.anchor === 'end' ? w : s.anchor === 'middle' ? w / 2 : 0),
				y: top - s.y,
				size: s.size,
				color: COLORS[s.fill]
			});
		}
	}
}
