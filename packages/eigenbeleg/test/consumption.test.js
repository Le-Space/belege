// SPDX-License-Identifier: AGPL-3.0-or-later
// The monthly consumption Eigenbeleg (Le-Space/eigenbeleg-agent#116): Aleph
// credits used, Filecoin Pay's settlements, Akash's lease payouts – one per
// account and month, in sums per resource, rail or deployment, valued as the
// usage statement values them. Every account, rail and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	FILECOIN_PAY,
	createFilecoinPayClient,
	filecoinPayEntries
} from '@le-space/chains/filecoin-pay';
import { filecoinPayFetch } from '@le-space/chains/testing/filecoin-pay';
import { akashUsageEntries } from '@le-space/chains/akash-deployments';

import {
	buildDocument,
	buildStatement,
	consumptionTitle,
	eigenbelegCsv,
	eigenbelegPdf,
	fixedRates,
	valueEntries
} from '../src/index.js';
import { alephEntries, alephPurchaseEntries, payer } from './support/samples.js';

/** @param {Uint8Array} bytes */
const text = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text)
		.join('\n')
		.replace(/\s+/g, ' ');

const ISSUED = '2026-09-01T08:00:00.000Z';
const AUGUST = { from: '2026-08-01', to: '2026-08-31' };

test('the title says the month and that nobody invoices it', () => {
	assert.equal(consumptionTitle('2026-08'), 'Verbrauch August 2026 – kein Rechnungssteller');
	assert.equal(consumptionTitle('2026-03', 'en'), 'Consumption March 2026 – no invoicing party');
});

test('Aleph: the month’s usage in sums per resource, the same as the Verbrauchsauszug’s, numbered after the purchases', async () => {
	const entries = await alephEntries();
	const account = entries[0].account;
	const aleph = { ...payer, addresses: [account] };
	const doc = buildDocument({
		payer: aleph,
		chain: 'aleph',
		network: 'mainnet',
		period: AUGUST,
		entries,
		number: 'EB-2026-007',
		includeKinds: [],
		issuedAt: ISSUED,
		layout: 'single',
		consumption: [{ account, month: '2026-08', statementNumber: 'VA-2026-08-01' }]
	});
	assert.equal(doc.number, 'EB-2026-007', 'one Eigenbeleg: the consumption');
	assert.equal(doc.transactions.length, 0);
	const [r] = doc.consumption;
	assert.equal(r.number, 'EB-2026-007');
	assert.equal(r.statementNumber, 'VA-2026-08-01');
	assert.equal(r.title, 'Verbrauch August 2026 – kein Rechnungssteller');
	assert.deepEqual(
		r.lines.map((l) => [l.label, l.count, l.quantities, l.eurExact]),
		[
			['Aleph Cloud (storage)', 1, { 'ALEPH-CREDIT': '200' }, '0.00032'],
			['Aleph Cloud (wolkenfabrik-web)', 1, { 'ALEPH-CREDIT': '2000' }, '0.0032']
		]
	);
	assert.deepEqual(r.totals, {
		quantities: { 'ALEPH-CREDIT': '2200' },
		eur: '0',
		eurExact: '0.00352'
	});
	// The statement's own sum of the month's usage: the very same figure.
	const st = buildStatement({
		payer: aleph,
		account,
		chain: 'aleph',
		network: 'mainnet',
		period: AUGUST,
		entries,
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '2997800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt: ISSUED
	});
	assert.equal(st.sections[0].eurUsage, r.totals.eurExact);
	assert.equal(doc.totals.eurExact, '0.00352');
	assert.ok(
		doc.excluded.every((x) => x.entry.kind !== 'usage'),
		'usage on the consumption Eigenbeleg is not among what is left off'
	);

	const pdf = await eigenbelegPdf(doc);
	assert.deepEqual(pdfaStructure(pdf).pdfaid, { part: '2', conformance: 'B' });
	const t = await text(pdf);
	for (const expected of [
		'Eigenbeleg',
		'EB-2026-007',
		'Verbrauch August 2026 – kein Rechnungssteller',
		'Aleph Cloud: Verbrauch aus dem Guthaben (Credits) abgerechnet, ohne Rechnung',
		'Verbrauchsauszug VA-2026-08-01',
		'Aleph Cloud (wolkenfabrik-web)',
		'2.000 ALEPH-CREDIT',
		'Verbrauch (2 × Ressource): 2.200 ALEPH-CREDIT',
		'Aleph Cloud rechnet die Nutzung seiner Ressourcen',
		'Der Kauf des Guthabens war eine Vorauszahlung',
		'jeweils für den Tag des Verbrauchs'
	])
		assert.ok(t.includes(expected), expected);

	const csv = eigenbelegCsv(doc).split('\r\n');
	const usage = csv.filter((l) => l.includes('Verbrauch (aus Guthaben abgerechnet)'));
	assert.equal(usage.length, 2);
	assert.ok(
		usage.every((l) => l.startsWith('EB-2026-007;') && /;ja;$/.test(l)),
		usage.join('\n')
	);
});

