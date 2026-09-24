import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	fingerprint,
	ibanAllowed,
	maskIban,
	normalizeAccount,
	normalizeTransaction,
	parseAmountCents,
	parseDate
} from '../src/normalize.js';
import { sampleData } from './support/fake-hibiscus.js';

test('amounts: both Hibiscus formats and the usual spellings, to integer cents', () => {
	const cases = /** @type {[unknown, number][]} */ ([
		['-22,42', -2242],
		['1439.76', 143976],
		['1.439,76', 143976],
		['1,439.76', 143976],
		['-1.234.567,89', -123456789],
		['7,5', 750],
		['-5', -500],
		['0,00', 0],
		['+12,30', 1230],
		['12,30-', -1230],
		['1.439.000', 143900000],
		['0.10', 10],
		[1439.76, 143976],
		[-0.3, -30],
		['2,500', 250]
	]);
	for (const [input, cents] of cases) {
		assert.equal(parseAmountCents(input), cents, `${input}`);
		assert.ok(Number.isSafeInteger(parseAmountCents(input)));
	}
});

test('amounts: refuses what is not money', () => {
	for (const bad of ['', 'abc', '1,2,3,4.5x', '1.439', '12,345', '--3']) {
		assert.throws(() => parseAmountCents(bad), undefined, bad);
	}
});

test('dates: ISO with and without time, XML-RPC compact, German', () => {
	assert.equal(parseDate('2026-09-22'), '2026-09-22');
	assert.equal(parseDate('2026-09-22 00:00:00'), '2026-09-22');
	assert.equal(parseDate('20260922T00:00:00'), '2026-09-22');
	assert.equal(parseDate('22.9.2026'), '2026-09-22');
	assert.equal(parseDate(''), null);
	assert.throws(() => parseDate('2026-02-30'));
	assert.throws(() => parseDate('yesterday'));
});

test('IBAN suffix filter and masking', () => {
	assert.equal(ibanAllowed('DE00 0000 0000 0000 0047 11', ['4711']), true);
	assert.equal(ibanAllowed('DE00000000000000004711', [' 47 11 ']), true);
	assert.equal(ibanAllowed('DE00 0000 0000 0000 0099 99', ['4711']), false);
	assert.equal(ibanAllowed('', ['4711']), false);
	assert.equal(ibanAllowed('DE00000000000000004711', []), false);
	assert.equal(ibanAllowed('DE00000000000000004711', ['']), false);
	assert.equal(maskIban('DE00 0000 0000 0000 0047 11'), 'DE00 **** 4711');
});

test('fingerprint: stable, whitespace- and case-insensitive in the text, sensitive to the facts', () => {
	const base = {
		account: 'hibiscus:1',
		date: '2026-09-22',
		amountCents: -2242,
		purpose: 'Rechnung  KR-1\n',
		counterpartyName: 'Nordlicht GmbH'
	};
	const fp = fingerprint(base);
	assert.match(fp, /^fp1:[0-9a-f]{64}$/);
	assert.equal(fingerprint({ ...base }), fp);
	assert.equal(
		fingerprint({ ...base, purpose: 'rechnung kr-1', counterpartyName: ' NORDLICHT GMBH' }),
		fp
	);
	// A known value, so a change of the algorithm cannot slip through: the app
	// computes the same for CAMT files (app/src/lib/bank/fingerprint.spec.js).
	assert.equal(fp, 'fp1:e545ee3e0b85df5ad59544b178f42faef35bbaa5ff49500e706ce726506a2396');
	for (const change of [
		{ amountCents: -2243 },
		{ date: '2026-09-23' },
		{ account: 'hibiscus:2' },
		{ purpose: 'Rechnung KR-2' },
		{ counterpartyName: 'Südlicht' }
	]) {
		assert.notEqual(fingerprint({ ...base, ...change }), fp, JSON.stringify(change));
	}
});

test('account and transaction normalisation', () => {
	const { accounts, transactions } = sampleData();
	const account = normalizeAccount(accounts[0]);
	assert.deepEqual(account, {
		id: '1',
		ibanMasked: 'DE00 **** 4711',
		ibanLast4: '4711',
		name: 'Geschäftskonto Test',
		currency: 'EUR',
		balanceCents: 123456,
		balanceDate: '2026-09-22'
	});
	assert.equal(JSON.stringify(account).includes('0000 0000'), false, 'no full IBAN');

	const debit = normalizeTransaction(transactions[0], account);
	assert.equal(debit.amountCents, -2242);
	assert.equal(debit.date, '2026-09-22');
	assert.equal(debit.counterpartyName, 'Kaffeerösterei Nordlicht GmbH');
	assert.equal(debit.counterpartyIban, 'DE00000000000000001234');
	assert.equal(debit.endToEndId, 'KR20260917');
	assert.equal(debit.bookingType, 'Basislastschrift');
	assert.equal(debit.sourceId, '101');
	assert.match(debit.purpose, /EREF\+KR20260917/);

	const credit = normalizeTransaction(transactions[1], account);
	assert.equal(credit.amountCents, 143976);
	assert.equal(credit.valueDate, '2026-09-23');
	assert.equal(credit.endToEndId, '', 'NOTPROVIDED is no id');

	// No counterparty IBAN field: taken from the purpose's IBAN+ tag; EREF likewise.
	const fromPurpose = normalizeTransaction(transactions[2], account);
	assert.equal(fromPurpose.counterpartyIban, 'IE00ABCD00000000000001');
	assert.equal(fromPurpose.endToEndId, 'ABO-0814');
});
