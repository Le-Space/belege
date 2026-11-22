// A NEAR account as an own wallet, through the wallet service (wallets.js),
// against a made-up NearBlocks and RPC: what an exchange paid out arrives as
// `received` under the transaction's hash, a transfer out gives the payment
// and its fee, a listed token is booked and an airdropped one only counted,
// the balance is the RPC's. Every account, hash and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAINS, createWalletService } from '../src/index.js';
import { NEAR, fakeNear, yocto } from './support/fake-near.js';

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

// A made-up DEX and made-up hashes: NEAR wrapped, the wNEAR swapped for USDC,
// and half a NEAR left wrapped.
const DEX = 'tauschboerse.near';
const WRAP = 'Wrap111111111111111111111111111111111111111';
const SWAP = 'Swap111111111111111111111111111111111111111';
const signed = (over) => ({
	block: { block_height: '300' },
	signer_account_id: OURS,
	receiver_account_id: 'wrap.near',
	outcomes: { status: true },
	outcomes_agg: { transaction_fee: '446365125000000000000' },
	...over
});
const moved = (over) => ({
	block: { block_height: '301' },
	affected_account_id: OURS,
	involved_account_id: DEX,
	contract_account_id: 'wrap.near',
	cause: 'TRANSFER',
	event_index: '0',
	...over
});
const T1 = '1795000000000000000';
const T2 = '1795000060000000000';

test('wNEAR is NEAR: wrapping leaves only its gas, the swap at the DEX is one swap of NEAR for USDC', async () => {
	const { fetch } = fakeNear({
		txns: [
			signed({
				transaction_hash: SWAP,
				block_timestamp: T2,
				block: { block_height: '301' },
				actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer_call' }],
				actions_agg: { deposit: '1' }
			}),
			signed({
				transaction_hash: WRAP,
				block_timestamp: T1,
				actions: [{ action: 'FUNCTION_CALL', method: 'near_deposit' }],
				actions_agg: { deposit: yocto('2.5') }
			})
		],
		ftTxns: [
			moved({
				transaction_hash: SWAP,
				block_timestamp: T2,
				contract_account_id: NEAR.usdc,
				delta_amount: '5670000',
				receipt_id: 's2'
			}),
			moved({
				transaction_hash: SWAP,
				block_timestamp: T2,
				delta_amount: `-${yocto('2')}`,
				receipt_id: 's1'
			}),
			moved({
				transaction_hash: WRAP,
				block_timestamp: T1,
				block: { block_height: '300' },
				involved_account_id: '',
				cause: 'MINT',
				delta_amount: yocto('2.5'),
				receipt_id: 'w1'
			})
		],
		account: { amount: yocto('7'), locked: '0' },
		usdc: '5670000',
		wnear: yocto('0.5')
	});
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	assert.deepEqual(
		result.entries.map((e) => [e.id, e.type, e.kind, e.asset, e.amount, e.counterparty]),
		[
			[`${WRAP}:fee`, 'fee', 'fee', 'NEAR', '-0.000446365125', ''],
			[`${SWAP}:fee`, 'fee', 'fee', 'NEAR', '-0.000446365125', ''],
			[`${SWAP}:ft:s1:0`, 'sent', 'swap', 'NEAR', '-2', DEX],
			[`${SWAP}:ft:s2:0`, 'received', 'swap', 'USDC', '5.67', DEX]
		]
	);
	const [wrapGas, swapGas, gave] = result.entries;
	assert.equal(wrapGas.swap, undefined, 'wrapping is no swap');
	// What an earlier reading booked and this one leaves out: the NEAR handed
	// to the wrap contract, and the wNEAR minted for it.
	assert.deepEqual(result.superseded, [`${WRAP}:deposit`, `${WRAP}:ft:w1:0`]);
	assert.deepEqual(gave.swap, {
		gave: [{ asset: 'NEAR', amount: '2', listed: true }],
		got: [{ asset: 'USDC', amount: '5.67', listed: true }],
		via: DEX,
		fee: { asset: 'NEAR', amount: '0.000446365125' }
	});
	assert.deepEqual(swapGas.swap, gave.swap);
	// 7 NEAR in the account and 0.5 still wrapped.
	assert.deepEqual(result.balances, [
		{ asset: 'NEAR', amount: '7.5', decimals: 24 },
		{ asset: 'USDC', amount: '5.67', decimals: 6 }
	]);
	assert.equal(result.unknownAssets, 0);
});

