// What a NEAR storage deposit was for (near-storage.js), read from the chain:
// a swap, a transfer to the account it registered, a swap whose route passed
// through the token, the first receipt of the token, or nothing. Through the
// wallet service (Belege) and through readNear (Eigenbeleg), against a made-up
// NearBlocks and RPC. Every account, hash and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWalletService } from '../src/index.js';
import { readNear } from '../src/near.js';
import { registrationOf, storagePurposes } from '../src/near-storage.js';
import {
	STORAGE_BEFORE_RECEIPT_MS,
	STORAGE_BEFORE_SWAP_MS,
	STORAGE_BEFORE_TRANSFER_MS
} from '../src/near-wallet.js';
import { NEAR, fakeNear, storageCall, yocto } from './support/fake-near.js';

const OURS = NEAR.wallet;
const OTHER_OWN = 'konto-b.near';
const EXCHANGE = NEAR.exchange;
const USDT = 'usdt.tether-token.near';
const AGGREGATOR = 'tauschroute.example.near';
const T0 = 1_795_000_000_000n; // ms
const at = (/** @type {bigint | number} */ ms) => (BigInt(ms) * 1_000_000n).toString();
const hashOf = (/** @type {string} */ n) => `${n}${'1'.repeat(43 - n.length)}`;

/** A transaction the account signed, at `ms`. */
const signed = (
	/** @type {string} */ hash,
	/** @type {string} */ receiver,
	/** @type {bigint | number} */ ms,
	method = 'storage_deposit',
	deposit = yocto('0.00125')
) => ({
	transaction_hash: hash,
	block_timestamp: at(ms),
	block: { block_height: String(Number(BigInt(ms) / 1000n) % 100_000) },
	signer_account_id: OURS,
	receiver_account_id: receiver,
	actions: [{ action: 'FUNCTION_CALL', method }],
	actions_agg: { deposit },
	outcomes: { status: true },
	outcomes_agg: { transaction_fee: '446365125000000000000' }
});
/** A token movement of the account, at `ms`. */
const moved = (
	/** @type {string} */ hash,
	/** @type {string} */ contract,
	/** @type {string} */ delta,
	/** @type {string} */ other,
	/** @type {bigint | number} */ ms,
	receipt = 'r0'
) => ({
	transaction_hash: hash,
	block_timestamp: at(ms),
	block: { block_height: '1' },
	affected_account_id: OURS,
	involved_account_id: other,
	contract_account_id: contract,
	delta_amount: delta,
	cause: 'TRANSFER',
	receipt_id: receipt,
	event_index: '0'
});

/** The wallet service's entries by id, and what the RPC was asked. */
async function sync(/** @type {Parameters<typeof fakeNear>[0]} */ o) {
	const { fetch, state } = fakeNear({ account: { amount: yocto('7'), locked: '0' }, ...o });
	const result = await createWalletService({ fetch }).sync({ chain: 'near', address: OURS });
	return { byId: new Map(result.entries.map((e) => [e.id, e])), result, state };
}

test('the call says whom a deposit registers; without account_id the signer', () => {
	assert.deepEqual(registrationOf(storageCall({ account_id: OTHER_OWN }), OURS), {
		account: OTHER_OWN
	});
	assert.deepEqual(registrationOf(storageCall({ registration_only: true }), OURS), {
		account: OURS,
		only: true
	});
	assert.deepEqual(
		registrationOf(
			storageCall({ token_ids: [NEAR.usdc, 'Kein Konto'] }, 'tokens_storage_deposit'),
			OURS
		),
		{ account: OURS, tokens: [NEAR.usdc] }
	);
	// Nothing guessed: no call, arguments that are no object, an account id that is none.
	assert.equal(registrationOf(undefined, OURS), undefined);
	assert.equal(
		registrationOf(
			{ actions: [{ FunctionCall: { method_name: 'storage_deposit', args: btoa('[1]') } }] },
			OURS
		),
		undefined
	);
	assert.equal(
		registrationOf(
			{ actions: [{ FunctionCall: { method_name: 'storage_deposit', args: 'kein base64!' } }] },
			OURS
		),
		undefined
	);
	assert.equal(registrationOf(storageCall({ account_id: 'Böse/../x' }), OURS), undefined);
	assert.equal(registrationOf({ actions: [{ Transfer: { deposit: '1' } }] }, OURS), undefined);
});

