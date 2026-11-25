// Akash: what the indexer has no amount for, from an archive node's blocks,
// and the tokens that come back when an unbonding ends (#1029). A pruned fake
// node, a fake indexer and a fake archive node without a transaction index,
// on 127.0.0.1; every address, hash and amount is made up.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { moduleAddress } from '@le-space/chains/bech32';
import { completedUnbondingsOf, readEvents, unbondingsOf } from '@le-space/chains/cosmos';
import { createWalletService } from '@le-space/chains';
import {
	blockTime,
	completeUnbonding,
	consoleTx,
	cosmosTx,
	fakeCosmosAddress,
	startFakeAkashConsole,
	startFakeCosmos,
	withTxHash
} from './support/fake-chains.js';

const W = fakeCosmosAddress('akash archive wallet', 'akash');
const O = fakeCosmosAddress('akash archive other', 'akash');
const V = 'akashvaloper1wolkenfabrikvalidator';
const distribution = moduleAddress('akash', 'distribution');
const escrow = moduleAddress('akash', 'escrow');
const notBonded = moduleAddress('akash', 'not_bonded_tokens_pool');
const noSleep = async () => {};
const fee = (/** @type {string} */ amount) => ({ payer: W, amount });

// The old part of the history, as the chain has it: a delegation, a reward
// withdrawal, an escrow refund (a deployment closed), an undelegation with
// the rewards it withdrew on the way.
const delegate = withTxHash(
	cosmosTx({
		seed: 'a-delegate',
		height: 1200,
		memo: 'a-delegate',
		prefix: 'akash',
		fee: fee('4000uakt'),
		coinEvents: true,
		delegations: [{ delegator: W, amount: '15000000uakt', validator: V }]
	})
);
const reward = withTxHash(
	cosmosTx({
		seed: 'a-reward',
		height: 1500,
		memo: 'a-reward',
		prefix: 'akash',
		fee: fee('5000uakt'),
		transfers: [{ sender: distribution, recipient: W, amount: '2500000uakt' }]
	})
);
const refund = withTxHash(
	cosmosTx({
		seed: 'a-refund',
		height: 1600,
		memo: 'a-refund',
		prefix: 'akash',
		fee: fee('4000uakt'),
		transfers: [{ sender: escrow, recipient: W, amount: '3000000uakt' }]
	})
);
const undelegate = withTxHash(
	cosmosTx({
		seed: 'a-undelegate',
		height: 1700,
		memo: 'a-undelegate',
		prefix: 'akash',
		fee: fee('6000uakt'),
		transfers: [{ sender: distribution, recipient: W, amount: '100000uakt' }],
		undelegations: [
			{ delegator: W, validator: V, amount: '10000000uakt', completionTime: blockTime(1720) }
		]
	})
);
// Someone else's transaction in the same block as the reward withdrawal.
const neighbour = withTxHash(
	cosmosTx({
		seed: 'a-neighbour',
		height: 1500,
		memo: 'a-neighbour',
		prefix: 'akash',
		fee: { payer: O, amount: '1000uakt' },
		transfers: [{ sender: O, recipient: distribution, amount: '1uakt' }]
	})
);

// The same transactions as the indexer has them: messages, no events.
const indexed = [
	consoleTx({
		seed: 'a-in',
		height: 1100,
		signers: [O],
		fee: 2000,
		messages: [
			{
				type: 'MsgSend',
				data: { from_address: O, to_address: W, amount: [{ denom: 'uakt', amount: '100000000' }] }
			}
		]
	}),
	consoleTx({
		seed: 'a-delegate',
		hash: delegate.hash,
		height: 1200,
		signers: [W],
		fee: 4000,
		messages: [
			{
				type: 'MsgDelegate',
				data: {
					delegator_address: W,
					validator_address: V,
					amount: { denom: 'uakt', amount: '15000000' }
				}
			}
		]
	}),
	consoleTx({
		seed: 'a-reward',
		hash: reward.hash,
		height: 1500,
		signers: [W],
		fee: 5000,
		messages: [
			{
				type: 'MsgWithdrawDelegatorReward',
				data: { delegator_address: W, validator_address: V }
			}
		]
	}),
	consoleTx({
		seed: 'a-refund',
		hash: refund.hash,
		height: 1600,
		signers: [W],
		fee: 4000,
		messages: [{ type: 'MsgCloseDeployment', data: { id: { owner: W, dseq: '1' } } }]
	}),
	consoleTx({
		seed: 'a-undelegate',
		hash: undelegate.hash,
		height: 1700,
		signers: [W],
		fee: 6000,
		messages: [
			{
				type: 'MsgUndelegate',
				data: {
					delegator_address: W,
					validator_address: V,
					amount: { denom: 'uakt', amount: '10000000' }
				}
			}
		]
	}),
	consoleTx({
		seed: 'a-send',
		height: 1800,
		signers: [W],
		fee: 3000,
		messages: [
			{
				type: 'MsgSend',
				data: { from_address: W, to_address: O, amount: [{ denom: 'uakt', amount: '1000000' }] }
			}
		]
	})
];

