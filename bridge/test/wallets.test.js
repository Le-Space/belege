// Own wallets: address checks, the Cosmos (Nyx) and EVM (Blockscout)
// clients against fake nodes on 127.0.0.1, and the /chains and /<chain>/wallet routes. All
// addresses, hashes and amounts are made up (support/fake-chains.js).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	bech32Decode,
	bech32Encode,
	isCosmosAddress,
	moduleAddress
} from '../src/chains/bech32.js';
import { decodeTx, encodeTx } from '../src/chains/protobuf.js';
import { CHAINS, publicChains } from '../src/chains/registry.js';
import { createCosmosClient, normalizeCosmosTx, parseCoins } from '../src/chains/cosmos.js';
import { createEvmClient, isEvmAddress, toChecksumAddress } from '../src/chains/evm.js';
import { checkEndpoint } from '../src/chains/http.js';
import { createWalletService } from '../src/chains/index.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import {
	blockTime,
	cosmosTx,
	EVM,
	fakeCosmosAddress,
	fakeHash,
	NYX,
	sampleEvmHistory,
	startFakeBlockscout,
	startFakeCosmos
} from './support/fake-chains.js';
import { request } from './support/http.js';

const nyx = /** @type {import('../src/chains/registry.js').CosmosChain} */ (CHAINS.nyx);
const ethereum = /** @type {import('../src/chains/registry.js').EvmChain} */ (CHAINS.ethereum);
const noSleep = async () => {};

describe('addresses', () => {
	test('bech32: the BIP-173 test vectors', () => {
		for (const valid of [
			'A12UEL5L',
			'a12uel5l',
			'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
			'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
			'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w'
		]) {
			assert.ok(bech32Decode(valid), valid);
		}
		for (const invalid of [
			'pzry9x0s0muk',
			'1pzry9x0s0muk',
			'x1b4n0q5v',
			'li1dgmt3',
			'A1G7SGD8',
			'a12UEL5L'
		]) {
			assert.equal(bech32Decode(invalid), null, invalid);
		}
	});

	test('a Nyx address: prefix n, 20 or 32 bytes, lower case, checksum', () => {
		assert.ok(isCosmosAddress(NYX.wallet, 'n'));
		assert.equal(isCosmosAddress(NYX.wallet, 'cosmos'), false);
		assert.equal(isCosmosAddress(NYX.wallet.toUpperCase(), 'n'), false);
		const typo = NYX.wallet.slice(0, -1) + (NYX.wallet.endsWith('q') ? 'p' : 'q');
		assert.equal(isCosmosAddress(typo, 'n'), false);
		assert.equal(isCosmosAddress(bech32Encode('n', new Uint8Array(19)), 'n'), false);
		assert.ok(isCosmosAddress(bech32Encode('n', new Uint8Array(32)), 'n'));
		assert.equal(isCosmosAddress('', 'n'), false);
	});

	test('module addresses are derived, not typed in', () => {
		// cosmos-sdk's well-known fee collector on the Cosmos Hub.
		assert.equal(
			moduleAddress('cosmos', 'fee_collector'),
			'cosmos17xpfvakm2amg962yls6f84z3kell8c5lserqta'
		);
	});

	test('EVM: 0x + 40 hex, EIP-55 checksum when mixed case', () => {
		// The examples of EIP-55 itself.
		for (const a of [
			'0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
			'0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
			'0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB'
		]) {
			assert.equal(toChecksumAddress(a.toLowerCase()), a);
			assert.ok(isEvmAddress(a));
		}
		assert.ok(isEvmAddress(EVM.wallet));
		assert.ok(isEvmAddress(EVM.wallet.toUpperCase().replace('0X', '0x')));
		assert.equal(isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), false);
		assert.equal(isEvmAddress('0x123'), false);
		assert.equal(isEvmAddress(NYX.wallet), false);
	});

	test('endpoints: https, or http on 127.0.0.1 in tests; no user, query or fragment', () => {
		assert.equal(checkEndpoint('https://rpc.example.org/'), 'https://rpc.example.org');
		assert.equal(checkEndpoint('https://api.example.org/api'), 'https://api.example.org/api');
		assert.equal(checkEndpoint('http://rpc.example.org'), null);
		assert.equal(checkEndpoint('http://127.0.0.1:9'), null);
		assert.equal(
			checkEndpoint('http://127.0.0.1:9', { allowLoopback: true }),
			'http://127.0.0.1:9'
		);
		assert.equal(checkEndpoint('https://u:p@rpc.example.org'), null);
		assert.equal(checkEndpoint('https://rpc.example.org/?key=1'), null);
		assert.equal(checkEndpoint('file:///etc/passwd'), null);
	});
});

