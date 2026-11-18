// A NEAR account as an own wallet, through the wallet service (wallets.js),
// against a made-up NearBlocks and RPC: what an exchange paid out arrives as
// `received` under the transaction's hash, a transfer out gives the payment
// and its fee, a listed token is booked and an airdropped one only counted,
// the balance is the RPC's. Every account, hash and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAINS, createWalletService } from '../src/index.js';
import { NEAR, fakeNear } from './support/fake-near.js';

const { fetch: fakeFetch, state } = fakeNear();
const OURS = NEAR.wallet;
const EXCHANGE = NEAR.exchange;
const IN = NEAR.hashIn;
const OUT = NEAR.hashOut;

const service = createWalletService({ fetch: fakeFetch });

test('NEAR is one of the chains, with NearBlocks and an RPC as its endpoints', () => {
	const near = service.chains().find((c) => c.id === 'near');
	assert.deepEqual(
		[near?.kind, near?.nativeSymbol, near?.assets, Object.keys(near?.endpoints ?? {})],
		['near', 'NEAR', ['NEAR', 'USDC'], ['api', 'rpc']]
	);
});

test('an account: a withdrawal arrives under its hash, a transfer out with its fee, the listed token', async () => {
	state.asked = [];
	const result = await service.sync({ chain: 'near', address: ` ${OURS.toUpperCase()} ` });
	assert.deepEqual(
		result.entries.map((e) => [e.id, e.type, e.kind, e.asset, e.amount, e.counterparty]),
		[
			[`${IN}:deposit`, 'received', 'transfer', 'NEAR', '21.25', EXCHANGE],
			[`${NEAR.hashToken}:ft:r2:0`, 'received', 'transfer', 'USDC', '12.34', 'stromwerk.near'],
			[`${OUT}:deposit`, 'sent', 'transfer', 'NEAR', '-1.5', 'stromwerk.near'],
			[`${OUT}:fee`, 'fee', 'fee', 'NEAR', '-0.000446365125', '']
		]
	);
	const arrived = result.entries[0];
	assert.equal(arrived.hash, IN);
	assert.equal(arrived.decimals, 24);
	assert.equal(arrived.date, '2026-11-14');
	assert.equal(arrived.explorerUrl, `https://nearblocks.io/txns/${IN}`);
	assert.deepEqual(result.balances, [
		{ asset: 'NEAR', amount: '19.75', decimals: 24 },
		{ asset: 'USDC', amount: '12.34', decimals: 6 }
	]);
	assert.equal(result.transactions, 3);
	// The token that only calls itself USDC is counted, not booked.
	assert.equal(result.unknownAssets, 1);
	assert.equal(result.addressUrl, `https://nearblocks.io/address/${OURS}`);
	assert.deepEqual(result.endpoints, CHAINS.near.endpoints);
	assert.ok(
		state.asked.every((a) =>
			/^https:\/\/(api\.nearblocks\.io|archival-rpc\.mainnet\.fastnear\.com)/.test(a.url)
		)
	);
});

test('what is no account id is refused before anything is asked', async () => {
	state.asked = [];
	await assert.rejects(
		service.sync({ chain: 'near', address: 'Kein Konto!' }),
		(/** @type {any} */ e) => e.code === 'WALLET_ADDRESS' && e.status === 400
	);
	assert.equal(state.asked.length, 0);
});

test('a refusal names the hosts, never the account', async () => {
	state.nearBlocksStatus = 403;
	try {
		await assert.rejects(
			service.sync({ chain: 'near', address: OURS }),
			(/** @type {any} */ e) =>
				e.code === 'WALLET_NODE' &&
				/api\.nearblocks\.io/.test(e.message) &&
				!e.message.includes(OURS)
		);
	} finally {
		state.nearBlocksStatus = 200;
	}
});

test('an own endpoint must be https', async () => {
	await assert.rejects(
		service.sync({ chain: 'near', address: OURS, endpoints: { rpc: 'http://example.com' } }),
		(/** @type {any} */ e) => e.code === 'WALLET_ENDPOINT'
	);
});
