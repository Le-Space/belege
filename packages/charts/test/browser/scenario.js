// SPDX-License-Identifier: AGPL-3.0-or-later
// The charts in a browser: series, shapes and SVG as in Node
// (browser.test.js compares the two). Made-up values only.
import { balanceSeries, lineChart, stackedBars, sumSeries, svg } from '../../src/index.js';

export default async function scenario() {
	const balance = balanceSeries({
		opening: '18.75',
		movements: [
			{ date: '2026-10-03', amount: '-2.500000000000000000000001' },
			{ date: '2026-10-07', amount: '12' },
			{ date: '2026-10-19', amount: '-0.000446365125' }
		],
		from: '2026-10-01',
		to: '2026-10-31'
	});
	const usage = sumSeries({
		items: Array.from({ length: 62 }, (_, i) => ({
			date: `2026-08-${String((i % 31) + 1).padStart(2, '0')}`,
			amount: String(1200.5 + ((i * 37) % 900) / 7),
			key: i < 31 ? 'storage' : 'wolkenfabrik-web'
		})),
		from: '2026-08-01',
		to: '2026-08-31'
	});
	return {
		balance,
		usage,
		line: svg(
			lineChart({
				title: 'Kontostand je Tag (NEAR)',
				buckets: balance.points.map((p) => p.bucket),
				series: [
					{
						label: 'NEAR',
						start: Number(balance.opening),
						values: balance.points.map((p) => Number(p.value))
					}
				]
			})
		),
		bars: svg(
			stackedBars({
				title: 'Verbrauch je Tag (Credits)',
				buckets: usage.buckets,
				series: usage.series.map((s) => ({ label: s.label, values: s.values.map(Number) }))
			})
		)
	};
}
