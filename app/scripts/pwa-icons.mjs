// The app's PWA icons (issue #141), made from static/favicon.svg so they
// never drift from it. Run after the favicon changes:
//   node scripts/pwa-icons.mjs
// Needs Inkscape on the PATH. Writes static/icons/: icon-192.png and
// icon-512.png (the favicon as it is, rounded corners), maskable-512.png
// (full-bleed background, the artwork inside the 80 % safe zone), and
// apple-touch-icon.png (180, full-bleed: iOS rounds it itself).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const favicon = readFileSync(join(root, 'static/favicon.svg'), 'utf8');
const inner = favicon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const BG = '#0B0E15';
// Without the rounded plate: full-bleed background, artwork scaled into the safe zone.
const artwork = inner.replace(/<rect width="96" height="96" rx="21" fill="#0B0E15"\/>/, '');
/** @param {number} scale */
const fullBleed = (scale) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${BG}"/><g transform="translate(${48 - 48 * scale} ${48 - 48 * scale}) scale(${scale})">${artwork}</g></svg>`;

const dir = mkdtempSync(join(tmpdir(), 'belege-icons-'));
try {
	/** @param {string} svg @param {number} size @param {string} name */
	const png = (svg, size, name) => {
		const src = join(dir, `${name}.svg`);
		writeFileSync(src, svg);
		execFileSync('inkscape', [
			src,
			'--export-type=png',
			`--export-filename=${join(root, 'static/icons', name)}`,
			`--export-width=${size}`,
			`--export-height=${size}`
		]);
	};
	png(favicon, 192, 'icon-192.png');
	png(favicon, 512, 'icon-512.png');
	png(fullBleed(0.8), 512, 'maskable-512.png');
	png(fullBleed(0.9), 180, 'apple-touch-icon.png');
} finally {
	rmSync(dir, { recursive: true, force: true });
}
