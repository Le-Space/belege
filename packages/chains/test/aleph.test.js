// SPDX-License-Identifier: AGPL-3.0-or-later
// Aleph Cloud credits by the package alone: a month's statement from a fake
// API (a fetch handed in), and its lines as ledger entries. The bridge's
// /aleph route has its own tests there. Made-up accounts and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	alephEntries,
	createAlephClient,
	PURCHASE_EXPLORERS,
	purchaseEntries
} from '../src/aleph.js';
import { CHAINS } from '../src/registry.js';
import { toChecksumAddress } from '../src/evm.js';
import { alephFetch } from './support/aleph-fetch.js';
import { ACCOUNT, OTHER, VM, flatUsd, sampleBalance, sampleRows } from './support/aleph-sample.js';

const client = () =>
	createAlephClient({
		fetch: alephFetch({
			accounts: { [ACCOUNT]: { balance: sampleBalance(), rows: sampleRows() } },
			messages: { [VM]: { type: 'INSTANCE', name: 'test-relay' } }
		}),
		sleep: async () => {},
		rates: flatUsd,
		now: () => new Date('2026-09-10T00:00:00Z')
	});

test('a month: opening + in − out = closing, consumption at the purchase price', async () => {
	const s = await client().statement({ address: ACCOUNT, month: '2026-08' });
	assert.equal(s.opening, 3_000_000);
	assert.equal(s.closing, 3_000_000 - 2200 + 50_000 - 5_000);
	assert.equal(s.difference, 0);
	assert.deepEqual(
		s.usage.map((u) => [u.date, u.kind, u.credits, u.usdPerCredit, u.priceSource]),
		[
			// 1 USD for 1,200,000 credits: the bonus makes a credit cheaper than the list price.
			['2026-08-01', 'execution', 2000, '0.000000833333', 'purchase'],
			['2026-08-01', 'storage', 200, '0.000000833333', 'purchase']
		]
	);
	assert.deepEqual(s.resources, { [VM]: { type: 'INSTANCE', name: 'test-relay' } });
});

