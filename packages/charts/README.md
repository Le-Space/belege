# @le-space/charts

Charts for Le Space's tools – [Belege](https://github.com/Le-Space/belege), the [Eigenbeleg](https://github.com/Le-Space/eigenbeleg-agent) API and web UI, and their PDFs – drawn the same way everywhere ([#889](https://github.com/Le-Space/belege/issues/889)). No chart library, no script in the picture, nothing fetched. Runs in a browser and in Node; its only dependency is [`@le-space/ledger`](../ledger), for decimals without floats.

Three steps, each usable on its own:

- **Series** (`@le-space/charts/series`) – bookings → figures, in decimal strings, so a chart's figures are the figures of the table beside it and can go into an API's answer as they are. `buckets(from, to, by)` cuts a period into its days or months; `granularity(from, to)` picks days up to a quarter and months beyond. `balanceSeries({ opening, movements, from, to, by })` is a balance at the end of each bucket; `sumSeries({ items, from, to, by, max, others })` sums per bucket and kind, the `max` largest kinds with a series of their own and the rest as one.
- **Scene** (`@le-space/charts/scene`) – series → a drawing: `lineChart(…)` (steps: a value holds until the next one) and `stackedBars(…)` return a scene, `{ width, height, shapes }`, of rectangles, lines, one path per series and text, y running down as in SVG. A colour is a role (`text`, `grid`, `s1` … `s4`, `other`), not a value; `PALETTE` has the values for a light and a dark surface. A chart has one axis, starts at zero unless told otherwise, shows a legend from two series on, and has no words of its own: title, labels and the formats of numbers and dates are handed in, as is `measure(text, size, bold)` where the renderer knows its font.
- **SVG** (`@le-space/charts/svg`) – `svg(scene, { title, description })` writes a scene as SVG text: every text escaped, colours as CSS variables (`--chart-text`, `--chart-s1`, …; the palette's light values where none is set, its dark ones where the reader's system is dark), a bar's name as its `<title>`.

Anything that draws rectangles, lines and text can draw a scene: [`@le-space/eigenbeleg`](../eigenbeleg) draws it into its statements as PDF vectors (`drawScene`), a page can build its elements from the shapes.

```js
import { balanceSeries, lineChart, svg } from '@le-space/charts';

const balance = balanceSeries({
	opening: '18.75',
	movements: [
		{ date: '2026-10-03', amount: '-2.5' },
		{ date: '2026-10-07', amount: '12' }
	],
	from: '2026-10-01',
	to: '2026-10-31'
});
const scene = lineChart({
	title: 'Kontostand je Tag (NEAR)',
	buckets: balance.points.map((p) => p.bucket),
	series: [
		{
			label: 'NEAR',
			start: Number(balance.opening),
			values: balance.points.map((p) => Number(p.value))
		}
	]
});
const picture = svg(scene, { title: 'Kontostand je Tag' });
```

The figures stay decimal strings up to the drawing; only a shape's position is a number.

```bash
pnpm --filter @le-space/charts test   # Node, and the same scenario in Chromium
```

AGPL-3.0-or-later.
