// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The diagram of a statement's section (#889), above its list of bookings:
// a Kontoauszug shows the balance over the period, a Verbrauchsauszug what
// was consumed, per resource. Per day; per month where the period is longer
// than a quarter. In the asset's own unit, so every figure of the diagram is
// one the tables below it hold: the running balance, a day's consumption,
// the sums of the Monatsübersicht (they stand in the legend).
//
// Series and shapes come from @le-space/charts; this file picks what a
// statement shows and gives it its German words. statement-pdf.js draws the
// scene into the PDF as vectors (chart-pdf.js); `svg(scene)` of
// @le-space/charts gives the same picture for a page.

import {
	balanceSeries,
	clip,
	granularity,
	lineChart,
	stackedBars,
	sumSeries
} from '@le-space/charts';
import { round } from '@le-space/ledger';

import { formats } from './document.js';
import { say } from './language.js';

/** A resource as the Monatsübersicht names it. @param {string} label @param {import('./language.js').DocumentLanguage} [language] */
export const resourceName = (label, language = 'de') =>
	label
		.replace(/^Aleph Cloud \((.*)\)$/, '$1')
		.replace(/^storage$/, say(language, 'Speicher (storage)', 'storage'));

/** @param {string} bucket YYYY-MM-DD or YYYY-MM */
const bucketLabel = (bucket) => {
	const [y, m, d] = bucket.split('-');
	return d ? `${d}.${m}.` : `${m}/${y}`;
};

/** The same in English: `10-05`, `2026-10`. @param {string} bucket YYYY-MM-DD or YYYY-MM */
const bucketLabelEn = (bucket) => {
	const [y, m, d] = bucket.split('-');
	return d ? `${m}-${d}` : `${y}-${m}`;
};

/**
 * @param {import('./statement.js').Statement} st
 * @param {import('./statement.js').Statement['sections'][number]} s
 * @param {object} [o]
 * @param {number} [o.width]
 * @param {number} [o.height]
 * @param {import('@le-space/charts').Measure} [o.measure] the width of a text in the renderer's font
 * @returns {{ kind: 'usage', series: import('@le-space/charts').SumSeries, scene: import('@le-space/charts').Scene }
 *   | { kind: 'balance', series: import('@le-space/charts').BalanceSeries, scene: import('@le-space/charts').Scene }
 *   | null} null where there is nothing to draw: no booking, or a period of one day
 */
export function statementChart(st, s, { width = 507, height = 112, measure } = {}) {
	const { from, to } = st.period;
	if (!s.rows.length || !(from < to)) return null;
	const by = granularity(from, to);
	const L = st.language ?? 'de';
	/** @param {string} de @param {string} en */
	const t = (de, en) => say(L, de, en);
	const deNumber = formats(L).number;
	const per = by === 'month' ? t('Monat', 'month') : t('Tag', 'day');
	const unit = st.chain === 'aleph' ? t('Credits', 'credits') : s.asset;
	const common = {
		width,
		height,
		format: deNumber,
		bucketLabel: L === 'en' ? bucketLabelEn : bucketLabel,
		...(measure ? { measure } : {})
	};
	const used = s.rows.filter((r) => r.usage && r.debit);
	if ((st.usage ?? st.title === 'Verbrauchsauszug') && used.length) {
		const series = sumSeries({
			items: used.map((r) => ({ date: r.date, amount: r.debit, key: r.label })),
			from,
			to,
			by,
			others: t('Übrige', 'Others')
		});
		const scene = stackedBars({
			...common,
			title: `${t('Verbrauch je', 'Usage per')} ${per} (${unit})`,
			buckets: series.buckets,
			series: series.series.map((x) => ({
				label: `${clip(x.others ? x.label : resourceName(x.label, L), 28)} · ${deNumber(round(x.total, 12))}`,
				values: x.values.map(Number),
				...(x.others ? { color: /** @type {const} */ ('other') } : {})
			}))
		});
		return { kind: 'usage', series, scene };
	}
	const series = balanceSeries({
		opening: s.opening,
		movements: s.rows.map((r) => ({ date: r.date, amount: r.credit || `-${r.debit}` })),
		from,
		to,
		by
	});
	const scene = lineChart({
		...common,
		title: `${t('Kontostand je', 'Balance per')} ${per} (${unit})`,
		buckets: series.points.map((p) => p.bucket),
		series: [
			{
				label: unit,
				start: Number(series.opening),
				values: series.points.map((p) => Number(p.value))
			}
		]
	});
	return { kind: 'balance', series, scene };
}
