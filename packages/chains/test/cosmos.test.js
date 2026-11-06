// The Cosmos client (Nyx, Akash) against fake nodes on 127.0.0.1: a
// transaction's movements, fees, rewards and IBC, all pages, the balance. All
// addresses, hashes and amounts are made up (support/fake-cosmos.js). Moved
// from the bridge's wallets.test.js with the package (#264).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AKASH_CHAIN,
	NYX_CHAIN,
	bech32Encode,
	isCosmosAddress,
	decodeTx,
	encodeTx,
	createCosmosClient,
	normalizeCosmosTx,
	parseCoins
} from '../src/index.js';
import {
	blockTime,
	cosmosTx,
	fakeCosmosAddress,
	fakeHash,
	NYX,
	startFakeCosmos
} from './support/fake-cosmos.js';

const nyx = NYX_CHAIN;
const noSleep = async () => {};

describe('a Cosmos transaction', () => {
	test('memo and fee from the transaction bytes', () => {
		const bytes = encodeTx({
			memo: 'Hallo',
			messageTypes: ['/x.MsgSend'],
			fee: [{ denom: 'unym', amount: '5000' }]
		});
		assert.deepEqual(decodeTx(bytes), {
			memo: 'Hallo',
			messageTypes: ['/x.MsgSend'],
			fee: [{ denom: 'unym', amount: '5000' }]
		});
		assert.equal(decodeTx('not base64 protobuf ###'), null);
	});

	test('coins', () => {
		assert.deepEqual(parseCoins('5unym,7ibc/AB12'), [
			{ denom: 'unym', amount: 5n },
			{ denom: 'ibc/AB12', amount: 7n }
		]);
		assert.equal(parseCoins('5 unym'), null);
		assert.deepEqual(parseCoins(''), []);
	});

	const at = blockTime(2000);
	const normalize = (/** @type {any} */ raw) =>
		normalizeCosmosTx(raw, { address: NYX.wallet, chain: nyx, time: at });

	test('a send: the amount out, and the fee apart, not twice', () => {
		const raw = cosmosTx({
			seed: 'u1',
			height: 2000,
			memo: 'Test',
			fee: { payer: NYX.wallet, amount: '5000unym' },
			transfers: [{ sender: NYX.wallet, recipient: NYX.friend, amount: '12500000unym' }]
		});
		const { entries } = normalize(raw);
		assert.deepEqual(
			entries.map((e) => [e.type, e.kind, e.asset, e.amount, e.counterparty, e.memo, e.success]),
			[
				['fee', 'fee', 'NYM', '-0.005', '', 'Test', true],
				['sent', 'transfer', 'NYM', '-12.5', NYX.friend, 'Test', true]
			]
		);
		assert.equal(entries[0].id, `${fakeHash('u1')}:fee`);
		// fee transfer, tx event, message event, then the transfer of message 0 at event 3
		assert.equal(entries[1].id, `${fakeHash('u1')}:m0:e3.0:NYM`);
		assert.equal(
			entries[1].explorerUrl,
			`https://nym.explorers.guru/transaction/${fakeHash('u1')}`
		);
	});

	test('received: someone else paid the fee, so no fee entry', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'u2',
				height: 2000,
				fee: { payer: NYX.friend, amount: '5000unym' },
				transfers: [{ sender: NYX.friend, recipient: NYX.wallet, amount: '1unym' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount]),
			[['received', '0.000001']]
		);
	});

	test('a failed transaction moved only the fee', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'u3',
				height: 2000,
				code: 11,
				fee: { payer: NYX.wallet, amount: '3000unym' },
				transfers: [{ sender: NYX.wallet, recipient: NYX.friend, amount: '9unym' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount, e.success]),
			[['fee', '-0.003', false]]
		);
	});

	test('several messages, rewards and a delegation are told apart', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'u4',
				height: 2000,
				fee: { payer: NYX.wallet, amount: '6000unym' },
				transfers: [
					{ sender: NYX.distribution, recipient: NYX.wallet, amount: '2unym' },
					{ sender: NYX.wallet, recipient: NYX.bonded, amount: '3unym' },
					{ sender: NYX.wallet, recipient: NYX.friend, amount: '4unym,5unyx' }
				]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.kind, e.asset, e.amount]),
			[
				['fee', 'fee', 'NYM', '-0.006'],
				['received', 'reward', 'NYM', '0.000002'],
				['sent', 'stake', 'NYM', '-0.000003'],
				['sent', 'transfer', 'NYM', '-0.000004'],
				['sent', 'transfer', 'NYX', '-0.000005']
			]
		);
		assert.equal(entries[1].counterpartyLabel, 'Staking-Belohnungen (distribution)');
		assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
	});

	test('a delegation moves coins without a transfer event, and is booked (issue #135)', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'd1',
				height: 2000,
				coinEvents: true,
				fee: { payer: NYX.wallet, amount: '6000unym' },
				// the rewards the delegation withdraws on the way, then the delegation
				transfers: [{ sender: NYX.distribution, recipient: NYX.wallet, amount: '2unym' }],
				delegations: [{ delegator: NYX.wallet, amount: '3000000unym' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.kind, e.amount, e.counterpartyLabel]),
			[
				['fee', 'fee', '-0.006', ''],
				['received', 'reward', '0.000002', 'Staking-Belohnungen (distribution)'],
				['sent', 'stake', '-3', 'Staking (gebunden)']
			]
		);
		assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
	});

	test('a send is counted once, though the bank keeper reports it three times', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'd2',
				height: 2000,
				coinEvents: true,
				fee: { payer: NYX.wallet, amount: '5000unym' },
				transfers: [{ sender: NYX.wallet, recipient: NYX.friend, amount: '7unym' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount]),
			[
				['fee', '-0.005'],
				['sent', '-0.000007']
			]
		);
	});

	test('a delegation by someone else in the same transaction is not ours', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'd3',
				height: 2000,
				coinEvents: true,
				fee: { payer: NYX.friend, amount: '5000unym' },
				delegations: [{ delegator: NYX.friend, amount: '9unym' }]
			})
		);
		assert.deepEqual(entries, []);
	});

	test('an old chain without coin_spent: the delegate event, its amount without a denom', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'd4',
				height: 2000,
				legacyEvents: true,
				fee: { payer: NYX.wallet, amount: '5000unym' },
				delegations: [{ delegator: NYX.wallet, amount: '1500000unym' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.kind, e.amount]),
			[
				['fee', 'fee', '-0.005'],
				['sent', 'stake', '-1.5']
			]
		);
	});

	test('an IBC transfer out names the receiver on the other chain', () => {
		const escrow = bech32Encode('n', new Uint8Array(20).fill(7));
		const { entries } = normalize(
			cosmosTx({
				seed: 'u5',
				height: 2000,
				fee: { payer: NYX.wallet, amount: '1unym' },
				transfers: [{ sender: NYX.wallet, recipient: escrow, amount: '8unym' }],
				ibcReceiver: 'osmo1exampleexampleexampleexampleexample0'
			})
		);
		assert.deepEqual(
			entries
				.filter((e) => e.type === 'sent')
				.map((e) => [e.kind, e.counterparty, e.counterpartyLabel]),
			[['ibc', 'osmo1exampleexampleexampleexampleexample0', 'IBC-Transfer']]
		);
	});

	test('an IBC transfer keeps its own memo – a swap plan lives there, not in the transaction memo (#170)', () => {
		const escrow = bech32Encode('n', new Uint8Array(20).fill(7));
		const plan = '{"wasm":{"contract":"osmo1exampleexampleexampleexampleexample0","msg":{}}}';
		const { entries } = normalize(
			cosmosTx({
				seed: 'u7',
				height: 2000,
				fee: { payer: NYX.wallet, amount: '1unym' },
				transfers: [{ sender: NYX.wallet, recipient: escrow, amount: '8unym' }],
				ibcReceiver: 'osmo1exampleexampleexampleexampleexample0',
				ibcMemo: plan
			})
		);
		const sent = entries.find((e) => e.type === 'sent');
		assert.equal(sent?.ibcMemo, plan);
		assert.equal(sent?.memo, '');
	});

	test('the old event format: base64, triples in one event, fee from the bytes', () => {
		const { entries } = normalize(
			cosmosTx({
				seed: 'u6',
				height: 2000,
				legacyEvents: true,
				fee: { payer: NYX.wallet, amount: '2500unym' },
				transfers: [
					{ sender: NYX.friend, recipient: NYX.wallet, amount: '3unym' },
					{ sender: NYX.wallet, recipient: NYX.exchange, amount: '1unym' }
				]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount]),
			[
				['fee', '-0.0025'],
				['received', '0.000003'],
				['sent', '-0.000001']
			]
		);
	});

	test('the fee transfer is known by where it stands, not by how its amount is spelt', () => {
		const raw = cosmosTx({
			seed: 'u8',
			height: 2000,
			fee: { payer: NYX.wallet, amount: '5000unym' },
			transfers: [{ sender: NYX.wallet, recipient: NYX.friend, amount: '1unym' }]
		});
		// The ante handler's transfer spells the fee otherwise than the tx event.
		raw.tx_result.events[0].attributes[2].value = '5000unym,0unyx';
		const { entries } = normalize(raw);
		assert.deepEqual(
			entries.map((e) => [e.type, e.amount, e.counterparty]),
			[
				['fee', '-0.005', ''],
				['sent', '-0.000001', NYX.friend]
			]
		);
	});

	test('ids stay when a denom is listed later', () => {
		const raw = cosmosTx({
			seed: 'u9',
			height: 2000,
			fee: { payer: NYX.wallet, amount: '5000unym' },
			transfers: [
				{ sender: NYX.friend, recipient: NYX.wallet, amount: '7ibc/AB12' },
				{ sender: NYX.friend, recipient: NYX.wallet, amount: '2unym' }
			]
		});
		const before = normalize(raw).entries.map((e) => e.id);
		const listed = {
			...nyx,
			denoms: { ...nyx.denoms, 'ibc/AB12': { symbol: 'TESTIBC', decimals: 6 } }
		};
		const after = normalizeCosmosTx(raw, {
			address: NYX.wallet,
			chain: listed,
			time: at
		}).entries.map((e) => e.id);
		assert.equal(after.length, before.length + 1);
		for (const id of before) assert.ok(after.includes(id), id);
	});

	test('unknown denoms are counted and left out', () => {
		const { entries, unknownDenoms } = normalize(
			cosmosTx({
				seed: 'u7',
				height: 2000,
				transfers: [{ sender: NYX.friend, recipient: NYX.wallet, amount: '7ibc/AB12,2unyx' }]
			})
		);
		assert.deepEqual(
			entries.map((e) => [e.asset, e.amount]),
			[['NYX', '0.000002']]
		);
		assert.deepEqual(unknownDenoms, ['ibc/AB12']);
	});
});

