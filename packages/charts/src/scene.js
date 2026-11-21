// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Series → a drawing: a scene, the list of plain shapes a chart is made of
// (rectangles, lines, one path per series, text), in a box of `width` ×
// `height` with its origin top left and y running down, as in SVG. svg.js
// writes a scene as SVG; a PDF draws the same shapes as vectors. So a chart
// looks the same wherever it is shown, and nothing here knows a renderer.
//
// A colour is a role (`text`, `grid`, `s1` …), not a value: the renderer
// picks the value, for light or dark. A chart has one axis, starts at zero
// unless told otherwise, and carries no words of its own: title, legend and
// the formats of numbers and dates are handed in.

/** @typedef {'text' | 'muted' | 'grid' | 'axis' | 'surface' | 's1' | 's2' | 's3' | 's4' | 'other'} Role */
/** @typedef {{ type: 'rect', x: number, y: number, w: number, h: number, fill: Role, title?: string }} Rect */
/** @typedef {{ type: 'line', x1: number, y1: number, x2: number, y2: number, stroke: Role, width: number }} Line */
/** @typedef {{ type: 'path', points: [number, number][], stroke: Role, width: number }} Path */
/** @typedef {{ type: 'text', x: number, y: number, text: string, size: number, anchor: 'start' | 'middle' | 'end', fill: Role, bold: boolean }} Text y is the baseline */
/** @typedef {Rect | Line | Path | Text} Shape */
/** @typedef {{ width: number, height: number, shapes: Shape[] }} Scene */
/** @typedef {(text: string, size: number, bold: boolean) => number} Measure */

/** The colours of the series, in this order; the rest of a chart is `other`. */
export const SERIES = /** @type {const} */ (['s1', 's2', 's3', 's4']);

/**
 * The colours behind the roles, for a light and a dark surface: the series
 * hues are told apart by people with a colour vision deficiency when they
 * are used in this order.
 */
export const PALETTE = /** @type {const} */ ({
	light: {
		text: '#0b0b0b',
		muted: '#52514e',
		grid: '#e2e1dc',
		axis: '#8a8984',
		surface: '#ffffff',
		s1: '#2a78d6',
		s2: '#eb6834',
		s3: '#1baf7a',
		s4: '#eda100',
		other: '#8a8984'
	},
	dark: {
		text: '#f0efec',
		muted: '#c3c2b7',
		grid: '#3a3a37',
		axis: '#8a8984',
		surface: '#1a1a19',
		s1: '#3987e5',
		s2: '#d95926',
		s3: '#199e70',
		s4: '#c98500',
		other: '#8a8984'
	}
});

/** A width without a font at hand: about what a sans-serif takes. @type {Measure} */
export const estimate = (text, size, bold) => [...text].length * size * (bold ? 0.62 : 0.56);

/** Two decimals are enough for a point, and the same in every engine. @param {number} n */
const r2 = (n) => Math.round(n * 100) / 100 + 0;

/** A number as a plain decimal string with `places` decimals. @param {number} n @param {number} places */
function decimal(n, places) {
	if (Math.abs(n) >= 1e21) return BigInt(Math.round(n)).toString();
	const s = n.toFixed(Math.min(places, 100));
	return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/**
 * Round steps that cover min…max: about four, each 1, 2 or 5 times a power
 * of ten.
 *
 * @param {number} min @param {number} max
 * @returns {{ lo: number, hi: number, ticks: { value: number, text: string }[] }}
 */
export function niceTicks(min, max) {
	if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1];
	if (min > max) [min, max] = [max, min];
	if (min === max) {
		if (min === 0) max = 1;
		else if (min > 0) min = 0;
		else max = 0;
	}
	const raw = (max - min) / 4;
	const exp = Math.floor(Math.log10(raw));
	const pow = 10 ** exp;
	const f = raw / pow;
	const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
	const places = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
	const first = Math.floor(min / step + 1e-9);
	const last = Math.ceil(max / step - 1e-9);
	const ticks = [];
	for (let i = first; i <= last; i++)
		ticks.push({ value: i * step, text: decimal(i * step, places) });
	return { lo: first * step, hi: last * step, ticks };
}

/** A text that fits `max` characters, the rest as an ellipsis. @param {string} text @param {number} max */
export function clip(text, max) {
	const chars = [...text];
	return chars.length <= max
		? text
		: `${chars
				.slice(0, max - 1)
				.join('')
				.trimEnd()}…`;
}

