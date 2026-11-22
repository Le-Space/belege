// SPDX-License-Identifier: AGPL-3.0-or-later
// An asset nobody quotes, valued at its issuer's dated reference value
// (@le-space/rates referenceRate): the documents name it as such, without its
// `Stand`, and the Kontoauszug's note does not claim a market rate. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';

import { buildDocument, buildStatement, statementPdf } from '../src/index.js';
import { sourceName } from '../src/document.js';
import { valuedBy } from '../src/statement.js';
import { nearEntries, payer } from './support/samples.js';

/** @param {Uint8Array} bytes */
const textOf = async (bytes) =>
	/** @type {string} */ (
		(await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text
	).replace(/\s+/g, ' ');

const REFERENCE = 'Referenzwert von Wolkenfabrik Hosting GmbH, Stand 2026-01-01 (kein Börsenkurs)';
const NAME = 'Referenzwert von Wolkenfabrik Hosting GmbH (kein Börsenkurs)';
const period = { from: '2026-10-01', to: '2026-10-31' };
const issuedAt = '2026-11-06T10:00:00.000Z';

/** @param {string} [currency] @param {string} [second] */
const referenceRates = (currency, second) => ({
	/** @param {string} asset @param {string} date */
	async rateFor(asset, date) {
		return {
			rate: '3.8',
			source: second ? `${REFERENCE} × ${second} vom ${date}` : REFERENCE,
			date,
			...(currency ? { currency } : {})
		};
	}
});

test('a reference value keeps its name and loses only its Stand, in EUR and with a second leg', () => {
	assert.equal(sourceName(REFERENCE), NAME);
	assert.equal(
		sourceName(`${REFERENCE} × EZB-Referenzkurs EUR/CHF vom 2026-10-05`),
		`${NAME} × EZB-Referenzkurs EUR/CHF`
	);
	assert.equal(
		sourceName('Referenzwert des Ausstellers, Stand 2026-01-01 (kein Börsenkurs)'),
		'Referenzwert des Ausstellers (kein Börsenkurs)'
	);
	// A market rate as before.
	assert.equal(
		sourceName('CoinGecko, Kurs 2026-10-05 00:00 UTC × EZB-Referenzkurs EUR/CHF vom 2026-10-05'),
		'CoinGecko, Kurs × EZB-Referenzkurs EUR/CHF'
	);
});

test("an Eigenbeleg names the reference value as its rate's source", async () => {
	const base = { payer, chain: 'near', network: 'mainnet', period, issuedAt };
	const eur = buildDocument({ ...base, entries: await nearEntries(referenceRates()) });
	assert.deepEqual(eur.sources, [NAME]);
	const chf = buildDocument({
		...base,
		entries: await nearEntries(referenceRates('CHF', 'EZB-Referenzkurs EUR/CHF'), 'CHF'),
		currency: 'CHF'
	});
	assert.deepEqual(chf.sources, [`${NAME} × EZB-Referenzkurs EUR/CHF`]);
});

/** @param {any[]} entries @param {string} [currency] */
const statement = (entries, currency) =>
	buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'mainnet',
		period,
		entries,
		opening: { NEAR: '10' },
		closing: {},
		method: 'derived',
		issuedAt,
		...(currency ? { currency } : {})
	});

test("a Kontoauszug valued at a reference value says so, not the day's market rate", async () => {
	const st = statement(await nearEntries(referenceRates()));
	assert.equal(st.sections[0].marketRate, false);
	assert.deepEqual(st.sections[0].referenceValues, [NAME]);
	const text = await textOf(await statementPdf(st));
	assert.match(text, new RegExp(`Euro-Werte zum ${NAME.replace(/[()]/g, '\\$&')}\\.`));
	assert.doesNotMatch(text, /CoinGecko, sonst Kraken/);

	const chf = statement(
		await nearEntries(referenceRates('CHF', 'EZB-Referenzkurs EUR/CHF'), 'CHF'),
		'CHF'
	);
	assert.match(
		await textOf(await statementPdf(chf)),
		/Werte in CHF: Referenzwert von Wolkenfabrik Hosting GmbH \(kein Börsenkurs\), über den Euro in CHF umgerechnet/
	);
});

test('a Kontoauszug with both names both; one with market rates only is as before', async () => {
	const entries = await nearEntries(referenceRates());
	const valued = entries.filter((e) => e.eur);
	assert.ok(valued.length >= 2);
	valued[0].eur = { ...valued[0].eur, source: 'CoinGecko, Kurs 2026-10-05 00:00 UTC' };
	const mixed = statement(entries);
	assert.equal(mixed.sections[0].marketRate, true);
	assert.deepEqual(mixed.sections[0].referenceValues, [NAME]);
	assert.match(
		await textOf(await statementPdf(mixed)),
		/Euro-Werte zum Tageskurs \(Kurs 00:00 UTC: CoinGecko, sonst Kraken\) und zum Referenzwert von Wolkenfabrik Hosting GmbH \(kein Börsenkurs\)\./
	);
	// Rows built elsewhere (the app's) may carry no source: a market rate, as before.
	const { rateSource, ...without } = mixed.sections[0].rows[0];
	assert.equal(typeof rateSource, 'string');
	assert.deepEqual(valuedBy([without]), { marketRate: true, referenceValues: [] });
	const market = statement(await nearEntries());
	assert.deepEqual(market.sections[0].referenceValues, []);
	assert.match(
		await textOf(await statementPdf(market)),
		/Euro-Werte zum Tageskurs \(Kurs 00:00 UTC: CoinGecko, sonst Kraken\)\./
	);
});