describe('the Cosmos client against a fake Nyx node', () => {
	/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
	before(async () => {
		node = await startFakeCosmos();
	});
	after(() => node?.close());

	test('reads every page of both queries, merges by hash, times each block', async () => {
		const client = createCosmosClient({ sleep: noSleep });
		const result = await client.history({
			chain: nyx,
			address: NYX.wallet,
			endpoints: node.endpoints
		});
		const searches = node.calls.filter((c) => c.method === 'tx_search');
		assert.deepEqual([...new Set(searches.map((c) => c.params.query.split('=')[0]))].sort(), [
			'transfer.recipient',
			'transfer.sender'
		]);
		assert.ok(
			searches.some((c) => c.params.page === '2'),
			'a second page'
		);
		assert.ok(searches.every((c) => c.params.order_by === 'asc' && c.params.per_page === '100'));
		// 9 sample transactions + 110 small incoming ones
		assert.equal(result.transactions, 119);
		const byType = (/** @type {string} */ t) => result.entries.filter((e) => e.type === t).length;
		assert.equal(byType('received'), 1 + 1 + 1 + 1 + 110); // withdrawal, reward, unyx, legacy, filler
		assert.equal(byType('sent'), 1 + 1 + 2); // send, delegation, multi
		assert.equal(byType('fee'), 7); // every one the wallet paid, the failed one too
		assert.equal(result.unknownAssets, 1);
		const first = result.entries[0];
		assert.equal(first.time, blockTime(1000));
		assert.equal(first.date, '2026-09-01');
		assert.equal(first.memo, 'Test-Memo Auszahlung');
		assert.deepEqual(result.balances, [
			{ asset: 'NYM', amount: '137', decimals: 6 },
			{ asset: 'NYX', amount: '2', decimals: 6 }
		]);
		assert.equal(result.history.pruned, false);
		assert.equal(result.addressUrl, `https://nym.explorers.guru/account/${NYX.wallet}`);
		// Oldest first.
		const heights = result.entries.map((e) => e.height);
		assert.deepEqual(
			heights,
			[...heights].sort((a, b) => a - b)
		);
	});

	test('a pruned node says from where it knows the chain', async () => {
		const pruned = await startFakeCosmos({ earliestHeight: 2050 });
		try {
			const result = await createCosmosClient({ sleep: noSleep }).history({
				chain: nyx,
				address: NYX.wallet,
				endpoints: pruned.endpoints
			});
			assert.equal(result.history.pruned, true);
			assert.equal(result.history.earliestHeight, 2050);
			assert.ok(result.entries.every((e) => e.height >= 2050));
		} finally {
			await pruned.close();
		}
	});

	test('a pruned node whose status says 0 is found out by asking for block 1', async () => {
		const pruned = await startFakeCosmos({ earliestHeight: 2050, statusSaysZero: true });
		try {
			const result = await createCosmosClient({ sleep: noSleep }).history({
				chain: nyx,
				address: NYX.wallet,
				endpoints: pruned.endpoints
			});
			assert.equal(result.history.pruned, true);
			assert.equal(result.history.earliestHeight, 2050);
			// The date of its first block, for "ältere fehlen".
			assert.match(String(result.history.earliestTime), /^\d{4}-\d{2}-\d{2}T/);
		} finally {
			await pruned.close();
		}
	});

	test('retries a busy node, then gives up with a code and without the address', async () => {
		const flaky = await startFakeCosmos({ failFirst: 2 });
		try {
			const ok = await createCosmosClient({ sleep: noSleep }).history({
				chain: nyx,
				address: NYX.wallet,
				endpoints: flaky.endpoints
			});
			assert.ok(ok.entries.length > 0);
		} finally {
			await flaky.close();
		}
		const down = await startFakeCosmos({ failFirst: 1000 });
		try {
			await assert.rejects(
				createCosmosClient({ sleep: noSleep }).history({
					chain: nyx,
					address: NYX.wallet,
					endpoints: down.endpoints
				}),
				(/** @type {any} */ e) => {
					assert.equal(e.code, 'WALLET_NODE');
					assert.doesNotMatch(e.message, new RegExp(NYX.wallet));
					return true;
				}
			);
		} finally {
			await down.close();
		}
	});

	test('a node of another chain is refused', async () => {
		const other = await startFakeCosmos({ network: 'cosmoshub-4' });
		try {
			await assert.rejects(
				createCosmosClient({ sleep: noSleep }).history({
					chain: nyx,
					address: NYX.wallet,
					endpoints: other.endpoints
				}),
				{ code: 'WALLET_WRONG_CHAIN' }
			);
		} finally {
			await other.close();
		}
	});

	test('an unreachable node and a timeout have codes of their own', async () => {
		const client = createCosmosClient({ sleep: noSleep, timeoutMs: 200 });
		await assert.rejects(
			client.history({
				chain: nyx,
				address: NYX.wallet,
				endpoints: { rpc: 'http://127.0.0.1:9', rest: 'http://127.0.0.1:9' }
			}),
			{ code: 'WALLET_UNREACHABLE' }
		);
		const hanging = createCosmosClient({
			sleep: noSleep,
			timeoutMs: 50,
			fetch: (_url, init) =>
				new Promise((_resolve, reject) =>
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
				)
		});
		await assert.rejects(
			hanging.history({ chain: nyx, address: NYX.wallet, endpoints: node.endpoints }),
			{ code: 'WALLET_TIMEOUT' }
		);
	});

	test('a wrong address never reaches the node', async () => {
		const before = node.calls.length;
		await assert.rejects(
			createCosmosClient().history({
				chain: nyx,
				address: 'cosmos1abc',
				endpoints: node.endpoints
			}),
			{ code: 'WALLET_ADDRESS', status: 400 }
		);
		assert.equal(node.calls.length, before);
	});
});

