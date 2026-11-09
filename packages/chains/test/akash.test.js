// SPDX-License-Identifier: AGPL-3.0-or-later
// Akash as ledger entries: what a document books of what the Cosmos reader
// gives. Made-up entries in the shape the reader gives (WalletEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moduleAddress } from '../src/bech32.js';
import { AKASH_CHAIN } from '../src/cosmos-chains.js';
import * as akash from '../src/akash.js';

const account = moduleAddress('akash', 'wolkenfabrik-example');
const we = (/** @type {any} */ over) => ({
	id: 'H:fee',
	hash: 'H',
	height: 1,
	time: '2026-10-05T10:00:00.000Z',
	date: '2026-10-05',
	type: 'fee',
	kind: 'fee',
	asset: 'AKT',
	amount: '-0.005',
	decimals: 6,
	counterparty: '',
	counterpartyLabel: '',
	memo: '',
	success: false,
	explorerUrl: 'https://www.mintscan.io/akash/transactions/H',
	...over
});

test('a fee goes to the network, also for a failed transaction', () => {
	const e = akash.toLedger(we({}), { chain: AKASH_CHAIN, account });
	assert.deepEqual(
		[e.type, e.kind, e.counterparty, e.counterpartyLabel, e.priceAs, e.success, e.schema],
		[
			'fee',
			'fee',
			'akash',
			'Akash-Netzwerk (Gebühr an Validatoren)',
			'AKT',
			true,
			'le-space.ledger/1'
		]
	);
	assert.equal(e.id, `akash:${account}:H:fee`);
});

test('escrow, IBC and unlisted denoms', () => {
	const c = { chain: AKASH_CHAIN, account };
	const escrow = akash.toLedger(
		we({
			id: 'H:m0:e1.0:AKT',
			type: 'sent',
			kind: 'transfer',
			amount: '-5',
			counterpartyLabel: 'Akash-Escrow (Deployment)',
			success: true
		}),
		c
	);
	assert.equal(escrow.kind, 'escrow');
	const ibc = akash.toLedger(
		we({ id: 'H:m0:e2.0:AKT', type: 'sent', kind: 'ibc', amount: '-1', success: true }),
		c
	);
	assert.equal(ibc.kind, 'transfer');
	const act = akash.toLedger(
		we({
			id: 'H:m0:e3.0:ACT',
			type: 'received',
			kind: 'swap',
			asset: 'ACT',
			amount: '2',
			listed: false,
			contract: 'uact',
			success: true
		}),
		c
	);
	assert.deepEqual([act.kind, act.priceAs, act.contract], ['swap', '', 'uact']);
	const reward = akash.toLedger(
		we({ id: 'H:m0:e4.0:AKT', type: 'received', kind: 'reward', amount: '0.1', success: true }),
		c
	);
	assert.equal(reward.kind, 'reward');
});

test('addresses are checked by their bech32 checksum before anything is fetched', async () => {
	assert.ok(akash.isAddress(account));
	assert.ok(!akash.isAddress('akash1notreal'));
	assert.ok(!akash.isAddress(moduleAddress('n', 'x')));
	let asked = 0;
	const fetch = /** @type {typeof globalThis.fetch} */ (
		async () => {
			asked++;
			return new Response('{}', { status: 503 });
		}
	);
	await assert.rejects(
		akash.readAkash({ account: 'akash1notreal', from: '2026-10-01', to: '2026-10-31', fetch }),
		/not a valid Akash address/
	);
	assert.equal(asked, 0);
});

test('endpoints can be handed in; a browser reads through its own proxy', async () => {
	/** @type {string[]} */
	const asked = [];
	const fetch = /** @type {typeof globalThis.fetch} */ (
		async (/** @type {any} */ url) => {
			asked.push(String(url));
			return new Response('{}', { status: 503 });
		}
	);
	await assert.rejects(
		akash.statementAkash({
			account,
			from: '2026-10-01',
			to: '2026-10-31',
			fetch,
			endpoints: {
				rpc: 'https://proxy.example/akash-rpc',
				rest: 'https://proxy.example/akash-rest'
			}
		})
	);
	assert.ok(asked.length > 0);
	for (const u of asked) assert.ok(u.startsWith('https://proxy.example/'), u);
	assert.equal(AKASH_CHAIN.endpoints.rpc, 'https://akash-rpc.publicnode.com', 'the defaults stay');
});

test('the live check wants the node of Akash’s own chain', async () => {
	const status = (/** @type {string} */ network) =>
		/** @type {typeof globalThis.fetch} */ (
			async () =>
				new Response(
					JSON.stringify({
						result: { node_info: { network }, sync_info: { latest_block_height: '1200' } }
					}),
					{ status: 200 }
				)
		);
	const ok = await akash.probe({
		fetch: status(AKASH_CHAIN.chainId),
		endpoints: { rpc: 'https://node.example' }
	});
	assert.deepEqual(ok, { sample: 'https://node.example status', entries: 1 });
	await assert.rejects(akash.probe({ fetch: status('other-1') }), /belongs to another chain/);
});