test('unwrapping gives no entry but its gas', async () => {
	const { fetch } = fakeNear({
		txns: [
			signed({
				transaction_hash: WRAP,
				block_timestamp: T1,
				actions: [{ action: 'FUNCTION_CALL', method: 'near_withdraw' }],
				actions_agg: { deposit: '1' }
			})
		],
		ftTxns: [
			moved({
				transaction_hash: WRAP,
				block_timestamp: T1,
				involved_account_id: '',
				cause: 'BURN',
				delta_amount: `-${yocto('2.5')}`,
				receipt_id: 'w1'
			})
		]
	});
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	assert.deepEqual(
		result.entries.map((e) => [e.type, e.asset, e.amount]),
		[['fee', 'NEAR', '-0.000446365125']]
	);
});

// Before a swap the wallet registers the account at the contracts the swap
// touches, each in a transaction of its own (#968). Made-up contracts and
// hashes; the swap gives 2 NEAR as wNEAR to the DEX and gets USDC.
const SWAP_DEX = 'dex.example.near';
const OTHER = 'token-a.example.near';
const SWAP_AT = 1_795_000_600_000n; // ms
const at = (/** @type {bigint} */ ms) => (ms * 1_000_000n).toString();
/** A transaction the account signed, `ms` before (negative: after) the swap. */
const registration = (
	/** @type {string} */ hash,
	/** @type {string} */ contract,
	/** @type {bigint} */ before,
	method = 'storage_deposit',
	deposit = yocto('0.00125')
) =>
	signed({
		transaction_hash: hash,
		block_timestamp: at(SWAP_AT - before),
		receiver_account_id: contract,
		actions: [{ action: 'FUNCTION_CALL', method }],
		actions_agg: { deposit }
	});
const hashOf = (/** @type {string} */ n) => `${n}${'1'.repeat(43 - n.length)}`;

function swapWithRegistrations(/** @type {any[]} */ registrations) {
	return fakeNear({
		txns: [
			signed({
				transaction_hash: SWAP,
				block_timestamp: at(SWAP_AT),
				block: { block_height: '301' },
				actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer_call' }],
				actions_agg: { deposit: '1' }
			}),
			...registrations
		],
		ftTxns: [
			moved({
				transaction_hash: SWAP,
				block_timestamp: at(SWAP_AT),
				involved_account_id: SWAP_DEX,
				contract_account_id: NEAR.usdc,
				delta_amount: '5670000',
				receipt_id: 's2'
			}),
			moved({
				transaction_hash: SWAP,
				block_timestamp: at(SWAP_AT),
				involved_account_id: SWAP_DEX,
				delta_amount: `-${yocto('2')}`,
				receipt_id: 's1'
			})
		],
		account: { amount: yocto('7'), locked: '0' },
		usdc: '5670000'
	});
}