describe('Akash', () => {
	test('AKT with its prefix, its fee collector and Mintscan links', async () => {
		const akash = AKASH_CHAIN;
		const wallet = fakeCosmosAddress('akash wallet', 'akash');
		const other = fakeCosmosAddress('akash someone', 'akash');
		const node = await startFakeCosmos({
			network: 'akashnet-2',
			txs: [
				cosmosTx({
					seed: 'akash-send',
					height: 1500,
					prefix: 'akash',
					fee: { payer: wallet, amount: '2500uakt' },
					transfers: [{ sender: wallet, recipient: other, amount: '4000000uakt' }]
				})
			],
			balances: { [wallet]: [{ denom: 'uakt', amount: '6000000' }] }
		});
		try {
			assert.equal(isCosmosAddress(wallet, 'akash'), true);
			assert.equal(isCosmosAddress(NYX.wallet, 'akash'), false);
			const result = await createCosmosClient({ sleep: noSleep }).history({
				chain: akash,
				address: wallet,
				endpoints: node.endpoints
			});
			assert.deepEqual(
				result.entries.map((e) => [e.id.split(':').slice(1).join(':'), e.type, e.asset, e.amount]),
				[
					['fee', 'fee', 'AKT', '-0.0025'],
					['m0:e3.0:AKT', 'sent', 'AKT', '-4']
				]
			);
			assert.equal(
				result.entries[1].explorerUrl,
				`https://www.mintscan.io/akash/transactions/${fakeHash('akash-send')}`
			);
			assert.equal(result.addressUrl, `https://www.mintscan.io/akash/accounts/${wallet}`);
			assert.deepEqual(result.balances, [{ asset: 'AKT', amount: '6', decimals: 6 }]);
		} finally {
			await node.close();
		}
	});
});