const TITLE = 8;
const SMALL = 6.5;
const LEGEND = 7;

/**
 * What every chart has: the title, the legend (two series or more), the
 * value axis with its grid, the labels along the bottom.
 *
 * @param {object} p
 * @param {number} p.width
 * @param {number} p.height
 * @param {string} p.title
 * @param {{ label: string, color: Role }[]} p.legend
 * @param {number} p.min
 * @param {number} p.max
 * @param {(value: string) => string} p.format
 * @param {Measure} p.measure
 */
function frame({ width, height, title, legend, min, max, format, measure }) {
	/** @type {Shape[]} */
	const shapes = [];
	/** @param {number} x @param {number} y @param {string} text @param {Partial<Text>} [o] @returns {Text} */
	const text = (x, y, text, o = {}) => ({
		type: 'text',
		x: r2(x),
		y: r2(y),
		text,
		size: SMALL,
		anchor: 'start',
		fill: 'muted',
		bold: false,
		...o
	});
	let y = 0;
	if (title) {
		shapes.push(text(0, TITLE, title, { size: TITLE, fill: 'text', bold: true }));
		y = TITLE + 6;
	}
	if (legend.length > 1) {
		let x = 0;
		for (const item of legend) {
			const w = 9 + measure(item.label, LEGEND, false);
			if (x > 0 && x + w > width) {
				x = 0;
				y += LEGEND + 3;
			}
			shapes.push({ type: 'rect', x: r2(x), y: r2(y), w: 6, h: 6, fill: item.color });
			shapes.push(text(x + 9, y + 5.6, item.label, { size: LEGEND, fill: 'text' }));
			x += w + 12;
		}
		y += LEGEND + 6;
	}
	const { lo, hi, ticks } = niceTicks(min, max);
	const labels = ticks.map((t) => format(t.text));
	const left = Math.ceil(Math.max(...labels.map((t) => measure(t, SMALL, false)))) + 5;
	const plot = { left, right: width - 10, top: y + 4, bottom: height - SMALL - 5 };
	/** @param {number} v */
	const yOf = (v) => plot.bottom - ((v - lo) / (hi - lo)) * (plot.bottom - plot.top);
	ticks.forEach((t, i) => {
		const ty = r2(yOf(t.value));
		shapes.push({
			type: 'line',
			x1: plot.left,
			y1: ty,
			x2: plot.right,
			y2: ty,
			stroke: t.value === 0 ? 'axis' : 'grid',
			width: t.value === 0 ? 0.6 : 0.4
		});
		shapes.push(text(plot.left - 4, ty + SMALL * 0.35, labels[i], { anchor: 'end' }));
	});
	/**
	 * Labels along the bottom: as many as fit side by side, evenly spread.
	 *
	 * @param {string[]} texts one per position @param {(i: number) => number} xOf
	 */
	const bottom = (texts, xOf) => {
		if (!texts.length) return;
		const widest = Math.max(...texts.map((t) => measure(t, SMALL, false)));
		const room = Math.max(1, Math.floor((plot.right - plot.left) / (widest + 10)));
		const every = Math.max(1, Math.ceil(texts.length / room));
		for (let i = 0; i < texts.length; i += every) {
			const w = measure(texts[i], SMALL, false);
			const x = Math.min(Math.max(xOf(i), w / 2), width - w / 2);
			shapes.push(text(x, height - 1, texts[i], { anchor: 'middle' }));
		}
	};
	return { shapes, plot, yOf, bottom };
}

/**
 * A line of values over time, drawn as steps: a value holds until the next
 * one. For a balance: `start` is where it stood before the first bucket.
 *
 * @param {object} p
 * @param {string} p.title what is shown, with its unit
 * @param {string[]} p.buckets what the values stand for (days, months)
 * @param {{ label: string, values: number[], start?: number, color?: Role }[]} p.series a value per bucket; at most four
 * @param {number} [p.width]
 * @param {number} [p.height]
 * @param {boolean} [p.zero] the axis starts at zero (true unless said otherwise)
 * @param {(value: string) => string} [p.format] a tick's decimal string as it is printed
 * @param {(bucket: string) => string} [p.bucketLabel]
 * @param {Measure} [p.measure] the width of a text, where the renderer knows its font
 * @returns {Scene}
 */
