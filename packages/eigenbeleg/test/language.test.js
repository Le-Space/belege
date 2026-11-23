// SPDX-License-Identifier: AGPL-3.0-or-later
// Documents in English (language.js): the same documents, English words and
// formats; German stays the default and unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';

import {
	DOCUMENT_LANGUAGES,
	NOTE_EN,
	NOT_AN_INVOICE_EN,
	buildDocument,
	buildStatement,
	documentLanguage,
	eigenbelegCsv,
	eigenbelegPdf,
	fixedRates,
	localizeLabel,
	localizeSource,
	statementPdf
} from '../src/index.js';
import { USAGE_NOTES_EN } from '../src/statement.js';
import { alephEntries, crossRates, nearEntries, payer } from './support/samples.js';

/** @param {Uint8Array} bytes */
const text = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text).join(
		'\n'
	);

const period = { from: '2026-10-01', to: '2026-10-31' };
const issuedAt = '2026-11-06T10:00:00.000Z';

test('the language: de by default, en on request, nothing else', () => {
	assert.deepEqual([...DOCUMENT_LANGUAGES], ['de', 'en']);
	assert.equal(documentLanguage(), 'de');
	assert.equal(documentLanguage('en'), 'en');
	assert.throws(() => documentLanguage('fr'), /language: de or en/);
	assert.throws(
		() =>
			buildDocument({
				payer,
				chain: 'near',
				network: 'testnet',
				period,
				entries: [],
				issuedAt,
				language: 'EN'
			}),
		/language: de or en/
	);
});

test('the rates’ sources in English; German text stays as it is', () => {
	const cases = [
		['CoinGecko, Kurs 2026-10-05 00:00 UTC', 'CoinGecko, rate of 2026-10-05 00:00 UTC'],
		['CoinGecko, Kurs 00:00 UTC', 'CoinGecko, rate at 00:00 UTC'],
		['CoinGecko, Kurs', 'CoinGecko, rate'],
		['Kraken, Kurs × EZB-Referenzkurs EUR/CHF', 'Kraken, rate × ECB reference rate EUR/CHF'],
		['EZB-Referenzkurs USD/EUR vom 2026-10-05', 'ECB reference rate USD/EUR of 2026-10-05'],
		['amtlicher Kurs EUR/RUB der Bank von Russland', 'official rate EUR/RUB of the Bank of Russia'],
		[
			'Referenzwert von eigenbeleg-agent (Standardwert), Stand 2026-01-01 (kein Börsenkurs)',
			'reference value of eigenbeleg-agent (default), as of 2026-01-01 (no market rate)'
		],
		[
			'Referenzwert des Ausstellers (kein Börsenkurs)',
			"the issuer's reference value (no market rate)"
		],
		[
			'Aleph Kaufpreis 0.000002 USD je Credit × fester Testkurs (USD)',
			'Aleph purchase price 0.000002 USD per credit × fixed test rate (USD)'
		],
		[
			'Uniswap v3, Pool 0xabc bei Block 123, gegen den Tageskurs 2026-10-05 00:00 UTC (Token-Vertrag 0xdef)',
			"Uniswap v3, pool 0xabc at block 123, against the day's rate of 2026-10-05 00:00 UTC (token contract 0xdef)"
		]
	];
	for (const [de, en] of [
		['NEAR-Netzwerk', 'NEAR network'],
		['Bitcoin-Netzwerk (Miner-Gebühr)', 'Bitcoin network (miner fee)'],
		['Ethereum-Netzwerk (Gas)', 'Ethereum network (gas)'],
		[
			'Aleph Cloud (Kauf von 1000000 Credits mit ALEPH auf ETH)',
			'Aleph Cloud (purchase of 1000000 credits with ALEPH on ETH)'
		],
		['bezahlt bis 2026-08-31', 'paid up to 2026-08-31'],
		['stromwerk.testnet', 'stromwerk.testnet']
	]) {
		assert.equal(localizeLabel(de, 'en'), en);
		assert.equal(localizeLabel(de, 'de'), de);
	}
	for (const [de, en] of cases) {
		assert.equal(localizeSource(de, 'en'), en);
		assert.equal(localizeSource(de, 'de'), de);
		assert.equal(localizeSource(de, undefined), de);
	}
});