// The node's window (from block 5000): another undelegation, whose tokens
// come back at block 6030 – next to someone else's.
const recent = cosmosTx({
	seed: 'a-recent-undelegate',
	height: 6000,
	prefix: 'akash',
	fee: fee('5000uakt'),
	transfers: [{ sender: distribution, recipient: W, amount: '50000uakt' }],
	undelegations: [
		{ delegator: W, validator: V, amount: '5000000uakt', completionTime: blockTime(6030) }
	]
});
const recentEnd = {
	6030: [
		completeUnbonding({ delegator: O, validator: V, amount: '7uakt' }),
		completeUnbonding({ delegator: W, validator: V, amount: '5000000uakt' })
	]
};

// Everything above, summed: 100 AKT in, 15 delegated and back, rewards,
// the refund, one send out, the fees.
const BALANCE = '104623000';

/** `-2.5` → -2500000n (6 decimals). @param {string} a */
const units = (a) => {
	const [int, frac = ''] = a.replace(/^-/, '').split('.');
	const v = BigInt(int + frac.padEnd(6, '0'));
	return a.startsWith('-') ? -v : v;
};
const booked = (/** @type {any[]} */ entries) =>
	entries
		.filter((e) => e.asset === 'AKT')
		.reduce((sum, e) => sum + units(e.amount), 0n)
		.toString();

/** @param {{ archive?: boolean, unbondingTime?: string, indexerTxs?: any[], nodeTxs?: any[], nodeEnd?: Record<number, any[]> }} [o] */
async function setUp(o = {}) {
	const node = await startFakeCosmos({
		network: 'akashnet-2',
		earliestHeight: 5000,
		txs: o.nodeTxs ?? [recent],
		endBlockEvents: o.nodeEnd ?? recentEnd,
		balances: { [W]: [{ denom: 'uakt', amount: BALANCE }] },
		unbondingTime: o.unbondingTime
	});
	const indexer = await startFakeAkashConsole({ txs: o.indexerTxs ?? indexed });
	const archive = o.archive
		? await startFakeCosmos({
				network: 'akashnet-2',
				earliestHeight: 1,
				txIndex: false,
				txs: [delegate, reward, neighbour, refund, undelegate, recent],
				endBlockEvents: {
					1720: [completeUnbonding({ delegator: W, validator: V, amount: '10000000uakt' })],
					...recentEnd
				}
			})
		: null;
	const service = createWalletService({ allowLoopback: true, sleep: noSleep });
	const sync = async () =>
		/** @type {any} */ (
			await service.sync({
				chain: 'akash',
				address: W,
				endpoints: {
					...node.endpoints,
					indexer: indexer.url,
					...(archive ? { archive: archive.url } : {})
				}
			})
		);
	return {
		node,
		archive,
		sync,
		close: async () => {
			await node.close();
			await indexer.close();
			await archive?.close();
		}
	};
}