describe('the chain table', () => {
	test('Nyx: chain id nyx, prefix n, NYM and NYX with 6 decimals, https endpoints', () => {
		assert.equal(nyx.chainId, 'nyx');
		assert.equal(nyx.bech32Prefix, 'n');
		assert.deepEqual(nyx.denoms.unym, { symbol: 'NYM', decimals: 6 });
		assert.deepEqual(nyx.denoms.unyx, { symbol: 'NYX', decimals: 6 });
		for (const c of Object.values(CHAINS)) {
			for (const url of Object.values(c.endpoints)) assert.match(url, /^https:\/\//);
			assert.match(c.explorer.tx, /^https:\/\/.*\{tx\}/);
			assert.match(c.explorer.address, /^https:\/\/.*\{address\}/);
		}
	});

	test('EVM tokens are keyed by lower-case contract and all USDC have 6 decimals', () => {
		for (const c of Object.values(CHAINS)) {
			if (c.kind !== 'evm') continue;
			for (const [contract, token] of Object.entries(c.tokens)) {
				assert.match(contract, /^0x[0-9a-f]{40}$/);
				if (token.symbol === 'USDC') assert.equal(token.decimals, 6);
			}
		}
		assert.equal(publicChains().length, Object.keys(CHAINS).length);
	});
});

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
		assert.equal(entries[1].id, `${fakeHash('u1')}:0`);
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
		const akash = /** @type {import('../src/chains/registry.js').CosmosChain} */ (CHAINS.akash);
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
					['0', 'sent', 'AKT', '-4']
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

describe('the EVM client against a fake Blockscout', () => {
	test('ETH, listed ERC-20, internal ETH and gas; spam tokens and failed sends left out', async () => {
		const scout = await startFakeBlockscout();
		try {
			const result = await createEvmClient({ sleep: noSleep }).history({
				chain: ethereum,
				address: toChecksumAddress(EVM.wallet),
				endpoints: scout.endpoints
			});
			assert.deepEqual(
				result.entries.map((e) => [e.type, e.asset, e.amount, e.success]),
				[
					['received', 'ETH', '0.5', true],
					['received', 'USDC', '750', true],
					['fee', 'ETH', '-0.0001', true],
					['sent', 'USDC', '-300', true],
					['fee', 'ETH', '-0.000063', false],
					['fee', 'ETH', '-0.000021', true],
					['sent', 'ETH', '-0.1', true],
					['received', 'ETH', '0.02', true]
				]
			);
			assert.equal(result.unknownAssets, 1);
			const usdcOut = result.entries.find((e) => e.asset === 'USDC' && e.type === 'sent');
			assert.equal(usdcOut?.counterparty, EVM.exchange);
			assert.equal(usdcOut?.explorerUrl, `https://etherscan.io/tx/${fakeHash('usdc-out', true)}`);
			assert.equal(new Set(result.entries.map((e) => e.id)).size, result.entries.length);
			assert.deepEqual(result.balances, [
				{ asset: 'ETH', amount: '0.31', decimals: 18 },
				{ asset: 'USDC', amount: '450', decimals: 6 }
			]);
			assert.equal(
				result.addressUrl,
				`https://etherscan.io/address/${toChecksumAddress(EVM.wallet)}`
			);
			// The address travels lower case, in the query of a GET to Blockscout only.
			assert.ok(scout.calls.every((c) => c.address === EVM.wallet));
		} finally {
			await scout.close();
		}
	});

	test('pages by start block past the 10 000 window, without duplicates', async () => {
		const scout = await startFakeBlockscout({
			history: sampleEvmHistory({ fillerTokens: 2500 }),
			maxOffset: 1000
		});
		try {
			const result = await createEvmClient({ sleep: noSleep }).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: scout.endpoints
			});
			const usdcIn = result.entries.filter((e) => e.asset === 'USDC' && e.type === 'received');
			assert.equal(usdcIn.length, 2501);
			assert.ok(scout.calls.filter((c) => c.action === 'tokentx').length >= 3);
			assert.ok(
				scout.calls.filter((c) => c.page).every((c) => Number(c.page) * Number(c.offset) <= 1000)
			);
		} finally {
			await scout.close();
		}
	});

	test('waits out Blockscout rate limits', async () => {
		const scout = await startFakeBlockscout({ rateLimitedCalls: 2 });
		try {
			const result = await createEvmClient({ sleep: noSleep }).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: scout.endpoints
			});
			assert.equal(result.entries.length, 8);
		} finally {
			await scout.close();
		}
	});

	test('a mistyped checksum is refused before any request', async () => {
		const scout = await startFakeBlockscout();
		try {
			const bad = toChecksumAddress(EVM.wallet).replace(/[a-f]/, (c) => c.toUpperCase());
			await assert.rejects(
				createEvmClient().history({ chain: ethereum, address: bad, endpoints: scout.endpoints }),
				{ code: 'WALLET_ADDRESS' }
			);
			assert.equal(scout.calls.length, 0);
		} finally {
			await scout.close();
		}
	});
});

