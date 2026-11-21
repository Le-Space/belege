// SPDX-License-Identifier: AGPL-3.0-or-later
// A document in another currency than the euro (Le-Space/eigenbeleg-agent#72):
// what is valued, what the documents say, and that nothing in euro is mixed
// in. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	DOCUMENT_CURRENCIES,
	USAGE_NOTE,
	buildDocument,
	buildStatement,
	conversionText,
	deEuro,
	deMoney,
	eigenbelegCsv,
	eigenbelegPdf,
	fixedRates,
	statementPdf,
	usageNote
} from '../src/index.js';
import { alephEntries, crossRates, nearEntries, payer } from './support/samples.js';

/** @param {Uint8Array} bytes */
const textOf = async (bytes) =>
	/** @type {string} */ (
		(await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text
	).replace(/\s+/g, ' ');

const period = { from: '2026-10-01', to: '2026-10-31' };
const issuedAt = '2026-11-06T10:00:00.000Z';
const near = { payer, chain: 'near', network: 'mainnet', period, issuedAt };
const chfRates = crossRates('CHF', { NEAR: '3.61' }, 'EZB-Referenzkurs EUR/CHF');

test('EUR is the default, and nothing about an EUR document says another currency', async () => {
	const entries = await nearEntries();
	assert.deepEqual(Object.keys(/** @type {object} */ (entries[0].eur)), [
		'value',
		'rate',
		'source'
	]);
	const doc = buildDocument({ ...near, entries });
	assert.equal(doc.currency, 'EUR');
	assert.equal(deMoney('1234.5', 'EUR'), deEuro('1234.5'));
	assert.equal(deMoney('0.0017', 'EUR', 4), '0,0017 €');
	assert.equal(conversionText('EUR'), '');
	assert.equal(usageNote('aleph', 'EUR'), USAGE_NOTE);
});

test('USD like every currency but the ruble: through the euro at the ECB reference rate', () => {
	assert.equal(conversionText('USD'), conversionText('CHF').replace('CHF', 'USD'));
	assert.doesNotMatch(conversionText('USD'), /CoinGecko/);
	assert.match(
		usageNote('filecoin-pay', 'USD'),
		/über den Euro in USD umgerechnet zum Euro-Referenzkurs der EZB/
	);
	assert.match(conversionText('RUB'), /Bank von Russland/);
});

test('the list of currencies: the euro, ECB currencies, the ruble; another code is refused by name', async () => {
	assert.deepEqual(Object.keys(DOCUMENT_CURRENCIES), [
		...['EUR', 'USD', 'CHF', 'GBP', 'SEK', 'NOK', 'DKK'],
		...['PLN', 'CZK', 'HUF', 'RON', 'ISK', 'TRY', 'RUB']
	]);
	assert.equal(DOCUMENT_CURRENCIES.RUB.via, 'cbr');
	for (const currency of ['UAH', 'chf', '', 'toString', 7]) {
		assert.throws(
			() => buildDocument({ ...near, entries: [], currency: /** @type {any} */ (currency) }),
			/currency: one of EUR, USD, CHF/
		);
	}
	await assert.rejects(nearEntries(chfRates, 'XXX'), /currency: one of/);
});

test('an Eigenbeleg in CHF: heads, values and sums in francs, the second leg named', async () => {
	const entries = await nearEntries(chfRates, 'CHF');
	assert.deepEqual(entries[0].eur, {
		value: '-0.00161138',
		rate: '3.61',
		source: 'CoinGecko, Kurs 2026-10-05 00:00 UTC × EZB-Referenzkurs EUR/CHF vom 2026-10-05',
		currency: 'CHF'
	});
	const doc = buildDocument({ ...near, entries, currency: 'CHF', number: 'EB-2026-009' });
	assert.equal(doc.currency, 'CHF');
	assert.equal(doc.totals.eurExact, '0.00612388');
	assert.equal(doc.totals.eur, '0.01');
	assert.deepEqual(doc.sources, ['CoinGecko, Kurs × EZB-Referenzkurs EUR/CHF']);
	const bytes = await eigenbelegPdf(doc);
	assert.deepEqual(pdfaStructure(bytes).pdfaid, { part: '2', conformance: 'B' });
	const text = await textOf(bytes);
	assert.match(text, /Kurs CHF/);
	assert.match(text, /Wert CHF/);
	assert.match(text, /−0,0016 CHF/);
	assert.match(text, /0,01 CHF/);
	assert.match(text, /Ungerundet 0,0061 CHF/);
	assert.match(
		text,
		/Werte in CHF: über den Euro in CHF umgerechnet zum Euro-Referenzkurs der EZB des Tages oder des letzten davor\./
	);
	assert.doesNotMatch(text, /€|Wert EUR|Kurs EUR/);
	assert.deepEqual(await eigenbelegPdf(doc), bytes, 'the same bytes every time');
});

test('its CSV names the currency in the columns and in the sum', async () => {
	const doc = buildDocument({
		...near,
		entries: await nearEntries(chfRates, 'CHF'),
		currency: 'CHF'
	});
	const [head, first, ...rest] = eigenbelegCsv(doc).replace('﻿', '').split('\r\n');
	assert.match(head, /;Menge;Kurs CHF;Wert CHF;Kursquelle;/);
	assert.match(first, /;3,61;-0,00161138;CoinGecko, Kurs 2026-10-05 00:00 UTC × EZB-Referenzkurs/);
	const sum = rest.find((line) => line.includes(';Summe;'));
	assert.match(String(sum), /;-0,01;gerundet auf 2 Nachkommastellen, ungerundet -0,00612388;/);
});

test('values in one currency under a head in another are refused, not printed', async () => {
	const inEur = await nearEntries();
	const inChf = await nearEntries(chfRates, 'CHF');
	assert.throws(
		() => buildDocument({ ...near, entries: inEur, currency: 'CHF' }),
		/valued in EUR, the document is in CHF/
	);
	assert.throws(
		() => buildDocument({ ...near, entries: inChf }),
		/valued in CHF, the document is in EUR/
	);
	const statement = {
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'mainnet',
		period,
		opening: { NEAR: '10' },
		closing: {},
		method: /** @type {const} */ ('derived')
	};
	assert.throws(
		() => buildStatement({ ...statement, entries: inChf, currency: 'USD' }),
		/valued in CHF, the document is in USD/
	);
	// Rates that say they are in euro, for a document in francs; and the other way round.
	await assert.rejects(nearEntries(fixedRates({ NEAR: '3.8' }), 'CHF'), /a rate in EUR/);
	await assert.rejects(nearEntries(chfRates), /a rate in CHF for a document in EUR/);
});

test('a currency without cents: sums in whole units, positions still with four decimals', async () => {
	const isk = crossRates('ISK', { NEAR: '550' }, 'EZB-Referenzkurs EUR/ISK');
	const entries = await nearEntries(isk, 'ISK');
	const doc = buildDocument({
		...near,
		entries,
		currency: 'ISK',
		includeKinds: ['fee', 'storage', 'transfer']
	});
	assert.equal(doc.totals.eurExact, '1100.93300082');
	assert.equal(doc.totals.eur, '1101');
	assert.equal(deMoney(doc.totals.eur, 'ISK'), '1.101 ISK');
	const text = await textOf(await eigenbelegPdf(doc));
	assert.match(text, /1\.101 ISK/);
	assert.match(text, /−0,2455 ISK/);
	// A single payment below one króna says so in krónur, not in cents.
	const small = buildDocument({ ...near, entries, currency: 'ISK', layout: 'single' });
	assert.match(
		await textOf(await eigenbelegPdf(small)),
		/Ungerundet 0,24550082 ISK \(unter 1 ISK\)/
	);
	assert.match(eigenbelegCsv(doc), /gerundet auf ganze Beträge/);
});

test('a Kontoauszug in RUB names the Bank of Russia, not the ECB alone', async () => {
	const rub = crossRates('RUB', { NEAR: '381.9' }, 'Bank von Russland, amtlicher Kurs RUB je EUR');
	const st = buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'mainnet',
		period,
		entries: await nearEntries(rub, 'RUB'),
		opening: { NEAR: '10' },
		closing: { NEAR: '12.998303634875' },
		method: 'archive',
		issuedAt,
		currency: 'RUB'
	});
	assert.equal(st.currency, 'RUB');
	assert.equal(st.sections[0].eurIn, '1909.5');
	const bytes = await statementPdf(st);
	assert.deepEqual(pdfaStructure(bytes).pdfaid, { part: '2', conformance: 'B' });
	const text = await textOf(bytes);
	assert.match(text, /Wert RUB/);
	assert.match(text, /Eingänge 1\.909,50 RUB/);
	assert.match(
		text,
		/Werte in RUB: Tageskurs \(Kurs 00:00 UTC: CoinGecko, sonst Kraken\), über den Euro in RUB umgerechnet zum amtlichen Kurs der Bank von Russland, gültig am Tag/
	);
	assert.match(text, /kein Dokument eines Kreditinstituts/);
	assert.doesNotMatch(text, /€|Euro-Werte|Wert EUR/);
});