test('1. a deposit registering another account, then a transfer of the token to it: a cost of that transfer', async () => {
	const dep = hashOf('RegB');
	const pay = hashOf('PayB');
	const late = hashOf('RegLate');
	const latePay = hashOf('PayLate');
	const { byId } = await sync({
		txns: [
			signed(pay, NEAR.usdc, T0 + 60_000n, 'ft_transfer', '1'),
			signed(dep, NEAR.usdc, T0),
			// Five minutes and a millisecond before its transfer: too early.
			signed(
				latePay,
				NEAR.usdc,
				T0 + 3_600_000n + BigInt(STORAGE_BEFORE_TRANSFER_MS) + 1n,
				'ft_transfer',
				'1'
			),
			signed(late, NEAR.usdc, T0 + 3_600_000n)
		],
		ftTxns: [
			moved(pay, NEAR.usdc, '-12340000', OTHER_OWN, T0 + 60_000n),
			moved(
				latePay,
				NEAR.usdc,
				'-1000000',
				OTHER_OWN,
				T0 + 3_600_000n + BigInt(STORAGE_BEFORE_TRANSFER_MS) + 1n
			)
		],
		txStatus: {
			[dep]: { transaction: storageCall({ account_id: OTHER_OWN }) },
			[late]: { transaction: storageCall({ account_id: OTHER_OWN }) }
		},
		usdc: '0'
	});
	const deposit = byId.get(`${dep}:deposit`);
	assert.deepEqual(
		[deposit?.type, deposit?.kind, deposit?.amount, deposit?.counterparty, deposit?.purpose],
		['fee', 'fee', '-0.00125', NEAR.usdc, 'storage']
	);
	assert.deepEqual(deposit?.enables, { hash: pay, kind: 'transfer' });
	assert.deepEqual(deposit?.registration, { account: OTHER_OWN });
	assert.equal(deposit?.partOf, undefined);
	assert.deepEqual(byId.get(`${dep}:fee`)?.enables, { hash: pay, kind: 'transfer' });
	// The transfer itself stays what it was.
	const transfer = byId.get(`${pay}:ft:r0:0`);
	assert.deepEqual(
		[transfer?.type, transfer?.amount, transfer?.counterparty, transfer?.enables],
		['sent', '-12.34', OTHER_OWN, undefined]
	);
	// Too early: a storage deposit of its own.
	const alone = byId.get(`${late}:deposit`);
	assert.deepEqual(
		[alone?.type, alone?.purpose, alone?.enables, alone?.partOf],
		['fee', 'storage', undefined, undefined]
	);
});

test('1. a transfer to someone other than the account registered is not what the deposit was for', async () => {
	const dep = hashOf('RegC');
	const pay = hashOf('PayC');
	const { byId } = await sync({
		txns: [signed(pay, NEAR.usdc, T0 + 60_000n, 'ft_transfer', '1'), signed(dep, NEAR.usdc, T0)],
		ftTxns: [moved(pay, NEAR.usdc, '-12340000', NEAR.customer, T0 + 60_000n)],
		txStatus: { [dep]: { transaction: storageCall({ account_id: OTHER_OWN }) } },
		usdc: '0'
	});
	assert.equal(byId.get(`${dep}:deposit`)?.enables, undefined);
	assert.equal(byId.get(`${dep}:deposit`)?.purpose, 'storage');
});

test('2. a deposit registering the wallet itself, then its first receipt of the token: a cost of that receipt', async () => {
	const dep = hashOf('RegSelf');
	const got = hashOf('GotUsdc');
	const tooLate = hashOf('RegOld');
	const { byId } = await sync({
		txns: [
			signed(dep, NEAR.usdc, T0),
			// A day and a millisecond before the next receipt of USDT: too early.
			signed(tooLate, USDT, T0)
		],
		ftTxns: [
			// Two hours later, paid out by an exchange (signed there, no gas of ours).
			moved(got, NEAR.usdc, '50000000', EXCHANGE, T0 + 7_200_000n),
			moved(
				hashOf('GotUsdt'),
				USDT,
				'1000000',
				EXCHANGE,
				T0 + BigInt(STORAGE_BEFORE_RECEIPT_MS) + 1n
			)
		],
		txStatus: {
			[dep]: { transaction: storageCall({ account_id: OURS, registration_only: true }) },
			[tooLate]: { transaction: storageCall({}) }
		},
		usdc: '50000000'
	});
	const deposit = byId.get(`${dep}:deposit`);
	assert.deepEqual([deposit?.type, deposit?.purpose], ['fee', 'storage']);
	assert.deepEqual(deposit?.enables, { hash: got, kind: 'receipt' });
	assert.deepEqual(deposit?.registration, { account: OURS, only: true });
	assert.deepEqual(byId.get(`${dep}:fee`)?.enables, { hash: got, kind: 'receipt' });
	assert.equal(byId.get(`${tooLate}:deposit`)?.enables, undefined);
});

