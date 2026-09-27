// Aleph Cloud credits, read only (issue #113): the monthly statement and the
// scan of own addresses. A fake Aleph API on 127.0.0.1; everything made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createAlephClient, monthWindow, summarise } from '../src/aleph.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { fakeAlephAddress, fakeItemHash, startFakeAleph } from './support/fake-aleph.js';
import { request } from './support/http.js';

const noSleep = async () => {};
const account = fakeAlephAddress('hosting account');
const other = fakeAlephAddress('another account');
const vm = fakeItemHash('relay vm');
const billing = fakeItemHash('billing post');

/** EUR per USD, the same every day. */
const rates = {
	rate: async (/** @type {string} */ asset, /** @type {string} */ date) => {
		assert.equal(asset, 'USD');
		return { asset, date, rate: '0.9', source: 'ecb' };
	}
};

/** A month of made-up entries: a purchase before it, a transfer in, storage and a VM. */
function sampleRows() {
	return [
		// July: bought at 0.000002 USD per credit (not the list price)
		{
			at: '2026-07-20T08:00:00.000Z',
			amount: 1_000_000,
			price: '0.000002',
			txHash: '0x' + 'ab'.repeat(32)
		},
		// August
		{
			at: '2026-08-01T00:30:00.000Z',
			amount: -100,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 3,
			sizeMib: 12.5
		},
		{
			at: '2026-08-01T01:30:00.000Z',
			amount: -100,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 4,
			sizeMib: 13
		},
		{
			at: '2026-08-01T02:00:00.000Z',
			amount: -2000,
			paymentMethod: 'credit_expense',
			originRef: billing,
			origin: vm
		},
		{
			at: '2026-08-02T00:30:00.000Z',
			amount: -150,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 4,
			sizeMib: 13
		},
		{ at: '2026-08-15T12:00:00.000Z', amount: 50_000, origin: other },
		{
			at: '2026-08-20T12:00:00.000Z',
			amount: -5_000,
			paymentMethod: 'credit_transfer',
			origin: other
		},
		// September: after the month
		{
			at: '2026-09-01T00:30:00.000Z',
			amount: -120,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 4,
			sizeMib: 13
		}
	];
}

describe('the month', () => {
	test('is the UTC month, first to last second', () => {
		assert.deepEqual(monthWindow('2026-02'), {
			start: Date.UTC(2026, 1, 1) / 1000,
			end: Date.UTC(2026, 2, 1) / 1000 - 1,
			next: Date.UTC(2026, 2, 1) / 1000
		});
		assert.throws(() => monthWindow('2026-13'), { code: 'ALEPH_MONTH' });
	});
});

describe('summarise', () => {
	test('storage per day in one line, each instance apart, top-ups and transfers out', () => {
		const rows = sampleRows().filter((r) => r.at.startsWith('2026-08'));
		const raw = rows.map((r) => ({
			amount: r.amount,
			message_timestamp: r.at,
			payment_method: r.paymentMethod ?? (r.price ? 'token' : 'credit_transfer'),
			origin_ref: r.originRef ?? null,
			origin: r.origin ?? null,
			price: r.price ?? null,
			tx_hash: r.txHash ?? null,
			expense_count: r.count ?? null,
			expense_size_mib: r.sizeMib ?? null
		}));
		const { usage, topUps, transfersOut } = summarise({
			rows: raw,
			purchases: [{ message_timestamp: '2026-07-20T08:00:00.000Z', price: '0.000002' }]
		});
		assert.deepEqual(
			usage.map((u) => [
				u.date,
				u.kind,
				u.resource,
				u.credits,
				u.entries,
				u.resources,
				u.sizeMib,
				u.usdPerCredit,
				u.priceSource
			]),
			[
				['2026-08-01', 'execution', vm, 2000, 1, 0, null, '0.000002', 'purchase'],
				['2026-08-01', 'storage', null, 200, 2, 4, 13, '0.000002', 'purchase'],
				['2026-08-02', 'storage', null, 150, 1, 4, 13, '0.000002', 'purchase']
			]
		);
		assert.deepEqual(
			topUps.map((t) => [t.how, t.credits, t.from]),
			[['transfer', 50_000, other]]
		);
		assert.deepEqual(
			transfersOut.map((t) => [t.credits, t.to]),
			[[5_000, other]]
		);
	});

	test('without any purchase, the list price', () => {
		const { usage } = summarise({
			rows: [
				{
					amount: -10,
					message_timestamp: '2026-08-03T00:00:00Z',
					payment_method: 'credit_expense',
					origin_ref: 'storage'
				}
			],
			purchases: []
		});
		assert.equal(usage[0].usdPerCredit, '0.000001');
		assert.equal(usage[0].priceSource, 'list');
	});
});

