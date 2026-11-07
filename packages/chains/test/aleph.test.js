// SPDX-License-Identifier: AGPL-3.0-or-later
// Aleph Cloud credits by the package alone: a month's statement from a fake
// API (a fetch handed in), and its lines as ledger entries. The bridge's
// /aleph route has its own tests there. Made-up accounts and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alephEntries, createAlephClient } from '../src/aleph.js';
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
			['2026-08-01', 'execution', 2000, '0.000002', 'purchase'],
			['2026-08-01', 'storage', 200, '0.000002', 'purchase']
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
	assert.deepEqual(vm.unitPrice, { currency: 'USD', amount: '0.000002', source: 'purchase' });
	assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test('a purchase in the month is an entry with its price and paying transaction', async () => {
	const s = await client().statement({ address: ACCOUNT, month: '2026-07' });
	const [bought] = alephEntries(s);
	assert.deepEqual(
		[bought.type, bought.amount, bought.hash, bought.counterpartyLabel, bought.unitPrice?.amount],
		[
			'received',
			'1000000',
			`0x${'ab'.repeat(32)}`,
			'Aleph Cloud (Kauf mit ALEPH auf ETH)',
			'0.000002'
		]
	);
});