test("Aleph credits in USD: Aleph's own price, and no rate is asked for", async () => {
	let asked = 0;
	const none = {
		async rateFor() {
			asked++;
			return null;
		}
	};
	const entries = await alephEntries(none, 'USD');
	assert.equal(asked, 0);
	assert.deepEqual(entries[1].eur, {
		value: '-0.0004',
		rate: '0.000002',
		source: 'Aleph Kaufpreis 0.000002 USD je Credit',
		currency: 'USD'
	});
	const st = buildStatement({
		payer,
		account: entries[0].account,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries,
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: {},
		method: 'derived',
		issuedAt,
		currency: 'USD'
	});
	assert.match(st.note, /Wert in USD: USD-Preis je Credit \(letzter Kauf .*Credits\)\.$/);
	assert.doesNotMatch(st.note, /Euro|EZB/);
	const text = await textOf(await statementPdf(st));
	assert.match(text, /Wert USD/);
	assert.match(text, /Eingänge 2,00 USD/);
	assert.doesNotMatch(text, /€|Euro|EZB/);
});

test('Aleph credits in CHF: the USD price through the euro, both said', async () => {
	const chf = crossRates('CHF', { USD: '0.76' }, 'EZB-Referenzkurs EUR/CHF');
	const entries = await alephEntries(chf, 'CHF');
	assert.equal(entries[0].eur?.value, '1.52');
	assert.equal(
		entries[0].eur?.source,
		'Aleph Kaufpreis 0.000002 USD je Credit × EZB-Referenzkurs USD/EUR vom 2026-08-01 × EZB-Referenzkurs EUR/CHF vom 2026-08-01'
	);
	assert.match(
		usageNote('aleph', 'CHF'),
		/Wert in CHF: USD-Preis je Credit \(.*\), über den Euro in CHF umgerechnet zum Euro-Referenzkurs der EZB/
	);
	assert.match(
		usageNote('filecoin-pay', 'CHF'),
		/Wert in CHF: USDFC ist an den US-Dollar gebunden .* über den Euro in CHF umgerechnet/
	);
});