describe('a statement from the Aleph API', () => {
	/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let api;
	const september = () => new Date('2026-09-10T00:00:00.000Z');
	before(async () => {
		// Balance now: everything up to 10 September.
		const rows = sampleRows();
		const balance = 2_000_000 + rows.reduce((n, r) => n + r.amount, 0);
		api = await startFakeAleph({
			accounts: { [account]: { balance, rows } },
			messages: { [vm]: { type: 'INSTANCE', name: 'test-relay' } }
		});
	});
	after(() => api?.close());

	test('opening + in − out = closing, EUR at the purchase price and the day’s rate', async () => {
		const s = await createAlephClient({ sleep: noSleep, rates, now: september }).statement({
			address: account,
			month: '2026-08',
			api: api.url
		});
		assert.equal(s.opening, 2_000_000 + 1_000_000);
		assert.equal(s.closing, s.opening - 2350 + 50_000 - 5_000);
		assert.equal(s.difference, 0);
		assert.deepEqual(s.totals, { topUps: 50_000, transfersOut: 5_000, usage: 2350, eurCents: 0 });
		// 2000 credits × 0.000002 USD × 0.9 EUR/USD = 0.0036 EUR → 0 cents; a line keeps its rate
		assert.equal(s.usage[0].eurPerUsd, '0.9');
		assert.deepEqual(s.resources, { [vm]: { type: 'INSTANCE', name: 'test-relay' } });
		assert.equal(s.rateSource, 'ecb');
		assert.equal(s.entries, 6);
	});

	test('a month without anything: zero lines, same opening and closing', async () => {
		const s = await createAlephClient({ sleep: noSleep, now: september }).statement({
			address: account,
			month: '2026-06',
			api: api.url
		});
		assert.deepEqual([s.usage.length, s.topUps.length, s.difference], [0, 0, 0]);
		assert.equal(s.opening, s.closing);
	});

	test('a month to come, or not an address, is refused before any request', async () => {
		const client = createAlephClient({ sleep: noSleep, now: september });
		const before = api.calls.length;
		await assert.rejects(client.statement({ address: account, month: '2026-11', api: api.url }), {
			code: 'ALEPH_MONTH'
		});
		await assert.rejects(client.statement({ address: '0x12', month: '2026-08', api: api.url }), {
			code: 'ALEPH_ADDRESS'
		});
		assert.equal(api.calls.length, before);
	});

	test('the scan of own addresses: an account with credits, one Aleph never saw', async () => {
		const nobody = fakeAlephAddress('never used');
		const found = await createAlephClient({ sleep: noSleep }).accounts({
			addresses: [account, nobody, account.toUpperCase().replace('0X', '0x')],
			api: api.url
		});
		assert.deepEqual(
			found.map((a) => [a.address, a.credits > 0, a.entries]),
			[
				[account, true, 8],
				[nobody, false, 0]
			]
		);
	});
});

describe('/aleph on the bridge', () => {
	/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let api;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	let port = 0;
	let token = '';
	/** @type {string[]} */ const logs = [];
	before(async () => {
		api = await startFakeAleph({ accounts: { [account]: { balance: 10, rows: sampleRows() } } });
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		bridge = createBridgeServer({
			config: { ...defaultConfig(), appOrigins: [] },
			pairing,
			hibiscus: null,
			aleph: createAlephClient({ sleep: noSleep, now: () => new Date('2026-09-10T00:00:00Z') }),
			alephLoopback: true,
			log: (line) => logs.push(line)
		});
		({ port } = await bridge.listen({ port: 0 }));
		token = await pairing.pair(pairing.issueCode());
	});
	after(async () => {
		await bridge?.close();
		await api?.close();
	});
	const auth = () => ({ authorization: `Bearer ${token}` });

	test('a statement and a scan, with a token; no address in the log', async () => {
		const s = await request(
			port,
			`/aleph/statement?address=${account}&month=2026-08&api=${encodeURIComponent(api.url)}`,
			{ headers: auth() }
		);
		assert.equal(s.status, 200);
		assert.equal(s.json.difference, 0);
		const scan = await request(port, '/aleph/accounts', {
			method: 'POST',
			headers: { ...auth(), 'content-type': 'application/json' },
			body: { addresses: [account], api: api.url }
		});
		assert.equal(scan.status, 200);
		assert.equal(scan.json.accounts.length, 1);
		assert.equal(
			(await request(port, `/aleph/statement?address=${account}&month=2026-08`)).status,
			401
		);
		assert.ok(logs.some((l) => l.startsWith('aleph: statement')));
		assert.ok(logs.every((l) => !/0x[0-9a-f]{40}/i.test(l)));
	});

	test('an API that is not https (nor this Mac in tests) is refused', async () => {
		const r = await request(
			port,
			`/aleph/statement?address=${account}&month=2026-08&api=${encodeURIComponent('http://example.org')}`,
			{ headers: auth() }
		);
		assert.equal(r.status, 400);
	});
});