test('a storage deposit made shortly before a swap, at a contract it involves, is a cost of that swap', async () => {
	const tied = {
		usdc: hashOf('Usdc'), // at the token got, a minute before
		wrap: hashOf('Wrap'), // at wNEAR for the NEAR given, exactly five minutes before
		dex: hashOf('Dex') // at the DEX, for several tokens at once
	};
	const left = {
		early: hashOf('Early'), // five minutes and a millisecond before
		other: hashOf('Other'), // at a contract the swap does not touch
		after: hashOf('After'), // after the swap
		unregister: hashOf('Unreg') // a refund asked for: never part of a swap
	};
	const { fetch } = swapWithRegistrations([
		registration(tied.usdc, NEAR.usdc, 60_000n),
		registration(tied.wrap, 'wrap.near', 300_000n),
		registration(tied.dex, SWAP_DEX, 120_000n, 'tokens_storage_deposit'),
		registration(left.early, NEAR.usdc, 300_001n),
		registration(left.other, OTHER, 30_000n),
		registration(left.after, NEAR.usdc, -30_000n),
		registration(left.unregister, NEAR.usdc, 10_000n, 'storage_unregister', '1')
	]);
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	const byId = new Map(result.entries.map((e) => [e.id, e]));

	const sides = {
		gave: [{ asset: 'NEAR', amount: '2', listed: true }],
		got: [{ asset: 'USDC', amount: '5.67', listed: true }],
		via: SWAP_DEX,
		fee: { asset: 'NEAR', amount: '0.000446365125' },
		storage: { asset: 'NEAR', amount: '0.00375' }
	};
	for (const [hash, contract] of [
		[tied.usdc, NEAR.usdc],
		[tied.wrap, 'wrap.near'],
		[tied.dex, SWAP_DEX]
	]) {
		const e = byId.get(`${hash}:deposit`);
		assert.deepEqual(
			[e?.type, e?.kind, e?.amount, e?.counterparty, e?.partOf, e?.hash],
			['fee', 'fee', '-0.00125', contract, SWAP, hash],
			hash
		);
		assert.deepEqual(e?.swap, sides);
		// Its transaction's gas goes with it.
		assert.equal(byId.get(`${hash}:fee`)?.partOf, SWAP);
	}
	// The swap's legs and gas name what the deposits kept.
	for (const id of [`${SWAP}:ft:s1:0`, `${SWAP}:ft:s2:0`, `${SWAP}:fee`]) {
		assert.deepEqual(byId.get(id)?.swap, sides, id);
		assert.equal(byId.get(id)?.partOf, undefined);
	}
	for (const hash of Object.values(left)) {
		const e = byId.get(`${hash}:deposit`);
		assert.equal(e?.type, 'sent', hash);
		assert.equal(e?.partOf, undefined, hash);
		assert.equal(e?.swap, undefined, hash);
		assert.equal(byId.get(`${hash}:fee`)?.partOf, undefined, hash);
	}
	assert.deepEqual(result.superseded, []);
});

test('a storage deposit with no swap after it stays a payment of its own', async () => {
	const hash = hashOf('Alone');
	const { fetch } = fakeNear({
		txns: [registration(hash, NEAR.usdc, 0n)],
		ftTxns: [],
		account: { amount: yocto('7'), locked: '0' }
	});
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	assert.deepEqual(
		result.entries.map((e) => [e.id, e.type, e.amount, e.counterparty, e.partOf]),
		[
			[`${hash}:deposit`, 'sent', '-0.00125', NEAR.usdc, undefined],
			[`${hash}:fee`, 'fee', '-0.000446365125', '', undefined]
		]
	);
});

test('of two swaps a deposit belongs to the first one after it', async () => {
	const later = hashOf('Later');
	const dep = hashOf('Dep');
	const { fetch } = fakeNear({
		txns: [
			signed({
				transaction_hash: later,
				block_timestamp: at(SWAP_AT + 60_000n),
				actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer_call' }],
				actions_agg: { deposit: '1' }
			}),
			signed({
				transaction_hash: SWAP,
				block_timestamp: at(SWAP_AT),
				actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer_call' }],
				actions_agg: { deposit: '1' }
			}),
			registration(dep, SWAP_DEX, 30_000n, 'tokens_storage_deposit')
		],
		ftTxns: [SWAP, later].flatMap((hash, i) => [
			moved({
				transaction_hash: hash,
				block_timestamp: at(SWAP_AT + BigInt(i) * 60_000n),
				involved_account_id: SWAP_DEX,
				contract_account_id: NEAR.usdc,
				delta_amount: '1000000',
				receipt_id: `g${i}`
			}),
			moved({
				transaction_hash: hash,
				block_timestamp: at(SWAP_AT + BigInt(i) * 60_000n),
				involved_account_id: SWAP_DEX,
				delta_amount: `-${yocto('0.5')}`,
				receipt_id: `p${i}`
			})
		]),
		account: { amount: yocto('7'), locked: '0' },
		usdc: '2000000'
	});
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	const byId = new Map(result.entries.map((e) => [e.id, e]));
	assert.equal(byId.get(`${dep}:deposit`)?.partOf, SWAP);
	assert.equal(byId.get(`${SWAP}:ft:g0:0`)?.swap?.storage?.amount, '0.00125');
	assert.equal(byId.get(`${later}:ft:g1:0`)?.swap?.storage, undefined);
});