test('as ledger entries: in, out and usage, signed from the account, with the USD price', async () => {
	const entries = alephEntries(await client().statement({ address: ACCOUNT, month: '2026-08' }));
	assert.deepEqual(
		entries.map((e) => [e.date, e.type, e.kind, e.amount, e.counterparty]),
		[
			['2026-08-01', 'sent', 'usage', '-200', 'aleph'],
			['2026-08-01', 'sent', 'usage', '-2000', 'aleph'],
			['2026-08-15', 'received', 'transfer', '50000', OTHER],
			['2026-08-20', 'sent', 'transfer', '-5000', OTHER]
		]
	);
	const vm = /** @type {import('@le-space/ledger').LedgerEntry} */ (
		entries.find((e) => e.hash === VM)
	);
	assert.equal(vm.chain, 'aleph');
	assert.equal(vm.account, toChecksumAddress(ACCOUNT));
	assert.equal(vm.asset, 'ALEPH-CREDIT');
	assert.equal(vm.priceAs, '');
	assert.equal(vm.hash, VM);
	assert.equal(vm.counterpartyLabel, 'Aleph Cloud (test-relay)');
	assert.deepEqual(vm.unitPrice, { currency: 'USD', amount: '0.000000833333', source: 'purchase' });
	assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test('a later month still names every earlier purchase with its paying transaction', async () => {
	const july = await client().statement({ address: ACCOUNT, month: '2026-07' });
	const august = await client().statement({ address: ACCOUNT, month: '2026-08' });
	const bought = july.topUps.filter((t) => t.how === 'purchase' && t.txHash);
	assert.ok(bought.length > 0);
	// August had no purchase of its own, and lists July's.
	assert.equal(august.topUps.filter((t) => t.how === 'purchase').length, 0);
	assert.deepEqual(
		august.purchases.map((p) => [p.time, p.credits, p.txHash]),
		bought.map((t) => [t.time, t.credits, t.txHash])
	);
});

test('a purchase in the month is an entry with its price and paying transaction', async () => {
	const s = await client().statement({ address: ACCOUNT, month: '2026-07' });
	const [bought] = alephEntries(s);
	assert.deepEqual(
		[bought.type, bought.amount, bought.hash, bought.counterpartyLabel, bought.unitPrice?.amount],
		[
			'received',
			'1200000',
			`0x${'ab'.repeat(32)}`,
			'Aleph Cloud (Kauf mit ALEPH auf ethereum)',
			'0.000000833333'
		]
	);
});

test('the payment behind a purchase in ALEPH: in USD at the list price, never the token amount; linked on the chain it was paid on', async () => {
	const july = await client().statement({ address: ACCOUNT, month: '2026-07' });
	const [paid] = purchaseEntries(july);
	assert.deepEqual(
		[paid.chain, paid.type, paid.kind, paid.asset, paid.decimals, paid.amount, paid.priceAs],
		['aleph', 'sent', 'swap', 'USD', 6, '-1', 'USD'],
		"1,000,000 credits paid for × the list price; the row's price, 0.00008, is ALEPH per credit"
	);
	// What the old reading made of it: credits × price as dollars, 96 instead of 1.
	assert.notEqual(paid.amount, '-96');
	assert.deepEqual(
		[july.topUps[0].tokenAmount, july.topUps[0].usd, july.topUps[0].priceBasis],
		['80', '1', 'list']
	);
	assert.equal(paid.counterparty, 'aleph');
	assert.equal(
		paid.counterpartyLabel,
		'Aleph Cloud (Kauf von 1200000 Credits mit ALEPH auf ethereum)'
	);
	assert.equal(paid.memo, '1000000 Credits × 0.000001 USD (+ 200000 Bonus); bezahlt mit 80 ALEPH');
	assert.equal(paid.hash, `0x${'ab'.repeat(32)}`);
	assert.equal(paid.explorerUrl, `https://etherscan.io/tx/0x${'ab'.repeat(32)}`);
	const [bought] = alephEntries(july);
	assert.equal(bought.hash, paid.hash, 'the credits bought and their payment share the hash');
	assert.notEqual(bought.id, paid.id);
	// August has no purchase: transfers in are not payments.
	assert.deepEqual(
		purchaseEntries(await client().statement({ address: ACCOUNT, month: '2026-08' })),
		[]
	);
	// The explorers spelled out for the browser bundle are the registry's.
	assert.deepEqual(PURCHASE_EXPLORERS, {
		ETH: CHAINS.ethereum.explorer,
		BASE: CHAINS.base.explorer
	});
	// A purchase paid on a chain the table does not know, or without a hash, links the Aleph explorer page.
	const [unknown] = purchaseEntries({
		...july,
		topUps: [{ ...july.topUps[0], chain: 'SOL', txHash: null }]
	});
	assert.equal(unknown.explorerUrl, `https://explorer.aleph.cloud/address/ETH/${july.address}`);
	assert.equal(
		unknown.counterpartyLabel,
		'Aleph Cloud (Kauf von 1200000 Credits mit ALEPH auf SOL)'
	);
	// Aleph's older code for the chain links the same explorer.
	const [coded] = purchaseEntries({ ...july, topUps: [{ ...july.topUps[0], chain: 'ETH' }] });
	assert.equal(coded.explorerUrl, paid.explorerUrl);
	// A purchase in a dollar token: the row's price is the dollar price.
	const [dollars] = purchaseEntries({
		...july,
		topUps: [
			{
				...july.topUps[0],
				credits: 2_000_000,
				bonus: 0,
				price: '0.000001',
				token: 'USDC',
				tokenAmount: '2',
				usd: '2',
				usdPerCredit: '0.000001',
				priceBasis: 'price'
			}
		]
	});
	assert.deepEqual([dollars.amount, dollars.memo], ['-2', '2000000 Credits × 0.000001 USD']);
});

test('a month without credit rows: Aleph answers 404 in plain text, the statement is empty', async () => {
	const account = `0x${'e5'.repeat(20)}`;
	/** @type {string[]} */
	const asked = [];
	const json = (/** @type {unknown} */ body) =>
		new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
	const aleph = createAlephClient({
		fetch: async (input) => {
			const url = new URL(String(input));
			asked.push(url.pathname + url.search);
			if (url.pathname.endsWith('/balance')) return json({ credit_balance: 1234 });
			if (url.pathname.endsWith('/credit_history/summary'))
				return json({ total_amount: 0, entry_count: 0 });
			// As Aleph answers a window that holds no rows.
			return new Response('No credit history found for this address', {
				status: 404,
				headers: { 'content-type': 'text/plain' }
			});
		},
		sleep: async () => {},
		rates: flatUsd,
		now: () => new Date('2026-09-10T00:00:00Z')
	});
	const s = await aleph.statement({ address: account, month: '2026-08' });
	assert.equal(s.opening, 1234);
	assert.equal(s.closing, 1234);
	assert.equal(s.difference, 0);
	assert.deepEqual(s.usage, []);
	assert.ok(asked.some((u) => /\/credit_history\?page=1&pagination=\d+&startDate=/.test(u)));
	assert.deepEqual(alephEntries(s), []);
});