export function lineChart({
	title,
	buckets,
	series,
	width = 500,
	height = 120,
	zero = true,
	format = (v) => v,
	bucketLabel = (b) => b,
	measure = estimate
}) {
	const lines = series.slice(0, SERIES.length).map((s, i) => ({
		...s,
		color: s.color ?? SERIES[i],
		all: [s.start ?? s.values[0] ?? 0, ...s.values].map((v) => (Number.isFinite(v) ? v : 0))
	}));
	const every = lines.flatMap((s) => s.all);
	const { shapes, plot, yOf, bottom } = frame({
		width,
		height,
		title,
		legend: lines.map((s) => ({ label: s.label, color: s.color })),
		min: Math.min(...every, ...(zero ? [0] : [])),
		max: Math.max(...every, ...(zero ? [0] : [])),
		format,
		measure
	});
	const n = buckets.length;
	/** Position 0 is the start of the period, position i the end of bucket i. @param {number} i */
	const xOf = (i) => plot.left + (n ? i / n : 0) * (plot.right - plot.left);
	for (const s of lines) {
		/** @type {[number, number][]} */
		const points = [[r2(xOf(0)), r2(yOf(s.all[0]))]];
		for (let i = 1; i <= n; i++) {
			const [, py] = points[points.length - 1];
			const x = r2(xOf(i));
			const y = r2(yOf(s.all[i]));
			points.push([x, py]);
			if (y !== py) points.push([x, y]);
		}
		// A run of steps on one level is one stroke.
		const path = points.filter(
			(p, i) =>
				i === 0 || i === points.length - 1 || p[1] !== points[i - 1][1] || p[1] !== points[i + 1][1]
		);
		shapes.push({ type: 'path', points: path, stroke: s.color, width: 1.2 });
	}
	bottom(buckets.map(bucketLabel), (i) => xOf(i + 1));
	return { width, height, shapes };
}

/**
 * Bars, one per bucket, the series stacked on each other. Values count from
 * zero up; one below zero is drawn as none.
 *
 * @param {object} p
 * @param {string} p.title what is shown, with its unit
 * @param {string[]} p.buckets
 * @param {{ label: string, values: number[], color?: Role }[]} p.series a value per bucket; at most
 *   four with a colour of their own, a fifth as `other`
 * @param {number} [p.width]
 * @param {number} [p.height]
 * @param {(value: string) => string} [p.format]
 * @param {(bucket: string) => string} [p.bucketLabel]
 * @param {Measure} [p.measure]
 * @returns {Scene}
 */
export function stackedBars({
	title,
	buckets,
	series,
	width = 500,
	height = 120,
	format = (v) => v,
	bucketLabel = (b) => b,
	measure = estimate
}) {
	const stacks = series.slice(0, SERIES.length + 1).map((s, i) => ({
		...s,
		color: s.color ?? SERIES[i] ?? 'other',
		values: buckets.map((_, b) => {
			const v = s.values[b];
			return Number.isFinite(v) && v > 0 ? v : 0;
		})
	}));
	const totals = buckets.map((_, b) => stacks.reduce((acc, s) => acc + s.values[b], 0));
	const { shapes, plot, yOf, bottom } = frame({
		width,
		height,
		title,
		legend: stacks.map((s) => ({ label: s.label, color: s.color })),
		min: 0,
		max: Math.max(0, ...totals),
		format,
		measure
	});
	const band = (plot.right - plot.left) / Math.max(1, buckets.length);
	const bar = Math.min(24, band - (band > 6 ? 2 : band * 0.2));
	const labels = buckets.map(bucketLabel);
	buckets.forEach((_, b) => {
		const x = plot.left + b * band + (band - bar) / 2;
		let below = 0;
		for (const s of stacks) {
			const v = s.values[b];
			if (!v) continue;
			const y0 = yOf(below);
			const y1 = yOf(below + v);
			// The surface shows between two parts of a bar; a part too thin for that keeps its height.
			const gap = below > 0 && y0 - y1 > 1.5 ? 0.6 : 0;
			shapes.push({
				type: 'rect',
				x: r2(x),
				y: r2(y1),
				w: r2(bar),
				h: r2(y0 - y1 - gap),
				fill: s.color,
				title: `${labels[b]} · ${s.label}`
			});
			below += v;
		}
	});
	bottom(labels, (i) => plot.left + (i + 0.5) * band);
	return { width, height, shapes };
}