/** A swap of 2 NEAR (as wNEAR) for 5.67 USDC through an aggregator, a minute after a deposit at USDT. */
function routedSwap(/** @type {string[]} */ route) {
	const dep = hashOf('RegUsdt');
	const swap = hashOf('RoutedSwap');
	return {
		dep,
		swap,
		o: {
			txns: [
				signed(swap, 'wrap.near', T0 + 60_000n, 'ft_transfer_call', '1'),
				signed(dep, USDT, T0)
			],
			ftTxns: [
				moved(swap, NEAR.usdc, '5670000', AGGREGATOR, T0 + 60_000n, 's2'),
				moved(swap, 'wrap.near', `-${yocto('2')}`, AGGREGATOR, T0 + 60_000n, 's1')
			],
			txStatus: {
				[dep]: { transaction: storageCall({}) },
				[swap]: {
					receipts: route.map((receiver) => ({ predecessor_id: AGGREGATOR, receiver_id: receiver }))
				}
			},
			usdc: '5670000'
		}
	};
}

test('3. a deposit at a token the swap passed through on its route is part of the swap', async () => {
	const { dep, swap, o } = routedSwap(['wrap.near', USDT, NEAR.usdc]);
	const { byId, state } = await sync(o);
	const deposit = byId.get(`${dep}:deposit`);
	assert.deepEqual([deposit?.type, deposit?.partOf, deposit?.enables], ['fee', swap, undefined]);
	assert.equal(byId.get(`${dep}:fee`)?.partOf, swap);
	assert.deepEqual(byId.get(`${swap}:ft:s2:0`)?.swap?.storage, {
		asset: 'NEAR',
		amount: '0.00125'
	});
	// One request for the deposit (what it kept and whom it registered), one for the swap's route.
	assert.deepEqual(
		state.asked.filter((a) => a.rpc === 'EXPERIMENTAL_tx_status').map((a) => a.tx),
		[dep, swap]
	);
});

test('3. a deposit at a token the route did not touch stays a storage deposit of its own', async () => {
	const { dep, o } = routedSwap(['wrap.near', NEAR.usdc]);
	const { byId } = await sync(o);
	const deposit = byId.get(`${dep}:deposit`);
	assert.deepEqual(
		[deposit?.type, deposit?.purpose, deposit?.partOf, deposit?.enables],
		['fee', 'storage', undefined, undefined]
	);
});

test('3. a swap more than five minutes after the deposit is not asked for its route', async () => {
	const { dep, swap, o } = routedSwap([USDT]);
	o.txns[0] = signed(
		swap,
		'wrap.near',
		T0 + BigInt(STORAGE_BEFORE_SWAP_MS) + 1n,
		'ft_transfer_call',
		'1'
	);
	o.ftTxns = o.ftTxns.map((f) => ({
		...f,
		block_timestamp: at(T0 + BigInt(STORAGE_BEFORE_SWAP_MS) + 1n)
	}));
	const { byId, state } = await sync(o);
	assert.equal(byId.get(`${dep}:deposit`)?.partOf, undefined);
	assert.deepEqual(
		state.asked.filter((a) => a.rpc === 'EXPERIMENTAL_tx_status').map((a) => a.tx),
		[dep]
	);
});

test('a refund asked for is never tied; a deposit sent back in full is none', async () => {
	const unreg = hashOf('Unreg');
	const back = hashOf('Back');
	const pay = hashOf('PayD');
	const { byId } = await sync({
		txns: [
			signed(pay, NEAR.usdc, T0 + 60_000n, 'ft_transfer', '1'),
			signed(unreg, NEAR.usdc, T0, 'storage_unregister', '1'),
			signed(back, NEAR.usdc, T0)
		],
		ftTxns: [moved(pay, NEAR.usdc, '-12340000', OTHER_OWN, T0 + 60_000n)],
		txStatus: {
			[back]: {
				transaction: storageCall({ account_id: OTHER_OWN }),
				// Registered already: all of it sent back.
				receipts: [
					{
						predecessor_id: NEAR.usdc,
						receiver_id: OURS,
						receipt: { Action: { actions: [{ Transfer: { deposit: yocto('0.00125') } }] } }
					}
				]
			}
		},
		usdc: '0'
	});
	assert.equal(byId.get(`${back}:deposit`), undefined);
	assert.equal(byId.get(`${back}:fee`)?.enables, undefined);
	const refund = byId.get(`${unreg}:deposit`);
	assert.deepEqual(
		[refund?.type, refund?.purpose, refund?.enables],
		['sent', undefined, undefined]
	);
});