describe('/chains and /<chain>/wallet', () => {
	/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
	/** @type {Awaited<ReturnType<typeof startFakeBlockscout>>} */ let scout;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	/** @type {string[]} */ const logs = [];

	before(async () => {
		node = await startFakeCosmos();
		scout = await startFakeBlockscout();
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
			wallets: createWalletService({ allowLoopback: true, sleep: noSleep }),
			log: (line) => logs.push(line)
		});
		({ port } = await bridge.listen({ port: 0 }));
		token = await pairing.pair(pairing.issueCode());
	});
	after(async () => {
		await bridge?.close();
		await node?.close();
		await scout?.close();
	});

	const auth = () => ({ authorization: `Bearer ${token}` });

	test('need the token', async () => {
		assert.equal((await request(port, '/chains')).status, 401);
		assert.equal((await request(port, '/nyx/wallet', { method: 'POST', body: {} })).status, 401);
	});

	test('chains: endpoints and explorers, and health says wallets work', async () => {
		const { status, json } = await request(port, '/chains', { headers: auth() });
		assert.equal(status, 200);
		const nyxInfo = json.chains.find((/** @type {any} */ c) => c.id === 'nyx');
		assert.equal(nyxInfo.endpoints.rpc, 'https://rpc.nymtech.net');
		assert.equal(nyxInfo.nativeSymbol, 'NYM');
		assert.equal((await request(port, '/health')).json.wallets.available, true);
	});

	test('sync a Nyx wallet on a custom endpoint; the log has counts, not the address', async () => {
		const { status, json } = await request(port, '/nyx/wallet', {
			method: 'POST',
			headers: auth(),
			body: { address: NYX.wallet, endpoints: node.endpoints }
		});
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.chain, 'nyx');
		assert.equal(json.endpoints.rpc, node.url);
		assert.ok(json.entries.length > 100);
		assert.ok(logs.some((l) => /nyx: 119 transaction\(s\)/.test(l)));
		assert.ok(logs.every((l) => !l.includes(NYX.wallet)));
	});

	test('sync an Ethereum wallet', async () => {
		const { status, json } = await request(port, '/ethereum/wallet', {
			method: 'POST',
			headers: auth(),
			body: { address: EVM.wallet, endpoints: scout.endpoints }
		});
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.entries.length, 8);
	});

	test('refuses an unknown chain, a wrong address, an http endpoint – and logs no address', async () => {
		const bad = async (/** @type {any} */ body, chain = 'nyx') =>
			request(port, `/${chain}/wallet`, { method: 'POST', headers: auth(), body });
		assert.equal((await bad({ address: NYX.wallet }, 'dogecoin')).status, 404);
		const wrong = await bad({ address: EVM.wallet, endpoints: node.endpoints });
		assert.equal(wrong.status, 400);
		assert.equal(wrong.json.code, 'WALLET_ADDRESS');
		const http = await bad({
			address: NYX.wallet,
			endpoints: { rpc: 'http://rpc.example.org' }
		});
		assert.equal(http.json.code, 'WALLET_ENDPOINT');
		assert.ok(logs.every((l) => !l.includes(NYX.wallet) && !l.includes(EVM.wallet)));
	});

	test('without loopback, a test endpoint is refused', async () => {
		const service = createWalletService();
		await assert.rejects(
			service.sync({ chain: 'nyx', address: NYX.wallet, endpoints: node.endpoints }),
			{ code: 'WALLET_ENDPOINT' }
		);
	});
});
