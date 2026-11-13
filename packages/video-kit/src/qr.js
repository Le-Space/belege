// SPDX-License-Identifier: AGPL-3.0-or-later
// An address as a QR for the closing card: SVG text, modules in the brand's
// ink, made by `qrencode` (on the PATH). Node only; card.js takes the SVG.
import { execFileSync } from 'node:child_process';

/**
 * @param {string} url
 * @param {{ ink?: string }} [o] the modules' colour; a QR must stay dark on light to scan
 */
export function qrSvg(url, { ink = '#0f1b2d' } = {}) {
	const svg = execFileSync('qrencode', [
		'-t',
		'SVG',
		'-o',
		'-',
		'-m',
		'0',
		'-l',
		'M',
		url
	]).toString();
	return svg
		.replace(/<\?xml[^>]*>\s*/, '')
		.replace(/<!--[^]*?-->\s*/, '')
		.replace(
			/width="[^"]*" height="[^"]*"/,
			'width="100%" height="100%" shape-rendering="crispEdges"'
		)
		.replace(/#000000/g, ink);
}
