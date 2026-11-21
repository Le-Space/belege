// SPDX-License-Identifier: AGPL-3.0-or-later
// The diagram above a statement's bookings (#889): the balance on a
// Kontoauszug, the consumption on a Verbrauchsauszug. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import { buildStatement, statementChart, statementPdf } from '../src/index.js';
import { alephEntries, nearEntries, payer } from './support/samples.js';

/** @param {Uint8Array} bytes */
const text = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text)
		.join('\n')
		.replace(/\s+/g, ' ');

async function usageStatement() {
	const entries = await alephEntries();
	return buildStatement({
		payer,
		account: entries[0].account,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries,
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '2997800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt: '2026-09-01T08:00:00.000Z'
	});
}

/** @param {{ from: string, to: string }} [period] */
async function accountStatement(period = { from: '2026-10-01', to: '2026-10-31' }) {
	return buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'testnet',
		period,
		entries: await nearEntries(),
		opening: { NEAR: '10' },
		closing: { NEAR: '12.998303634875' },
		method: 'archive',
		number: 'KA-2026-10-01',
		issuedAt: '2026-11-01T08:00:00.000Z'
	});
}

test('a Verbrauchsauszug: consumption per day and resource, the purchase not in it', async () => {
	const st = await usageStatement();
	const chart = statementChart(st, st.sections[0]);
	assert.equal(chart?.kind, 'usage');
	if (chart?.kind !== 'usage') return;
	assert.equal(chart.series.buckets.length, 31);
	// The sums of the Monatsübersicht; the 1,000,000 credits bought are no consumption.
	assert.deepEqual(
		chart.series.series.map((s) => [s.label, s.total, s.values[0], s.values[1]]),
		[
			['Aleph Cloud (storage)', '200', '200', '0'],
			['Aleph Cloud (wolkenfabrik-web)', '2000', '0', '2000']
		]
	);
	assert.deepEqual(
		st.sections[0].monthly.usage.map((l) => l.amount),
		chart.series.series.map((s) => s.total)
	);
	const texts = chart.scene.shapes.filter((s) => s.type === 'text').map((s) => s.text);
	assert.equal(texts[0], 'Verbrauch je Tag (Credits)');
	assert.ok(texts.includes('Speicher (storage) · 200'));
	assert.ok(texts.includes('wolkenfabrik-web · 2.000'));
	assert.ok(texts.includes('01.08.'));
	const bars = chart.scene.shapes.filter((s) => s.type === 'rect' && s.title);
	assert.equal(bars.length, 2);
});

test('a Kontoauszug: the balance per day, from the opening balance to the closing one', async () => {
	const st = await accountStatement();
	const [s] = st.sections;
	const chart = statementChart(st, s);
	assert.equal(chart?.kind, 'balance');
	if (chart?.kind !== 'balance') return;
	assert.equal(chart.series.opening, s.opening);
	assert.equal(chart.series.points.length, 31);
	assert.equal(chart.series.points.at(-1)?.value, s.closing);
	// Every booking is on 5 October: the balance of that day is the last row's.
	assert.equal(chart.series.points[3].value, s.opening);
	assert.equal(chart.series.points[4].value, s.rows.at(-1)?.balance);
	const texts = chart.scene.shapes.filter((x) => x.type === 'text').map((x) => x.text);
	assert.equal(texts[0], 'Kontostand je Tag (NEAR)');
	assert.equal(chart.scene.shapes.filter((x) => x.type === 'path').length, 1);
	// A year: per month.
	const year = await accountStatement({ from: '2026-01-01', to: '2026-12-31' });
	const perMonth = statementChart(year, year.sections[0]);
	assert.equal(perMonth?.kind === 'balance' && perMonth.series.points.length, 12);
	assert.ok(
		perMonth?.scene.shapes.some((x) => x.type === 'text' && x.text === 'Kontostand je Monat (NEAR)')
	);
	assert.ok(perMonth?.scene.shapes.some((x) => x.type === 'text' && x.text === '10/2026'));
});

test('nothing to draw: no bookings, or a single day', async () => {
	const st = await accountStatement();
	assert.equal(statementChart(st, { ...st.sections[0], rows: [] }), null);
	const day = await accountStatement({ from: '2026-10-05', to: '2026-10-05' });
	assert.equal(statementChart(day, day.sections[0]), null);
	assert.ok((await statementPdf(day)).length > 10_000);
});

test('the PDFs carry the diagram as vectors: PDF/A-2b, no image, the same bytes, off with chart: false', async () => {
	for (const [st, title] of /** @type {const} */ ([
		[await usageStatement(), 'Verbrauch je Tag (Credits)'],
		[await accountStatement(), 'Kontostand je Tag (NEAR)']
	])) {
		const pdf = await statementPdf(st);
		const without = await statementPdf(st, { chart: false });
		assert.ok((await text(pdf)).includes(title), title);
		assert.ok(!(await text(without)).includes(title), `${title} switched off`);
		assert.ok((await text(pdf)).includes('Seite 1 von 1'));
		const structure = pdfaStructure(pdf);
		assert.deepEqual(structure.pdfaid, { part: '2', conformance: 'B' });
		assert.deepEqual(structure.images, [], 'drawn, not embedded as a picture');
		assert.deepEqual(await statementPdf(st), pdf, 'the same bytes every time');
		assert.ok(pdf.length > without.length);
	}
});
