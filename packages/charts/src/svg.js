// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A scene as SVG, as text: no script, no link, no font or image from
// anywhere. Colours are variables: a page sets `--chart-text`, `--chart-s1` …
// on the picture or above it; where it sets none, the palette's light
// values hold, and its dark ones where the reader's system is dark.
//
// Every text of a scene is escaped. Still, a page that shows text from
// outside (a resource's name, a booking's purpose) had better build its
// elements from the scene itself than put a string of markup into the page.

import { PALETTE } from './scene.js';

/** @typedef {import('./scene.js').Scene} Scene */

/** @param {string} s */
const esc = (s) =>
	String(s)
		// Characters XML does not allow.
		.replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const ROLES = /** @type {(keyof typeof PALETTE.light)[]} */ (Object.keys(PALETTE.light));

/** @param {'light' | 'dark'} mode */
const vars = (mode) => ROLES.map((r) => `--c-${r}:var(--chart-${r},${PALETTE[mode][r]})`).join(';');

const STYLE =
	`.le-space-chart{${vars('light')}}` +
	`@media (prefers-color-scheme:dark){.le-space-chart{${vars('dark')}}}` +
	ROLES.map(
		(r) =>
			`.le-space-chart .f-${r}{fill:var(--c-${r})}.le-space-chart .k-${r}{stroke:var(--c-${r})}`
	).join('');

/**
 * @param {Scene} scene
 * @param {object} [o]
 * @param {string} [o.title] what the picture shows, for a screen reader
 * @param {string} [o.description]
 * @returns {string}
 */
export function svg(scene, { title = '', description = '' } = {}) {
	const out = [
		`<svg xmlns="http://www.w3.org/2000/svg" class="le-space-chart" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img" font-family="system-ui, sans-serif">`
	];
	if (title) out.push(`<title>${esc(title)}</title>`);
	if (description) out.push(`<desc>${esc(description)}</desc>`);
	out.push(`<style>${STYLE}</style>`);
	for (const s of scene.shapes) {
		if (s.type === 'rect')
			out.push(
				`<rect class="f-${s.fill}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${
					s.title ? `><title>${esc(s.title)}</title></rect>` : '/>'
				}`
			);
		else if (s.type === 'line')
			out.push(
				`<line class="k-${s.stroke}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.width}"/>`
			);
		else if (s.type === 'path')
			out.push(
				`<polyline class="k-${s.stroke}" points="${s.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"/>`
			);
		else
			out.push(
				`<text class="f-${s.fill}" x="${s.x}" y="${s.y}" font-size="${s.size}"${
					s.anchor === 'start' ? '' : ` text-anchor="${s.anchor}"`
				}${s.bold ? ' font-weight="bold"' : ''}>${esc(s.text)}</text>`
			);
	}
	out.push('</svg>');
	return out.join('\n');
}