test('Eigenbeleg reads the same: readNear ties each deposit, the kind stays storage', async () => {
	const dep = hashOf('RegB');
	const pay = hashOf('PayB');
	const { dep: routed, swap, o } = routedSwap(['wrap.near', USDT, NEAR.usdc]);
	const { fetch } = fakeNear({
		txns: [
			signed(pay, NEAR.usdc, T0 + 600_000n, 'ft_transfer', '1'),
			signed(dep, NEAR.usdc, T0 + 540_000n),
			...o.txns
		],
		ftTxns: [moved(pay, NEAR.usdc, '-12340000', OTHER_OWN, T0 + 600_000n), ...o.ftTxns],
		txStatus: { ...o.txStatus, [dep]: { transaction: storageCall({ account_id: OTHER_OWN }) } }
	});
	const day = new Date(Number(T0)).toISOString().slice(0, 10);
	const entries = await readNear({ account: OURS, from: day, to: day, fetch });
	const byHash = (/** @type {string} */ h, /** @type {string} */ type) =>
		entries.find((e) => e.hash === h && e.type === type);
	const a = byHash(dep, 'sent');
	assert.deepEqual(
		[a?.kind, a?.purpose, a?.enables, a?.registration],
		['storage', 'storage', { hash: pay, kind: 'transfer' }, { account: OTHER_OWN }]
	);
	assert.deepEqual(byHash(dep, 'fee')?.enables, { hash: pay, kind: 'transfer' });
	const b = byHash(routed, 'sent');
	assert.deepEqual([b?.kind, b?.partOf], ['storage', swap]);
});

test('a route that cannot be read fails the read, naming the host and not the account', async () => {
	const { o } = routedSwap([USDT]);
	const { fetch: inner } = fakeNear(o);
	/** @type {typeof fetch} */
	const fetch = async (url, init) => {
		const body = init?.body ? JSON.parse(String(init.body)) : null;
		if (body?.params?.tx_hash === hashOf('RoutedSwap')) return new Response('', { status: 400 });
		return inner(url, init);
	};
	await assert.rejects(
		createWalletService({ fetch }).sync({ chain: 'near', address: OURS }),
		(/** @type {any} */ e) => /fastnear/.test(e.message) && !e.message.includes(OURS)
	);
});

test('without a way to read routes, only what the entries show is tied', async () => {
	const entries = /** @type {any[]} */ ([
		{
			id: 'd',
			hash: 'D',
			type: 'sent',
			kind: 'storage',
			purpose: 'storage',
			success: true,
			contract: 'native',
			counterparty: USDT,
			account: OURS,
			time: new Date(Number(T0)).toISOString(),
			amount: '-0.00125',
			decimals: 24
		}
	]);
	assert.deepEqual(await storagePurposes(entries), entries);
});

test('1. a deposit registering another account goes with its transfer, even just before an own swap of the token', async () => {
	const dep = hashOf('RegBeforeSwap');
	const pay = hashOf('PayAfterSwap');
	const { o, swap } = routedSwap([]);
	const { byId } = await sync({
		txns: [
			signed(pay, NEAR.usdc, T0 + 120_000n, 'ft_transfer', '1'),
			...o.txns,
			signed(dep, NEAR.usdc, T0 + 30_000n)
		],
		ftTxns: [moved(pay, NEAR.usdc, '-1000000', OTHER_OWN, T0 + 120_000n, 'p0'), ...o.ftTxns],
		txStatus: { ...o.txStatus, [dep]: { transaction: storageCall({ account_id: OTHER_OWN }) } },
		usdc: '4670000'
	});
	const deposit = byId.get(`${dep}:deposit`);
	assert.deepEqual(
		[deposit?.partOf, deposit?.enables],
		[undefined, { hash: pay, kind: 'transfer' }]
	);
	// The swap's own sides keep no storage of it.
	assert.equal(byId.get(`${swap}:ft:s2:0`)?.swap?.storage, undefined);
});