test('Aleph: with the purchase on an Eigenbeleg too (includeKinds swap), the consumption comes after it', async () => {
	const entries = await alephPurchaseEntries();
	const account = entries[0].account;
	const doc = buildDocument({
		payer: { ...payer, addresses: [account] },
		chain: 'aleph',
		network: 'mainnet',
		period: AUGUST,
		entries,
		number: 'EB-2026-007',
		includeKinds: ['swap'],
		issuedAt: ISSUED,
		layout: 'single',
		consumption: [{ account, month: '2026-08', statementNumber: 'VA-2026-08-01' }]
	});
	assert.deepEqual(
		[...doc.transactions.map((t) => t.number), ...doc.consumption.map((r) => r.number)],
		['EB-2026-007', 'EB-2026-008']
	);
	assert.equal(doc.number, 'EB-2026-007 – EB-2026-008');
	assert.equal(doc.consumption[0].unvalued, 0);
	// A usage row without a rate: listed with its quantity, not in the amount.
	const unvalued = entries.map((e) => (e.id === 'u2' ? { ...e, eur: null } : e));
	const open = buildDocument({
		payer: { ...payer, addresses: [account] },
		chain: 'aleph',
		network: 'mainnet',
		period: AUGUST,
		entries: unvalued,
		includeKinds: [],
		issuedAt: ISSUED,
		layout: 'single',
		consumption: [{ account, month: '2026-08' }]
	});
	assert.equal(open.consumption[0].unvalued, 1);
	assert.equal(open.consumption[0].totals.eurExact, '0.00032');
	const t = await text(await eigenbelegPdf(open));
	assert.ok(t.includes('ohne verlässlichen Kurs'), 'says that a row is not in the amount');
	assert.ok(!t.includes('Einzelheiten'), 'no statement named: no line for it');
});

test('in English, and never in the collective layout or for another chain', async () => {
	const entries = await alephEntries();
	const account = entries[0].account;
	const base = {
		payer: { ...payer, addresses: [account] },
		chain: 'aleph',
		network: 'mainnet',
		period: AUGUST,
		entries,
		includeKinds: [],
		issuedAt: ISSUED,
		consumption: [{ account, month: '2026-08', statementNumber: 'VA-2026-08-01' }]
	};
	const doc = buildDocument({ ...base, layout: 'single', language: 'en' });
	const t = await text(await eigenbelegPdf(doc));
	for (const expected of [
		'Self-Issued Receipt',
		'Consumption August 2026 – no invoicing party',
		'usage statement VA-2026-08-01',
		'Aleph purchase price 0.000002 USD per credit'
	])
		assert.ok(t.includes(expected), expected);
	assert.throws(() => buildDocument({ ...base, layout: 'collective' }), /single layout/);
	assert.throws(() => buildDocument({ ...base, chain: 'near', layout: 'single' }), /aleph/);
	// A month without usage gets no Eigenbeleg.
	const july = buildDocument({
		...base,
		layout: 'single',
		consumption: [{ account, month: '2026-07' }]
	});
	assert.deepEqual(july.consumption, []);
});