describe('Akash: older amounts from an archive node, and unbonding returns (#1029)', () => {
	test('with an archive node every amount is booked, and the bookings add up to the balance', async () => {
		const s = await setUp({ archive: true });
		try {
			const result = await s.sync();
			const of = (/** @type {string} */ hash) =>
				result.entries
					.filter((/** @type {any} */ e) => e.hash === hash)
					.map((/** @type {any} */ e) => [e.type, e.kind, e.amount, e.counterparty]);
			// Read from the archive's blocks, as tx_search would: the rewards,
			// the refund from the escrow, the rewards withdrawn on the way out.
			assert.deepEqual(of(reward.hash), [
				['fee', 'fee', '-0.005', ''],
				['received', 'reward', '2.5', distribution]
			]);
			assert.deepEqual(of(refund.hash), [
				['fee', 'fee', '-0.004', ''],
				['received', 'transfer', '3', escrow]
			]);
			assert.deepEqual(of(undelegate.hash), [
				['fee', 'fee', '-0.006', ''],
				['received', 'reward', '0.1', distribution]
			]);
			// The delegation the indexer read once is now the node's events' –
			// the same quantity, so the app keeps the id it was booked under.
			assert.deepEqual(of(delegate.hash), [
				['fee', 'fee', '-0.004', ''],
				['sent', 'stake', '-15', moduleAddress('akash', 'bonded_tokens_pool')]
			]);
			assert.ok(
				result.entries
					.find((/** @type {any} */ e) => e.hash === delegate.hash && e.type === 'sent')
					.id.includes(':m')
			);
			// The tokens back from both undelegations, with no hash: each in the
			// block its unbonding ended in.
			const returns = result.entries.filter((/** @type {any} */ e) =>
				e.id.startsWith('unbonding:')
			);
			assert.deepEqual(
				returns.map((/** @type {any} */ e) => [
					e.id,
					e.hash,
					e.type,
					e.kind,
					e.amount,
					e.counterparty,
					e.date
				]),
				[
					[
						`unbonding:1720:${V}:AKT`,
						'',
						'received',
						'stake',
						'10',
						notBonded,
						blockTime(1720).slice(0, 10)
					],
					[
						`unbonding:6030:${V}:AKT`,
						'',
						'received',
						'stake',
						'5',
						notBonded,
						blockTime(6030).slice(0, 10)
					]
				]
			);
			assert.equal(booked(result.entries), BALANCE);
			assert.equal(result.history.unknownAmounts, 0);
			assert.equal(result.history.archiveRead, 4);
			assert.deepEqual(result.history.unbonding, { returned: 2, pending: 0, unread: 0 });
			// The archive node has no transaction index and needs none.
			assert.equal(s.archive?.calls.filter((c) => c.method === 'tx_search').length, 0);
		} finally {
			await s.close();
		}
	});

	test('without one the gap stays, said as before; the return the node still has is booked', async () => {
		const s = await setUp();
		try {
			const result = await s.sync();
			assert.equal(result.history.unknownAmounts, 4);
			assert.equal(result.history.archiveRead, undefined);
			assert.ok(result.entries.some((/** @type {any} */ e) => e.id === `unbonding:6030:${V}:AKT`));
			// The old undelegation's end (21 days later, at block 31940) is in the
			// node's window, but nothing came back for this wallet there: nothing booked.
			assert.deepEqual(result.history.unbonding, { returned: 1, pending: 0, unread: 1 });
			assert.notEqual(booked(result.entries), BALANCE);
		} finally {
			await s.close();
		}
	});

	test('an indexed undelegation whose end the node still has: found by the unbonding period, booked from its event', async () => {
		const late = consoleTx({
			seed: 'a-late-undelegate',
			height: 4990,
			signers: [W],
			fee: 6000,
			messages: [
				{
					type: 'MsgUndelegate',
					data: {
						delegator_address: W,
						validator_address: V,
						amount: { denom: 'uakt', amount: '2000000' }
					}
				}
			]
		});
		const s = await setUp({
			unbondingTime: '1200s',
			indexerTxs: [late],
			nodeTxs: [],
			nodeEnd: { 5010: [completeUnbonding({ delegator: W, validator: V, amount: '2000000uakt' })] }
		});
		try {
			const result = await s.sync();
			assert.deepEqual(
				result.entries
					.filter((/** @type {any} */ e) => e.id.startsWith('unbonding:'))
					.map((/** @type {any} */ e) => [e.id, e.amount]),
				[[`unbonding:5010:${V}:AKT`, '2']]
			);
			assert.deepEqual(result.history.unbonding, { returned: 1, pending: 0, unread: 0 });
		} finally {
			await s.close();
		}
	});

	test('an unbonding that has not ended yet is pending, not a gap', async () => {
		const later = cosmosTx({
			seed: 'a-pending',
			height: 6000,
			prefix: 'akash',
			fee: fee('5000uakt'),
			undelegations: [
				{ delegator: W, validator: V, amount: '1000000uakt', completionTime: blockTime(200000) }
			]
		});
		const s = await setUp({ nodeTxs: [later], indexerTxs: [], nodeEnd: {} });
		try {
			const result = await s.sync();
			assert.deepEqual(result.history.unbonding, { returned: 0, pending: 1, unread: 0 });
		} finally {
			await s.close();
		}
	});
});

describe('the events of an unbonding', () => {
	test('the delegator from the event, else the messages’ only sender; someone else’s is not ours', () => {
		const at = '2026-10-01T00:00:00Z';
		const events = readEvents([
			{ type: 'message', attributes: [{ key: 'sender', value: W }] },
			{
				type: 'unbond',
				attributes: [
					{ key: 'validator', value: V },
					{ key: 'amount', value: '1uakt' },
					{ key: 'completion_time', value: at }
				]
			},
			{
				type: 'unbond',
				attributes: [
					{ key: 'validator', value: V },
					{ key: 'delegator', value: O },
					{ key: 'completion_time', value: at }
				]
			}
		]);
		assert.deepEqual(unbondingsOf(events, W), [
			{ validator: V, completionTime: new Date(at).toISOString() }
		]);
	});

	test('an amount without its denom (older chains) is the chain’s own', () => {
		const events = readEvents([
			completeUnbonding({ delegator: W, validator: V, amount: '42' }),
			completeUnbonding({ delegator: O, validator: V, amount: '7uakt' })
		]);
		assert.deepEqual(completedUnbondingsOf(events, W, 'uakt'), [
			{ validator: V, coins: [{ denom: 'uakt', amount: 42n }] }
		]);
	});
});