test('an Eigenbeleg in English: English words, decimal points and ISO dates; the German name stays beside the English one', async () => {
	const entries = await nearEntries();
	const doc = buildDocument({
		payer,
		chain: 'near',
		network: 'mainnet',
		period,
		entries,
		number: 'EB-2026-007',
		issuedAt,
		language: 'en'
	});
	assert.equal(doc.language, 'en');
	assert.equal(doc.note, NOTE_EN);
	assert.equal(doc.notInvoice, NOT_AN_INVOICE_EN);
	assert.ok(doc.transactions[0].movements.some((m) => m.what === 'Network fee (gas)'));
	assert.ok(
		doc.excluded.every((x) => !/[äöüß]|Eingang|Zahlung/.test(x.why)),
		'the reasons in English'
	);
	const pdf = await text(await eigenbelegPdf(doc));
	for (const words of [
		'Eigenbeleg (self-issued receipt)',
		'No. EB-2026-007',
		'Payer and issuer',
		'Issued on',
		'Recipient',
		'Rate source',
		'Place, date, signature of the payer',
		'Collective Eigenbeleg for payments on NEAR Protocol (mainnet), period 2026-10-01 – 2026-10-31',
		'Page 1'
	])
		assert.ok(pdf.includes(words), words);
	for (const german of [
		'Unterschrift',
		'Zahlender',
		'Kursquelle',
		'Seite',
		'Empfänger',
		'Ausgestellt'
	])
		assert.ok(!pdf.includes(german), german);
	assert.match(pdf, /\d\.\d{2} EUR/, 'amounts with a decimal point and the code');
	assert.equal(doc.number, 'EB-2026-007');

	const single = buildDocument({
		payer,
		chain: 'near',
		network: 'mainnet',
		period,
		entries,
		number: 'EB-2026-008',
		issuedAt,
		layout: 'single',
		language: 'en'
	});
	const one = await text(await eigenbelegPdf(single));
	assert.ok(
		one.includes('Eigenbeleg for a payment on NEAR Protocol (mainnet) on 2026-'),
		'the single layout'
	);
	assert.ok(one.includes('Why no invoice'));
});

test('the CSV in English: English heads and words, decimal points, still semicolons', async () => {
	const entries = await nearEntries();
	const csv = eigenbelegCsv(
		buildDocument({
			payer,
			chain: 'near',
			network: 'mainnet',
			period,
			entries,
			number: 'EB-2026-007',
			issuedAt,
			language: 'en'
		})
	);
	const [head, first] = csv.replace(/^﻿/, '').split('\r\n');
	assert.ok(
		head.startsWith(
			'Receipt number;Position;Date (UTC);Time (UTC);Chain;Network;Own address;Kind;Direction;'
		)
	);
	assert.ok(head.includes(';Rate EUR;Value EUR;Rate source;'));
	assert.match(first, /;yes;/);
	assert.match(first, /;-?\d+\.\d+;/, 'a decimal point');
	assert.match(csv, /\r\nEB-2026-007;Total;/);
	assert.doesNotMatch(csv, /;ja;|;nein;|Summe|Ausgang|Eingang/);
});

test('another currency in English: the conversion said in English', async () => {
	const doc = buildDocument({
		payer,
		chain: 'near',
		network: 'mainnet',
		period,
		entries: await nearEntries(
			crossRates('CHF', { NEAR: '3.61' }, 'EZB-Referenzkurs EUR/CHF'),
			'CHF'
		),
		number: 'EB-2026-009',
		issuedAt,
		currency: 'CHF',
		language: 'en'
	});
	const pdf = await text(await eigenbelegPdf(doc));
	assert.ok(
		pdf.includes(
			"Values in CHF: converted through the euro into CHF at the ECB's euro reference rate of the day or the last one before it."
		)
	);
	assert.ok(pdf.includes('ECB reference rate EUR/CHF'), 'the source in English');
	assert.match(pdf, /\d\.\d{2} CHF/);
});

test('a Kontoauszug in English: account statement, debit and credit, the check in English', async () => {
	const st = buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'mainnet',
		period,
		entries: await nearEntries(),
		opening: { NEAR: '10' },
		closing: { NEAR: '12.998303634875' },
		method: 'archive',
		number: 'KA-2026-10',
		issuedAt,
		language: 'en'
	});
	assert.equal(st.title, 'Account statement (Kontoauszug)');
	assert.equal(st.language, 'en');
	assert.equal(st.usage, false);
	const pdf = await text(await statementPdf(st));
	for (const words of [
		'Account statement (Kontoauszug)',
		'Account holder',
		'Period',
		'2026-10-01 – 2026-10-31',
		'Date',
		'Debit',
		'Credit',
		'Balance',
		'Balance on 2026-10-01 (start)',
		'Balance on 2026-10-31 (end)',
		'Total',
		'no document of a bank',
		'Page 1 of'
	])
		assert.ok(pdf.includes(words), words);
	assert.match(pdf, /Reconciled: |Not reconciled: /);
	for (const german of ['Kontoinhaber', 'Kontostand', 'Soll', 'Haben', 'Seite', 'Abgestimmt'])
		assert.ok(!pdf.includes(german), german);
});

test('a Verbrauchsauszug in English: usage statement, the month in sums, the chart in English', async () => {
	const st = buildStatement({
		payer,
		account: `0x${'a1'.repeat(20)}`,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries: await alephEntries(fixedRates({ USD: '0.8' })),
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '2997800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt,
		language: 'en'
	});
	assert.equal(st.title, 'Usage statement (Verbrauchsauszug)');
	assert.equal(st.usage, true);
	assert.equal(st.note, USAGE_NOTES_EN.aleph);
	assert.ok(st.sections[0].monthly.usageTotal?.label === 'Usage in all (expense)');
	const pdf = await text(await statementPdf(st));
	for (const words of [
		'Usage statement (Verbrauchsauszug)',
		'Statement no.',
		'The month in sums',
		'Usage per day',
		'Opening and closing balance derived'
	])
		assert.ok(pdf.includes(words), words);
	assert.ok(!pdf.includes('Monatsübersicht'));
});
