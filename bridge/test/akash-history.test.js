// Akash's older history from the Akash Console indexer (issue #105, part 4).
// Fake node and fake indexer on 127.0.0.1; every address, hash and amount is
// made up.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createAkashConsoleClient, normalizeConsoleTx } from '../src/chains/akash-console.js';
import { normalizeCosmosTx } from '../src/chains/cosmos.js';
import { moduleAddress } from '../src/chains/bech32.js';
import { CHAINS } from '../src/chains/registry.js';
import { createWalletService } from '../src/chains/index.js';
import {
	consoleTx,
	cosmosTx,
	fakeCosmosAddress,
	fakeHash,
	startFakeAkashConsole,
	startFakeCosmos
} from './support/fake-chains.js';

const akash = /** @type {import('../src/chains/registry.js').CosmosChain} */ (CHAINS.akash);
const wallet = fakeCosmosAddress('akash history wallet', 'akash');
const other = fakeCosmosAddress('akash history other', 'akash');
const noSleep = async () => {};
const normalize = (/** @type {any} */ tx) =>
	normalizeConsoleTx(tx, { address: wallet, chain: akash });
const rows = (/** @type {any[]} */ entries) =>
	entries.map((e) => [e.id.split(':').slice(1).join(':'), e.type, e.kind, e.amount]);
const packet = (/** @type {Record<string, string>} */ data) =>
	Buffer.from(JSON.stringify(data)).toString('base64');

