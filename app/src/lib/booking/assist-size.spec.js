// "✦ Konto vorschlagen" over the bridge's own node (#969): the sealed request
// must fit UCEP's 64 KiB, also for a read-in chart of 1300 accounts with names
// of DATEV length, and the accounts that matter for the payment stay in it.
// A made-up chart, vendors and payment only.
import { sealCall } from '@le-space/bridge-protocol/seal';
import { LIMITS } from '@le-space/ucep';
import { describe, expect, it } from 'vitest';

import { checkRequestSize } from '../sync/remote-bridge.js';
import { MAX_ACCOUNTS, MAX_ASSIST_BYTES, accountsForAssist, jsonBytes } from './assist-input.js';
import { assistBody } from './assist-request.js';
import { searchAccounts } from './skr03.js';

const NOUNS = ['Aufwendungen', 'Erlöse', 'Forderungen', 'Verbindlichkeiten', 'Rückstellungen'];
const TAILS = [
	'19 % Vorsteuer',
	'7 % USt',
	'steuerfrei § 4 Nr. 8 ff. UStG',
	'innergemeinschaftlich'
];

/** A made-up chart: 4-digit accounts in every class, names of 50–120 characters. */
function bigChart(n = 1300) {
	const accounts = Array.from({ length: n }, (_, i) => {
		const base = `${NOUNS[i % NOUNS.length]} aus Übungsgeschäften ${TAILS[i % TAILS.length]}`;
		return {
			number: String(1000 + i * 6),
			name: (base + ' Zusatz').repeat(1 + (i % 3)).slice(0, 120)
		};
	});
	accounts.push({ number: '4925', name: 'Telefax und Internetkosten' });
	return { accounts, format: /** @type {const} */ ('datev'), fileName: 'plan.csv', importedAt: '' };
}

const partners = Array.from({ length: 80 }, (_, i) => ({
	name: `Beispiel Lieferant ${i} GmbH`,
	account: String(4000 + i)
}));
const learnedName = (/** @type {string} */ v) => `gebucht für ${v}`;

/** @param {Record<string, any>} tx @param {any} chart */
function body(tx, chart) {
	return assistBody({
		tx,
		receipt: null,
		own: { name: 'Konto A' },
		partners,
		catalogue: searchAccounts('', { income: (tx.amountCents ?? 0) > 0, chart }),
		chart,
		learnedName
	});
}

const out = {
	amountCents: -1234,
	bookedOn: '2026-01-02',
	counterparty: 'Wolkenfabrik Hosting GmbH',
	purpose: 'Internetkosten Januar'
};

describe('the booking.assist request for a large chart', () => {
	const chart = bigChart();

	it('fits UCEP’s request limit once sealed, with the redaction terms the client adds', async () => {
		const args = {
			...body(out, chart),
			redactTerms: Array.from({ length: 20 }, (_, i) => `Musterbegriff ${i}`.padEnd(200, 'x')),
			$accept: ['blocks']
		};
		expect(jsonBytes(args)).toBeLessThanOrEqual(MAX_ASSIST_BYTES);
		const key = crypto.getRandomValues(new Uint8Array(32));
		const call = await sealCall(
			key,
			{ consumer: '12D3KooWa', provider: '12D3KooWb', command: 'llm.booking' },
			args
		);
		expect(jsonBytes(call.sent)).toBeLessThan(LIMITS.request);
		expect(() => checkRequestSize('llm.booking', call.sent)).not.toThrow();
	});

	it('the old 600 accounts of the same chart did not fit: the stream refuses them', async () => {
		const all = chart.accounts.slice(0, MAX_ACCOUNTS);
		const key = crypto.getRandomValues(new Uint8Array(32));
		const call = await sealCall(
			key,
			{ consumer: '12D3KooWa', provider: '12D3KooWb', command: 'llm.booking' },
			{ ...body(out, chart), accounts: all }
		);
		expect(() => checkRequestSize('llm.booking', call.sent)).toThrow(/too large/);
	});

	it('learned accounts first, then the account the payment names, then costs before revenue', () => {
		const { accounts } = body(out, chart);
		expect(accounts.length).toBeGreaterThan(200);
		expect(accounts[0].number).toBe('4000');
		const numbers = accounts.map((a) => a.number);
		const after = numbers.slice(new Set(partners.map((p) => p.account)).size);
		expect(after[0]).toBe('4925');
		const firstRevenue = after.findIndex((n) => n.startsWith('8'));
		const lastCost = after.findLastIndex((n) => n.startsWith('3') || n.startsWith('4'));
		expect(firstRevenue === -1 || firstRevenue > lastCost).toBe(true);
	});

	it('money in: revenue accounts come before costs', () => {
		const { accounts } = body({ ...out, amountCents: 1234, purpose: 'Zahlung' }, chart);
		const after = accounts.map((a) => a.number).slice(80);
		const firstCost = after.findIndex((n) => n.startsWith('3') || n.startsWith('4'));
		const lastRevenue = after.findLastIndex((n) => n.startsWith('8'));
		expect(firstCost === -1 || firstCost > lastRevenue).toBe(true);
	});
});

describe('accountsForAssist with a budget', () => {
	it('stops at the budget in bytes, never at half an account', () => {
		const catalogue = Array.from({ length: 50 }, (_, i) => ({
			number: String(4100 + i),
			name: 'Übungskonto'
		}));
		const list = accountsForAssist(catalogue, [], null, learnedName, { budget: 400 });
		expect(jsonBytes(list)).toBeLessThanOrEqual(400);
		expect(list.length).toBeGreaterThan(5);
	});
});
