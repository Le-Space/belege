// SPDX-License-Identifier: AGPL-3.0-or-later
// Series → shapes, and shapes → SVG. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE, clip, lineChart, niceTicks, stackedBars, svg } from '../src/index.js';

/** @param {import('../src/index.js').Scene} scene @param {string} type */
const of = (scene, type) => scene.shapes.filter((s) => s.type === type);

test('round steps on the value axis, as plain decimals', () => {
	assert.deepEqual(
		niceTicks(0, 38.2).ticks.map((t) => t.text),
		['0', '10', '20', '30', '40']
	);
	assert.deepEqual(
		niceTicks(0, 0.0007).ticks.map((t) => t.text),
		['0.0000', '0.0002', '0.0004', '0.0006', '0.0008']
	);
	assert.deepEqual(
		niceTicks(0, 2_997_800).ticks.map((t) => t.text),
		['0', '1000000', '2000000', '3000000']
	);
	assert.deepEqual(
		niceTicks(-3, 9).ticks.map((t) => t.text),
		['-5', '0', '5', '10']
	);
	// Nothing to span: still an axis.
	assert.deepEqual(
		niceTicks(0, 0).ticks.map((t) => t.text),
		['0.0', '0.5', '1.0']
	);
	assert.equal(niceTicks(7, 7).lo, 0);
	assert.equal(niceTicks(NaN, 1).hi, 1);
});

test('a text clipped to a length', () => {
	assert.equal(clip('wolkenfabrik-web', 28), 'wolkenfabrik-web');
	assert.equal(clip('wolkenfabrik-web-production', 12), 'wolkenfabri…');
});

test('a line chart: steps from the start through each bucket’s end, one axis from zero', () => {
	const scene = lineChart({
		title: 'Kontostand je Tag (NEAR)',
		buckets: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
		series: [{ label: 'NEAR', start: 10, values: [10, 30, 30, 20] }],
		width: 400,
		height: 100,
		format: (v) => v.replace('.', ','),
		bucketLabel: (b) => `${b.slice(8)}.${b.slice(5, 7)}.`
	});
	assert.equal(scene.width, 400);
	assert.equal(scene.height, 100);
	const [path] = /** @type {import('../src/scene.js').Path[]} */ (of(scene, 'path'));
	assert.equal(of(scene, 'path').length, 1);
	assert.equal(path.stroke, 's1');
	// Flat for day 1, up at the end of day 2, flat for day 3, down at the end of day 4.
	const ys = [...new Set(path.points.map((p) => p[1]))];
	assert.equal(ys.length, 3);
	assert.equal(path.points.length, 5);
	assert.equal(path.points[0][1], path.points[1][1]);
	assert.ok(path.points[2][1] < path.points[1][1], 'a higher balance is further up');
	assert.equal(path.points.at(-1)?.[0], 390);
	const texts = /** @type {import('../src/scene.js').Text[]} */ (of(scene, 'text'));
	assert.deepEqual(
		texts.map((t) => t.text),
		['Kontostand je Tag (NEAR)', '0', '10', '20', '30', '01.10.', '02.10.', '03.10.', '04.10.']
	);
	// One series: the title names it, no legend.
	assert.equal(of(scene, 'rect').length, 0);
	// The line at zero is the axis, the others the grid.
	assert.deepEqual(
		of(scene, 'line').map((l) => /** @type {import('../src/scene.js').Line} */ (l).stroke),
		['axis', 'grid', 'grid', 'grid']
	);
	// Every shape inside the box.
	for (const p of path.points) assert.ok(p[0] >= 0 && p[0] <= 400 && p[1] >= 0 && p[1] <= 100);
	// The same in, the same out.
	assert.deepEqual(
		lineChart({ title: 'a', buckets: ['x'], series: [{ label: 'b', values: [1] }] }),
		lineChart({ title: 'a', buckets: ['x'], series: [{ label: 'b', values: [1] }] })
	);
});

test('stacked bars: one bar per bucket, a part per series, a legend, the rest in grey', () => {
	const scene = stackedBars({
		title: 'Verbrauch je Tag (Credits)',
		buckets: ['2026-08-01', '2026-08-02', '2026-08-03'],
		series: [
			{ label: 'Speicher · 500', values: [200, 0, 300] },
			{ label: 'wolkenfabrik-web · 2.000', values: [0, 2000, -5] },
			{ label: 'Übrige · 12', values: [5, 7, 0], color: 'other' }
		],
		width: 400,
		height: 100
	});
	const rects = /** @type {import('../src/scene.js').Rect[]} */ (of(scene, 'rect'));
	const legend = rects.filter((r) => !r.title);
	const bars = rects.filter((r) => r.title);
	assert.deepEqual(
		legend.map((r) => r.fill),
		['s1', 's2', 'other']
	);
	// Zero and below zero draw nothing.
	assert.deepEqual(
		bars.map((r) => [r.title, r.fill]),
		[
			['2026-08-01 · Speicher · 500', 's1'],
			['2026-08-01 · Übrige · 12', 'other'],
			['2026-08-02 · wolkenfabrik-web · 2.000', 's2'],
			['2026-08-02 · Übrige · 12', 'other'],
			['2026-08-03 · Speicher · 500', 's1']
		]
	);
	// Stacked: the second part of a day ends where the first begins; bars no wider than 24.
	const [first, second] = bars;
	assert.ok(second.y + second.h <= first.y + 0.01);
	assert.ok(bars.every((r) => r.w <= 24 && r.h > 0 && r.y >= 0 && r.y + r.h <= 100));
	assert.ok(bars[2].h > bars[0].h * 5, 'heights by value');
	assert.equal(of(scene, 'path').length, 0);
});

test('SVG: text only, escaped, no script, colours as variables with light and dark behind them', () => {
	const scene = stackedBars({
		title: 'Verbrauch <b> & "mehr"',
		buckets: ['a'],
		series: [
			{ label: '<script>alert(1)</script>', values: [1] },
			{ label: 'zwei\u0000', values: [2] }
		]
	});
	const out = svg(scene, { title: 'Verbrauch je Tag', description: 'x < y' });
	assert.match(
		out,
		/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="le-space-chart" viewBox="0 0 500 120"/
	);
	assert.match(out, /<title>Verbrauch je Tag<\/title>\n<desc>x &lt; y<\/desc>/);
	assert.ok(out.includes('Verbrauch &lt;b&gt; &amp; &quot;mehr&quot;'));
	assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
	assert.doesNotMatch(out, /<script|\u0000|href|url\(|@import|<image|<foreignObject/);
	assert.ok(out.includes(`--c-s1:var(--chart-s1,${PALETTE.light.s1})`));
	assert.ok(out.includes(`--c-s1:var(--chart-s1,${PALETTE.dark.s1})`));
	assert.match(out, /@media \(prefers-color-scheme:dark\)/);
	assert.match(out, /<rect class="f-s2" [^>]*><title>a · zwei<\/title><\/rect>/);
	assert.equal(svg(scene), svg(scene));
	const line = svg(
		lineChart({ title: '', buckets: ['a', 'b'], series: [{ label: 'x', values: [1, 2] }] })
	);
	assert.match(line, /<polyline class="k-s1" points="[\d., ]+" fill="none"/);
});