describe('an Akash transaction from the indexer', () => {
	test('a send out: the fee of the first signer, the amount, the other side', () => {
		const { entries, unknownAmount } = normalize(
			consoleTx({
				seed: 'c-send',
				height: 500,
				signers: [wallet],
				fee: 5000,
				messages: [
					{
						type: 'MsgSend',
						data: {
							from_address: wallet,
							to_address: other,
							amount: [{ denom: 'uakt', amount: '2500000' }]
						}
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [
			['fee', 'fee', 'fee', '-0.005'],
			['c0.0:AKT', 'sent', 'transfer', '-2.5']
		]);
		assert.equal(entries[1].counterparty, other);
		assert.equal(entries[1].hash, fakeHash('c-send'));
		assert.equal(unknownAmount, false);
	});

	test('received from someone who paid the fee: no fee entry', () => {
		const { entries } = normalize(
			consoleTx({
				seed: 'c-in',
				height: 500,
				signers: [other],
				fee: 5000,
				messages: [
					{
						type: 'MsgSend',
						data: {
							from_address: other,
							to_address: wallet,
							amount: [{ denom: 'uakt', amount: '1' }]
						}
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [['c0.0:AKT', 'received', 'transfer', '0.000001']]);
	});

	test('a failed transaction: only the fee, marked failed', () => {
		const { entries } = normalize(
			consoleTx({
				seed: 'c-failed',
				height: 500,
				signers: [wallet],
				fee: 3000,
				success: false,
				messages: [
					{
						type: 'MsgSend',
						data: {
							from_address: wallet,
							to_address: other,
							amount: [{ denom: 'uakt', amount: '9' }]
						}
					}
				]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount, e.success]),
			[['fee', '-0.003', false]]
		);
	});

	test('a delegation is booked; the rewards it withdrew are unknown', () => {
		const { entries, unknownAmount } = normalize(
			consoleTx({
				seed: 'c-delegate',
				height: 500,
				signers: [wallet],
				fee: 4000,
				messages: [
					{
						type: 'MsgDelegate',
						data: {
							delegator_address: wallet,
							validator_address: 'akashvaloper1example',
							amount: { denom: 'uakt', amount: '3000000' }
						}
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [
			['fee', 'fee', 'fee', '-0.004'],
			['c0.0:AKT', 'sent', 'stake', '-3']
		]);
		assert.equal(entries[1].counterparty, moduleAddress('akash', 'bonded_tokens_pool'));
		assert.equal(unknownAmount, true);
	});

	test('a reward withdrawal: the fee, and its amount unknown', () => {
		const { entries, unknownAmount } = normalize(
			consoleTx({
				seed: 'c-reward',
				height: 500,
				signers: [wallet],
				fee: 4000,
				messages: [
					{
						type: 'MsgWithdrawDelegatorReward',
						data: { delegator_address: wallet, validator_address: 'akashvaloper1example' }
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [['fee', 'fee', 'fee', '-0.004']]);
		assert.equal(unknownAmount, true);
	});

	test('IBC: out with its receiver; in only for AKT coming home, a voucher is not booked', () => {
		const out = normalize(
			consoleTx({
				seed: 'c-ibc-out',
				height: 500,
				signers: [wallet],
				messages: [
					{
						type: 'MsgTransfer',
						data: {
							sourcePort: 'transfer',
							sourceChannel: 'channel-9',
							token: { denom: 'uakt', amount: '7000000' },
							sender: wallet,
							receiver: 'osmo1exampleexampleexampleexampleexample0'
						}
					}
				]
			})
		);
		assert.deepEqual(rows(out.entries), [['c0.0:AKT', 'sent', 'ibc', '-7']]);
		assert.equal(out.entries[0].counterparty, 'osmo1exampleexampleexampleexampleexample0');

		const home = (/** @type {string} */ seed, /** @type {string} */ denom) =>
			normalize(
				consoleTx({
					seed,
					height: 500,
					signers: [other],
					messages: [
						{
							type: 'MsgRecvPacket',
							data: {
								packet: {
									sourcePort: 'transfer',
									sourceChannel: 'channel-1',
									data: packet({
										denom,
										amount: '2000000',
										sender: 'osmo1exampleexampleexampleexampleexample0',
										receiver: wallet
									})
								},
								signer: other
							}
						}
					]
				})
			);
		assert.deepEqual(rows(home('c-ibc-home', 'transfer/channel-1/uakt').entries), [
			['c0.0:AKT', 'received', 'transfer', '2']
		]);
		const voucher = home('c-ibc-voucher', 'uosmo');
		assert.deepEqual(voucher.entries, []);
		assert.equal(voucher.unknownDenoms.length, 1);
	});

	test('escrow: a deployment deposit is ours, a deposit from a grant is not', () => {
		const { entries } = normalize(
			consoleTx({
				seed: 'c-deploy',
				height: 500,
				signers: [wallet],
				messages: [
					{
						type: 'MsgCreateDeployment',
						data: {
							id: { owner: wallet, dseq: '1' },
							deposit: { denom: 'uakt', amount: '5000000' }
						}
					},
					{
						type: 'MsgAccountDeposit',
						data: {
							signer: wallet,
							id: { scope: 'deployment', xid: 'x' },
							deposit: { amount: { denom: 'uakt', amount: '1000000' }, sources: ['grant'] }
						}
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [['c0.0:AKT', 'sent', 'transfer', '-5']]);
		assert.equal(entries[0].counterpartyLabel, 'Akash-Escrow (Deployment)');
	});

	test('a multi-send names the other side only when there is one', () => {
		const { entries } = normalize(
			consoleTx({
				seed: 'c-multi',
				height: 500,
				signers: [other],
				messages: [
					{
						type: 'MsgMultiSend',
						data: {
							inputs: [{ address: other, coins: [{ denom: 'uakt', amount: '3' }] }],
							outputs: [
								{ address: wallet, coins: [{ denom: 'uakt', amount: '1' }] },
								{
									address: fakeCosmosAddress('third', 'akash'),
									coins: [{ denom: 'uakt', amount: '2' }]
								}
							]
						}
					}
				]
			})
		);
		assert.deepEqual(rows(entries), [['c0.0:AKT', 'received', 'transfer', '0.000001']]);
		assert.equal(entries[0].counterparty, other);
	});
});

describe('a wallet on a pruned Akash node', () => {
	const send = (/** @type {string} */ seed, /** @type {number} */ height, amount = '1000000') =>
		consoleTx({
			seed,
			height,
			signers: [wallet],
			fee: 2000,
			messages: [
				{
					type: 'MsgSend',
					data: { from_address: wallet, to_address: other, amount: [{ denom: 'uakt', amount }] }
				}
			]
		});

	test('the older history comes from the indexer, the rest from the node, nothing twice', async () => {
		const node = await startFakeCosmos({
			network: 'akashnet-2',
			earliestHeight: 1000,
			txs: [
				cosmosTx({
					seed: 'recent',
					height: 1500,
					prefix: 'akash',
					fee: { payer: wallet, amount: '2000uakt' },
					transfers: [{ sender: wallet, recipient: other, amount: '1000000uakt' }]
				})
			],
			balances: { [wallet]: [{ denom: 'uakt', amount: '1000000' }] }
		});
		const indexer = await startFakeAkashConsole({
			txs: [
				// the node knows this one: the node's reading counts
				send('recent', 1500),
				send('old', 500, '4000000'),
				consoleTx({
					seed: 'old-reward',
					height: 700,
					signers: [wallet],
					fee: 2000,
					messages: [
						{
							type: 'MsgWithdrawDelegatorReward',
							data: { delegator_address: wallet, validator_address: 'akashvaloper1example' }
						}
					]
				})
			]
		});
		try {
			const service = createWalletService({ allowLoopback: true, sleep: noSleep });
			const result = /** @type {any} */ (
				await service.sync({
					chain: 'akash',
					address: wallet,
					endpoints: { ...node.endpoints, indexer: indexer.url }
				})
			);
			assert.deepEqual(
				result.entries.map((/** @type {any} */ e) => [
					e.height,
					e.id.split(':').slice(1).join(':')
				]),
				[
					[500, 'fee'],
					[500, 'c0.0:AKT'],
					[700, 'fee'],
					[1500, 'fee'],
					[1500, 'm0:e3.0:AKT']
				]
			);
			assert.equal(result.transactions, 3);
			assert.equal(result.history.pruned, true);
			assert.equal(result.history.completedBy, 'indexer');
			assert.equal(result.history.unknownAmounts, 1);
			assert.equal(result.history.indexerFrom, result.entries[0].time);
			// The node's transaction is not fetched again from the indexer.
			assert.equal(indexer.calls.filter((c) => c.startsWith('/v1/transactions/')).length, 2);
		} finally {
			await node.close();
			await indexer.close();
		}
	});

	test('the listing is read page by page, by hasMore as the indexer answers now, or by count as before', async () => {
		// 150 newer than the node's window start, one older: two pages of 100.
		const txs = [
			send('old one', 500, '3000000'),
			...Array.from({ length: 150 }, (_, i) => send(`newer ${i}`, 1100 + i))
		];
		for (const withCount of [false, true]) {
			const indexer = await startFakeAkashConsole({ txs, withCount });
			try {
				const client = createAkashConsoleClient({ sleep: noSleep });
				const older = await client.history({
					chain: akash,
					address: wallet,
					indexer: indexer.url,
					beforeHeight: 1000
				});
				assert.equal(older.transactions, 1, withCount ? 'count' : 'hasMore');
				assert.deepEqual(
					indexer.calls.filter(
						(c) => c.includes('/transactions/') && c.startsWith('/v1/addresses/')
					),
					[
						'/v1/addresses/<address>/transactions/0/100',
						'/v1/addresses/<address>/transactions/100/100'
					]
				);
			} finally {
				await indexer.close();
			}
		}
	});

	test('an indexer that fails: the node’s part, and the history stays marked short', async () => {
		const node = await startFakeCosmos({
			network: 'akashnet-2',
			earliestHeight: 1000,
			txs: [],
			balances: { [wallet]: [] }
		});
		const indexer = await startFakeAkashConsole({ broken: true });
		try {
			const service = createWalletService({ allowLoopback: true, sleep: noSleep });
			const result = /** @type {any} */ (
				await service.sync({
					chain: 'akash',
					address: wallet,
					endpoints: { ...node.endpoints, indexer: indexer.url }
				})
			);
			assert.equal(result.history.pruned, true);
			assert.equal(result.history.completedBy, undefined);
			assert.match(result.history.indexerError, /^WALLET_/);
		} finally {
			await node.close();
			await indexer.close();
		}
	});

	test('a node with the whole chain: the indexer is not asked', async () => {
		const node = await startFakeCosmos({
			network: 'akashnet-2',
			txs: [],
			balances: { [wallet]: [] }
		});
		const indexer = await startFakeAkashConsole({ txs: [send('old', 500)] });
		try {
			const service = createWalletService({ allowLoopback: true, sleep: noSleep });
			const result = /** @type {any} */ (
				await service.sync({
					chain: 'akash',
					address: wallet,
					endpoints: { ...node.endpoints, indexer: indexer.url }
				})
			);
			assert.equal(result.history.pruned, false);
			assert.deepEqual(indexer.calls, []);
		} finally {
			await node.close();
			await indexer.close();
		}
	});
});

// Akash burn-mint (BME) and an exchange's withdrawal found by its hash (#303).
// Every address, hash and amount is made up.
describe('AKT for ACT, and a funding the listing leaves out', () => {
	const bme = moduleAddress('akash', 'bme');
	const kraken = fakeCosmosAddress('akash exchange hot wallet', 'akash');

	test('the indexer: a mint is a swap of the AKT burnt, the ACT without an amount; a failed one only costs its fee', () => {
		const mint = (/** @type {boolean} */ success) =>
			consoleTx({
				seed: `mint ${success}`,
				height: 900,
				signers: [wallet],
				fee: 5000,
				success,
				messages: [
					{
						type: 'MsgMintACT',
						data: {
							owner: wallet,
							to: wallet,
							coins_to_burn: { denom: 'uakt', amount: '27500000' }
						}
					}
				]
			});
		const ok = normalize(mint(true));
		assert.deepEqual(rows(ok.entries), [
			['fee', 'fee', 'fee', '-0.005'],
			['c0.0:AKT', 'sent', 'swap', '-27.5']
		]);
		const swap = /** @type {any} */ (ok.entries[1]).swap;
		assert.deepEqual(swap.gave, [{ asset: 'AKT', amount: '27.5', listed: true }]);
		assert.deepEqual(swap.got, [{ asset: 'ACT', amount: '', listed: false }]);
		assert.equal(swap.via, 'Akash BME (AKT ↔ ACT)');
		assert.equal(/** @type {any} */ (ok.entries[0]).swap, swap);
		assert.equal(ok.entries[1].counterparty, bme);
		assert.deepEqual(rows(normalize(mint(false)).entries), [['fee', 'fee', 'fee', '-0.005']]);
	});

	test('the node: AKT to the BME module and ACT back in one transaction is a swap, ACT named', () => {
		const at = { address: wallet, chain: akash, time: '2026-09-01T10:00:00.000Z' };
		const tx = cosmosTx({
			seed: 'node mint',
			height: 1200,
			prefix: 'akash',
			fee: { payer: wallet, amount: '5000uakt' },
			transfers: [
				{ sender: wallet, recipient: bme, amount: '9000000uakt' },
				{ sender: bme, recipient: wallet, amount: '4500000uact' }
			]
		});
		const { entries } = normalizeCosmosTx(tx, at);
		const leg = /** @type {any} */ (entries.find((e) => e.asset === 'AKT' && e.type === 'sent'));
		assert.equal(leg.kind, 'swap');
		assert.deepEqual(leg.swap.got, [{ asset: 'ACT', amount: '4.5', listed: false }]);
		assert.equal(leg.swap.via, 'Akash BME (AKT ↔ ACT)');
		assert.equal(leg.counterpartyLabel, 'Akash BME (AKT ↔ ACT)');
		// An ordinary send stays a transfer.
		const send = cosmosTx({
			seed: 'node send',
			height: 1201,
			prefix: 'akash',
			fee: { payer: wallet, amount: '5000uakt' },
			transfers: [{ sender: wallet, recipient: other, amount: '1000000uakt' }]
		});
		assert.ok(normalizeCosmosTx(send, at).entries.every((e) => e.kind !== 'swap'));
	});

	test('a Kraken withdrawal’s hash: asked of the indexer when the listing leaves it out, for this wallet only', async () => {
		const multi = (
			/** @type {string} */ seed,
			/** @type {string} */ to,
			/** @type {string} */ amount
		) =>
			consoleTx({
				seed,
				height: 400,
				signers: [kraken],
				fee: 3000,
				messages: [
					{
						type: 'MsgMultiSend',
						data: {
							inputs: [{ address: kraken, coins: [{ denom: 'uakt', amount }] }],
							outputs: [{ address: to, coins: [{ denom: 'uakt', amount }] }]
						}
					}
				]
			});
		const funding = multi('kraken funding', wallet, '46553389');
		const elsewhere = multi('kraken to someone else', other, '1000000');
		const node = await startFakeCosmos({
			network: 'akashnet-2',
			earliestHeight: 1000,
			txs: [],
			balances: { [wallet]: [{ denom: 'uakt', amount: '46553389' }] }
		});
		const indexer = await startFakeAkashConsole({
			txs: [funding, elsewhere],
			unlisted: [funding.hash]
		});
		try {
			const service = createWalletService({ allowLoopback: true, sleep: noSleep });
			const result = /** @type {any} */ (
				await service.sync({
					chain: 'akash',
					address: wallet,
					endpoints: { ...node.endpoints, indexer: indexer.url },
					hashes: [funding.hash.toLowerCase(), elsewhere.hash, 'not a hash']
				})
			);
			assert.deepEqual(
				result.entries.map((/** @type {any} */ e) => [e.hash, e.type, e.amount]),
				[[funding.hash, 'received', '46.553389']]
			);
			assert.equal(result.history.byHash, 1);
			assert.equal(
				indexer.calls.filter((c) => c.startsWith('/v1/transactions/')).length,
				2,
				'the funding and the other one, nothing else'
			);
		} finally {
			await node.close();
			await indexer.close();
		}
	});
});