test('Filecoin Pay: the settlements in sums per rail, at the dollar stablecoin’s rate', async () => {
	const PAYER = `0x${'1a'.repeat(20)}`;
	const PROVIDER = `0x${'a1'.repeat(20)}`;
	const USDFC = FILECOIN_PAY.token.contract;
	const WARM = Object.keys(FILECOIN_PAY.services)[0];
	const client = createFilecoinPayClient({
		fetch: filecoinPayFetch({
			contract: FILECOIN_PAY.contract,
			token: USDFC,
			funds: { [PAYER]: '7.3' },
			events: [
				{ at: '2026-07-01T10:00:00Z', deposit: '10', token: USDFC, from: PAYER, to: PAYER },
				{
					at: '2026-07-01T10:05:00Z',
					rail: 7,
					payer: PAYER,
					payee: PROVIDER,
					token: USDFC,
					operator: WARM
				},
				{
					at: '2026-08-03T09:00:00Z',
					settled: '1.2',
					railId: 7,
					toPayee: '1.19',
					commission: '0',
					fee: '0.01',
					upTo: '2026-08-03T00:00:00Z'
				},
				{ at: '2026-08-22T12:00:00Z', oneTime: '0.5', railId: 7 }
			]
		}),
		sleep: async () => {},
		pauseMs: 0,
		now: () => new Date('2026-09-10T00:00:00Z')
	});
	const month = await client.statement({ address: PAYER, month: '2026-08' });
	const entries = await valueEntries(filecoinPayEntries(month), fixedRates({ USDC: '0.9' }));
	const doc = buildDocument({
		payer: { ...payer, addresses: [PAYER] },
		chain: 'filecoin-pay',
		network: 'mainnet',
		period: AUGUST,
		entries,
		number: 'EB-2026-010',
		includeKinds: [],
		issuedAt: ISSUED,
		layout: 'single',
		consumption: [{ account: PAYER, month: '2026-08', statementNumber: 'VA-2026-08-01' }]
	});
	const [r] = doc.consumption;
	assert.equal(r.lineName, 'Rail');
	assert.equal(r.lines.length, 1, 'one rail');
	const [line] = r.lines;
	assert.equal(line.count, 2, 'the settlement and the one-off payment');
	assert.equal(line.recipient, PROVIDER);
	assert.deepEqual(line.quantities, { USDFC: '1.7' });
	assert.equal(r.totals.eur, '1.53');
	const t = await text(await eigenbelegPdf(doc));
	assert.ok(t.includes('Speicheranbieter von Filecoin Onchain Cloud'));
	assert.ok(t.includes('Verbrauchsauszug VA-2026-08-01'));
});

test('Akash: the deployments’ lease payouts of the month, from their own entries, in ACT at 1 USD', async () => {
	const ADDRESS = `akash1${'q'.repeat(38)}`;
	const usage = await valueEntries(
		akashUsageEntries({
			address: ADDRESS,
			month: '2026-07',
			deployments: [
				{
					dseq: '1',
					state: 'closed',
					createdAt: '2026-07-10T00:00:00.000Z',
					settledAt: '2026-07-20T00:00:00.000Z',
					transferred: '1'
				},
				{
					dseq: '2',
					state: 'active',
					createdAt: '2026-06-21T00:00:00.000Z',
					settledAt: '2026-07-21T00:00:00.000Z',
					transferred: '3'
				}
			]
		}),
		fixedRates({ USD: '0.85' })
	);
	const doc = buildDocument({
		payer: { ...payer, addresses: [ADDRESS] },
		chain: 'akash',
		network: 'mainnet',
		period: { from: '2026-07-01', to: '2026-07-31' },
		entries: [],
		number: 'EB-2026-020',
		includeKinds: [],
		issuedAt: '2026-08-01T08:00:00.000Z',
		layout: 'single',
		consumption: [
			{ account: ADDRESS, month: '2026-07', statementNumber: 'KA-2026-07-01', entries: usage }
		]
	});
	const [r] = doc.consumption;
	assert.deepEqual(
		r.lines.map((l) => [l.label, l.quantities, l.eurExact]),
		[
			['Deployment 1', { ACT: '1' }, '0.85'],
			['Deployment 2', { ACT: '2' }, '1.7']
		]
	);
	assert.equal(r.lines[1].detail, 'Laufzeit 2026-06-21 – 2026-07-21, gesamt 3 ACT, Anteil 66.7 %');
	assert.equal(doc.totals.eur, '2.55');
	const t = await text(await eigenbelegPdf(doc));
	for (const expected of [
		'Verbrauch Juli 2026 – kein Rechnungssteller',
		'Anbieter im Akash-Netzwerk',
		'Kontoauszug KA-2026-07-01',
		'Laufzeit 2026-06-21 – 2026-07-21',
		'Akash ACT zu 1 USD je ACT (Burn-Mint)'
	])
		assert.ok(t.includes(expected), expected);
	const csv = eigenbelegCsv(doc);
	assert.match(
		csv,
		/EB-2026-020;2;2026-07-31;23:59:59;akash;mainnet;akash1q+;Verbrauch \(aus Guthaben abgerechnet\);Ausgang;Deployment 2 \(akash-providers\);ACT;native;-2;0,85;-1,7;/
	);
});
