// Own EVM wallets read through Alchemy (chains/alchemy.js) against a fake
// Alchemy as strict as the real one, the same made-up chain read through a
// fake Blockscout for the ids, and the setup CLI. Every address, hash, key
// and amount is made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHAINS, publicChains } from '../src/chains/registry.js';
import { createEvmClient } from '../src/chains/evm.js';
import { createWalletService } from '../src/chains/index.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { runAlchemySetup } from '../src/setup-alchemy.js';
import { EVM, fakeEvmAddress, fakeHash, startFakeBlockscout } from './support/fake-chains.js';
import {
	FAKE_ALCHEMY_KEY,
	blockscoutView,
	evmChain,
	fakeTx,
	startFakeAlchemy
} from './support/fake-alchemy.js';
import { request } from './support/http.js';

const ethereum = /** @type {import('../src/chains/registry.js').EvmChain} */ (CHAINS.ethereum);
const arbitrum = /** @type {import('../src/chains/registry.js').EvmChain} */ (CHAINS.arbitrum);
const noSleep = async () => {};
const hashOf = (/** @type {string} */ seed) => fakeHash(seed, true);

/** @param {Awaited<ReturnType<typeof startFakeAlchemy>>} alchemy @param {string | null} [key] */
const clientFor = (alchemy, key = FAKE_ALCHEMY_KEY) =>
	createEvmClient({
		sleep: noSleep,
		alchemy: { key: async () => key, baseUrl: alchemy.baseUrl }
	});

describe('reading an EVM wallet through Alchemy', () => {
	/** @type {Awaited<ReturnType<typeof startFakeAlchemy>>} */ let alchemy;
	before(async () => {
		alchemy = await startFakeAlchemy();
	});
	after(() => alchemy?.close());

	test('transfers, gas (also of a failed send, an approval and a claim), tokens, internal, balances', async () => {
		const r = await clientFor(alchemy).history({
			chain: ethereum,
			address: EVM.wallet,
			endpoints: ethereum.endpoints
		});
		assert.equal(r.source, 'alchemy');
		const byId = new Map(r.entries.map((e) => [e.id, e]));
		const id = (/** @type {string} */ seed, /** @type {string} */ rest) =>
			`${hashOf(seed)}:${rest}`;

		assert.equal(byId.get(id('a-eth-in', 'value'))?.amount, '0.5');
		assert.equal(byId.get(id('a-eth-out', 'value'))?.amount, '-0.1');
		assert.equal(byId.get(id('a-eth-out', 'fee'))?.amount, '-0.000021');
		// The token out, and its gas.
		const out = byId.get(
			id('a-usdc-out', `erc20:${EVM.usdc}:${EVM.wallet}:${EVM.exchange}:300000000:0`)
		);
		assert.equal(out?.amount, '-300');
		assert.equal(out?.counterparty, EVM.exchange);
		assert.equal(byId.get(id('a-usdc-out', 'fee'))?.amount, '-0.0001');
		// No transfer shows these; the nonce does.
		assert.equal(byId.get(id('a-approve', 'fee'))?.amount, '-0.000046');
		const failed = byId.get(id('a-failed', 'fee'));
		assert.equal(failed?.amount, '-0.000063');
		assert.equal(failed?.success, false);
		assert.equal(byId.get(id('a-failed', 'value')), undefined);
		// The wallet sent the claim, and paid for it; the USDC came in.
		assert.equal(byId.get(id('a-claim', 'fee'))?.amount, '-0.00008');
		// USDC pulled out by someone else's transaction: booked, but no gas for us.
		const spender = fakeEvmAddress('a spender contract');
		assert.equal(
			byId.get(id('a-pulled', `erc20:${EVM.usdc}:${EVM.wallet}:${spender}:5000000:0`))?.amount,
			'-5'
		);
		assert.equal(byId.get(id('a-pulled', 'fee')), undefined);
		// Two identical transfers in one transaction stay two.
		assert.ok(byId.has(id('a-twice', `erc20:${EVM.usdc}:${EVM.friend}:${EVM.wallet}:1000000:0`)));
		assert.ok(byId.has(id('a-twice', `erc20:${EVM.usdc}:${EVM.friend}:${EVM.wallet}:1000000:1`)));
		// Internal: by Alchemy's trace address, with a prefix of its own.
		assert.equal(byId.get(id('a-contract-pays', 'internal:trace:3_0'))?.amount, '0.02');
		assert.equal(byId.get(id('a-contract-pays', 'internal:trace:0_3_0'))?.amount, '0.005');
		// The token that calls itself USDC is counted, not booked.
		assert.equal(r.unknownAssets, 1);
		assert.ok(r.entries.every((e) => e.hash !== hashOf('a-spam')));
		// Decimals and symbols from the registry, never from the token.
		assert.ok(r.entries.filter((e) => e.asset === 'USDC').every((e) => e.decimals === 6));
		assert.deepEqual(r.balances, [
			{ asset: 'ETH', amount: '0.31', decimals: 18 },
			{ asset: 'USDC', amount: '450', decimals: 6 }
		]);
		// Oldest first.
		const heights = r.entries.map((e) => e.height);
		assert.deepEqual(
			heights,
			[...heights].sort((a, b) => a - b)
		);
		assert.equal(r.addressUrl, `https://etherscan.io/address/${EVM.wallet}`);
	});

	test('value received in a reverted transaction is not booked, even when Alchemy lists it', async () => {
		const txs = [
			...evmChain(),
			fakeTx({
				seed: 'a-reverted-in',
				block: 800,
				from: EVM.friend,
				to: EVM.wallet,
				value: 70000000000000000n,
				ok: false
			})
		];
		const fake = await startFakeAlchemy({ txs, listFailedExternal: true });
		try {
			const r = await clientFor(fake).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			assert.ok(r.entries.every((e) => e.hash !== hashOf('a-reverted-in')));
			// Its receipt was asked, in the batch with the other received ones.
			const receipts = fake.calls.filter((c) => c.method === 'eth_getTransactionReceipt');
			assert.ok(receipts.some((c) => c.params[0] === hashOf('a-reverted-in')));
			assert.ok(receipts.some((c) => c.params[0] === hashOf('a-eth-in')));
			assert.equal(r.entries.find((e) => e.id === `${hashOf('a-eth-in')}:value`)?.amount, '0.5');
		} finally {
			await fake.close();
		}
	});

	test('receipts without a status (before Byzantium): gas booked, value not, and counted', async () => {
		const txs = [
			fakeTx({
				seed: 'a-old-in',
				block: 110,
				from: EVM.friend,
				to: EVM.wallet,
				value: 300000000000000000n,
				preByzantium: true
			}),
			fakeTx({
				seed: 'a-old-out',
				block: 120,
				from: EVM.wallet,
				to: EVM.friend,
				value: 100000000000000000n,
				preByzantium: true
			})
		];
		const fake = await startFakeAlchemy({ txs });
		try {
			const r = await clientFor(fake).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			assert.deepEqual(
				r.entries.map((e) => [e.id, e.amount, e.success]),
				[[`${hashOf('a-old-out')}:fee`, '-0.000021', true]]
			);
			assert.equal(r.unknownStatus, 2);
		} finally {
			await fake.close();
		}
	});

	test('asks the way the API wants it: both directions, the categories, metadata, asc, batches', async () => {
		const fake = await startFakeAlchemy();
		try {
			await clientFor(fake).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			const transfers = fake.calls.filter((c) => c.method === 'alchemy_getAssetTransfers');
			assert.equal(transfers.length, 2);
			for (const c of transfers) {
				const p = c.params[0];
				assert.deepEqual(p.category, ['external', 'erc20', 'internal']);
				assert.equal(p.withMetadata, true);
				assert.equal(p.excludeZeroValue, true);
				assert.equal(p.order, 'asc');
				assert.equal(p.maxCount, '0x3e8');
			}
			assert.equal(transfers[0].params[0].fromAddress, EVM.wallet);
			assert.equal(transfers[1].params[0].toAddress, EVM.wallet);
			assert.ok(!('toAddress' in transfers[0].params[0]));
			assert.equal(fake.calls[0].method, 'eth_chainId');
			assert.ok(fake.calls.some((c) => c.method === 'eth_getTransactionReceipt'));
			assert.ok(fake.calls.some((c) => c.method === 'eth_getBlockByNumber'));
			assert.ok(fake.calls.every((c) => c.network === 'eth-mainnet'));
		} finally {
			await fake.close();
		}
	});

	test('pages with pageKey', async () => {
		const fake = await startFakeAlchemy({ txs: evmChain({ fillerTransfers: 2300 }) });
		try {
			const r = await clientFor(fake).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			const incoming = fake.calls.filter(
				(c) => c.method === 'alchemy_getAssetTransfers' && c.params[0].toAddress
			);
			assert.equal(incoming.length, 3);
			assert.equal(incoming[0].params[0].pageKey, undefined);
			assert.equal(typeof incoming[1].params[0].pageKey, 'string');
			assert.equal(r.entries.filter((e) => e.amount === '0.000001').length, 2300);
		} finally {
			await fake.close();
		}
	});

	test('the same chain read through Blockscout gives the same ids – internal transfers apart', async () => {
		const txs = evmChain();
		const fake = await startFakeAlchemy({ txs });
		const scout = await startFakeBlockscout({
			history: blockscoutView(txs),
			balances: { native: '310000000000000000', [EVM.usdc]: '450000000' }
		});
		try {
			const viaAlchemy = await clientFor(fake).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			const viaScout = await clientFor(fake, null).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: scout.endpoints
			});
			assert.equal(viaScout.source, 'blockscout');
			const shape = (/** @type {typeof viaAlchemy.entries} */ entries) =>
				entries
					.filter((e) => !e.id.includes(':internal:'))
					.map((e) => `${e.id} ${e.amount} ${e.counterparty} ${e.success} ${e.time}`)
					.sort();
			assert.deepEqual(shape(viaAlchemy.entries), shape(viaScout.entries));
			// Internal transfers: the same ones, by other ids (the app pairs them).
			const internal = (/** @type {typeof viaAlchemy.entries} */ entries) =>
				entries.filter((e) => e.id.includes(':internal:'));
			assert.deepEqual(
				internal(viaAlchemy.entries).map((e) => e.id.split(':internal:')[1]),
				['trace:3_0', 'trace:0_3_0']
			);
			assert.deepEqual(
				internal(viaScout.entries).map((e) => e.id.split(':internal:')[1]),
				['1', '3']
			);
			assert.deepEqual(
				internal(viaAlchemy.entries).map((e) => `${e.hash} ${e.amount} ${e.counterparty}`),
				internal(viaScout.entries).map((e) => `${e.hash} ${e.amount} ${e.counterparty}`)
			);
			assert.deepEqual(viaAlchemy.balances, viaScout.balances);
			assert.equal(viaAlchemy.unknownAssets, viaScout.unknownAssets);
		} finally {
			await fake.close();
			await scout.close();
		}
	});

	test('Arbitrum: no internal category at Alchemy; internal transfers from Blockscout', async () => {
		const txs = evmChain();
		const fake = await startFakeAlchemy({ txs });
		const scout = await startFakeBlockscout({ history: blockscoutView(txs), chainId: '0xa4b1' });
		// The default Blockscout host of Arbitrum, answered by the fake.
		/** @type {typeof fetch} */
		const redirect = (url, init) =>
			fetch(String(url).replace(arbitrum.endpoints.api, scout.endpoints.api), init);
		try {
			const r = await createEvmClient({
				fetch: redirect,
				sleep: noSleep,
				alchemy: { key: async () => FAKE_ALCHEMY_KEY, baseUrl: fake.baseUrl }
			}).history({ chain: arbitrum, address: EVM.wallet, endpoints: arbitrum.endpoints });
			const transfers = fake.calls.filter((c) => c.method === 'alchemy_getAssetTransfers');
			assert.ok(transfers.every((c) => !c.params[0].category.includes('internal')));
			assert.ok(transfers.every((c) => c.network === 'arb-mainnet'));
			assert.deepEqual(
				r.entries
					.filter((e) => e.id.includes(':internal:'))
					.map((e) => e.id.split(':internal:')[1]),
				['1', '3']
			);
			// Blockscout was asked for the internal list only.
			assert.deepEqual(
				scout.calls.filter((c) => !c.rpc).map((c) => c.action),
				['txlistinternal']
			);
			assert.ok(r.entries.every((e) => e.explorerUrl.startsWith('https://arbiscan.io/tx/')));
		} finally {
			await fake.close();
			await scout.close();
		}
	});

	test('a wallet with an endpoint of its own is read there, never through Alchemy', async () => {
		const fake = await startFakeAlchemy();
		const scout = await startFakeBlockscout();
		try {
			const service = createWalletService({
				allowLoopback: true,
				sleep: noSleep,
				alchemyKey: async () => FAKE_ALCHEMY_KEY,
				alchemyBaseUrl: fake.baseUrl
			});
			const r = await service.sync({
				chain: 'ethereum',
				address: EVM.wallet,
				endpoints: scout.endpoints
			});
			assert.equal(r.source, 'blockscout');
			assert.equal(fake.calls.length, 0);
		} finally {
			await fake.close();
			await scout.close();
		}
	});

	test('the fake refuses what the real API refuses', async () => {
		const post = async (
			/** @type {unknown} */ body,
			network = 'eth-mainnet',
			key = FAKE_ALCHEMY_KEY
		) => {
			const res = await fetch(`${alchemy.baseUrl(network)}/${key}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			return { status: res.status, json: await res.json() };
		};
		const transfers = (/** @type {Record<string, unknown>} */ p) =>
			post({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [p] });
		const base = { fromAddress: EVM.wallet, category: ['external'] };
		assert.equal((await transfers({ ...base, withMetadata: 'true' })).json.error.code, -32602);
		assert.equal((await transfers({ ...base, excludeZeroValue: 1 })).json.error.code, -32602);
		assert.equal((await transfers({ ...base, maxCount: 1000 })).json.error.code, -32602);
		assert.equal((await transfers({ ...base, maxCount: '0x3e9' })).json.error.code, -32602);
		assert.equal((await transfers({ ...base, category: ['erc-20'] })).json.error.code, -32602);
		assert.equal((await transfers({ ...base, sort: 'asc' })).json.error.code, -32602);
		assert.equal((await transfers({ fromAddress: EVM.wallet })).json.error.code, -32602);
		const internalOnArb = await post(
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'alchemy_getAssetTransfers',
				params: [{ ...base, category: ['internal'] }]
			},
			'arb-mainnet'
		);
		assert.equal(internalOnArb.json.error.code, -32602);
		const unknown = await post({ jsonrpc: '2.0', id: 1, method: 'eth_getTransfers', params: [] });
		assert.deepEqual(unknown.json.error, {
			code: -32601,
			message: 'Unsupported method: eth_getTransfers.'
		});
		const block = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getBlockByNumber',
			params: ['0x10', 'true']
		});
		assert.equal(block.json.error.code, -32602);
		const count = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getTransactionCount',
			params: [EVM.wallet, 16]
		});
		assert.equal(count.json.error.code, -32602);
		const noKey = await post(
			{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
			'eth-mainnet',
			'wrongKey_000000'
		);
		assert.equal(noKey.status, 401);
		assert.deepEqual(noKey.json.error, { code: -32600, message: 'Must be authenticated!' });
	});
});

describe('Alchemy refusals: a clear code, and never the key', () => {
	test('a key Alchemy refuses: WALLET_ALCHEMY_AUTH', async () => {
		const fake = await startFakeAlchemy({ key: 'anotherKey_12345678' });
		try {
			await assert.rejects(
				clientFor(fake).history({
					chain: ethereum,
					address: EVM.wallet,
					endpoints: ethereum.endpoints
				}),
				(/** @type {any} */ e) =>
					e.code === 'WALLET_ALCHEMY_AUTH' && !e.message.includes(FAKE_ALCHEMY_KEY)
			);
		} finally {
			await fake.close();
		}
	});

	test('a network not enabled for the app: WALLET_ALCHEMY_DENIED, without the dashboard link', async () => {
		const fake = await startFakeAlchemy({ deniedNetworks: ['base-mainnet'] });
		try {
			await assert.rejects(
				clientFor(fake).history({
					chain: /** @type {any} */ (CHAINS.base),
					address: EVM.wallet,
					endpoints: CHAINS.base.endpoints
				}),
				(/** @type {any} */ e) =>
					e.code === 'WALLET_ALCHEMY_DENIED' &&
					/BASE-MAINNET is not enabled/.test(e.message) &&
					!/https?:/.test(e.message) &&
					!e.message.includes(FAKE_ALCHEMY_KEY)
			);
		} finally {
			await fake.close();
		}
	});

	test('rate limits: waited out, in a 429 and inside a batch; if they last, WALLET_ALCHEMY_RATE_LIMIT', async () => {
		const brief = await startFakeAlchemy({ rateLimitedRequests: 1, rateLimitedItems: 2 });
		try {
			const r = await clientFor(brief).history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: ethereum.endpoints
			});
			assert.ok(r.entries.length > 10);
		} finally {
			await brief.close();
		}
		const lasting = await startFakeAlchemy({ rateLimitedRequests: 100 });
		try {
			await assert.rejects(
				clientFor(lasting).history({
					chain: ethereum,
					address: EVM.wallet,
					endpoints: ethereum.endpoints
				}),
				{ code: 'WALLET_ALCHEMY_RATE_LIMIT', status: 429 }
			);
		} finally {
			await lasting.close();
		}
	});

	test('another chain behind the URL: WALLET_WRONG_CHAIN, nothing read', async () => {
		const fake = await startFakeAlchemy({ chainIds: { 'eth-mainnet': 10 } });
		try {
			await assert.rejects(
				clientFor(fake).history({
					chain: ethereum,
					address: EVM.wallet,
					endpoints: ethereum.endpoints
				}),
				{ code: 'WALLET_WRONG_CHAIN' }
			);
			assert.deepEqual(
				fake.calls.map((c) => c.method),
				['eth_chainId']
			);
		} finally {
			await fake.close();
		}
	});

	test('a stored key of an odd form is sent nowhere', async () => {
		const fake = await startFakeAlchemy();
		try {
			await assert.rejects(
				clientFor(fake, 'a key/with?odd#chars').history({
					chain: ethereum,
					address: EVM.wallet,
					endpoints: ethereum.endpoints
				}),
				{ code: 'WALLET_ALCHEMY_AUTH' }
			);
			assert.equal(fake.paths.length, 0);
		} finally {
			await fake.close();
		}
	});

	test('through the bridge: /chains says whether there is a key, logs and answers never hold it', async () => {
		const fake = await startFakeAlchemy();
		const denied = await startFakeAlchemy({ deniedNetworks: ['polygon-mainnet'] });
		/** @type {string[]} */
		const logs = [];
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		let key = /** @type {string | null} */ (null);
		const bridge = createBridgeServer({
			config: { ...defaultConfig(), appOrigins: [] },
			pairing,
			hibiscus: null,
			wallets: createWalletService({
				allowLoopback: true,
				sleep: noSleep,
				alchemyKey: async () => key,
				alchemyBaseUrl: (network) =>
					network === 'polygon-mainnet' ? denied.baseUrl(network) : fake.baseUrl(network)
			}),
			log: (line) => logs.push(line)
		});
		const { port } = await bridge.listen({ port: 0 });
		const token = await pairing.pair(pairing.issueCode());
		const auth = { authorization: `Bearer ${token}` };
		try {
			const without = await request(port, '/chains', { headers: auth });
			assert.equal(without.json.alchemy, false);
			assert.equal(
				without.json.chains.find((/** @type {any} */ c) => c.id === 'optimism').alchemySupported,
				true
			);
			key = FAKE_ALCHEMY_KEY;
			const withKey = await request(port, '/chains', { headers: auth });
			assert.equal(withKey.json.alchemy, true);

			const ok = await request(port, '/ethereum/wallet', {
				method: 'POST',
				headers: auth,
				body: { address: EVM.wallet }
			});
			assert.equal(ok.status, 200, JSON.stringify(ok.json));
			assert.equal(ok.json.source, 'alchemy');
			const refused = await request(port, '/polygon/wallet', {
				method: 'POST',
				headers: auth,
				body: { address: EVM.wallet }
			});
			assert.equal(refused.status, 502);
			assert.equal(refused.json.code, 'WALLET_ALCHEMY_DENIED');

			const everything = JSON.stringify([without.json, withKey.json, ok.json, refused.json, logs]);
			assert.ok(!everything.includes(FAKE_ALCHEMY_KEY));
			assert.ok(logs.every((l) => !l.includes(EVM.wallet)));
			assert.ok(logs.some((l) => /ethereum: \d+ transaction/.test(l)));
			// The key went to the fake, in the path, and only there.
			assert.ok(fake.paths.every((p) => p === `/eth-mainnet/v2/${FAKE_ALCHEMY_KEY}`));
		} finally {
			await bridge.close();
			await fake.close();
			await denied.close();
		}
	});
});

describe('the registry names Alchemy networks', () => {
	test('every EVM chain has one; internal where Alchemy offers it', () => {
		const nets = Object.values(CHAINS)
			.filter((c) => c.kind === 'evm')
			.map((c) => [
				c.id,
				/** @type {any} */ (c).alchemy.network,
				/** @type {any} */ (c).alchemy.internal
			]);
		assert.deepEqual(nets, [
			['ethereum', 'eth-mainnet', true],
			['base', 'base-mainnet', true],
			['arbitrum', 'arb-mainnet', false],
			['optimism', 'opt-mainnet', false],
			['polygon', 'polygon-mainnet', true]
		]);
		assert.ok(publicChains().every((c) => !('alchemy' in c)));
	});
});

describe('pnpm setup:alchemy', () => {
	/** @param {string[]} answers hidden ones first, then plain ones */
	const io = (/** @type {string[]} */ hidden, /** @type {string[]} */ plain = []) => {
		/** @type {string[]} */
		const printed = [];
		return {
			printed,
			io: {
				askHidden: async () => hidden.shift() ?? '',
				ask: async () => plain.shift() ?? '',
				print: (/** @type {string} */ line) => printed.push(line)
			}
		};
	};
	const allOk = async () => [
		{ chain: 'Ethereum', result: /** @type {const} */ ('ok') },
		{ chain: 'Arbitrum One', result: /** @type {const} */ ('denied') }
	];

	test('stores a key Alchemy accepts, says which networks answer, never prints it', async () => {
		const keychain = memoryKeychain(null, 'alchemy');
		const { io: ioFake, printed } = io([FAKE_ALCHEMY_KEY]);
		/** @type {string[]} */
		const checked = [];
		const stored = await runAlchemySetup({
			io: ioFake,
			keychain,
			check: async (k) => {
				checked.push(k);
				return allOk();
			}
		});
		assert.equal(stored, true);
		assert.equal(await keychain.read(), FAKE_ALCHEMY_KEY);
		assert.deepEqual(checked, [FAKE_ALCHEMY_KEY]);
		assert.ok(printed.some((l) => /Arbitrum One: refused – enable this network/.test(l)));
		assert.ok(printed.every((l) => !l.includes(FAKE_ALCHEMY_KEY)));
	});

	test('a key Alchemy refuses, or of the wrong form, is not stored', async () => {
		const keychain = memoryKeychain(null, 'alchemy');
		const refused = io([FAKE_ALCHEMY_KEY]);
		assert.equal(
			await runAlchemySetup({
				io: refused.io,
				keychain,
				check: async () => [{ chain: 'Ethereum', result: 'refused-key' }]
			}),
			false
		);
		assert.match(refused.printed.join('\n'), /did not accept/);
		let called = false;
		const odd = io(['not a key!']);
		assert.equal(
			await runAlchemySetup({
				io: odd.io,
				keychain,
				check: async () => {
					called = true;
					return allOk();
				}
			}),
			false
		);
		assert.equal(called, false);
		await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
	});

	test('Enter keeps the stored key; "-" deletes it after asking', async () => {
		const keychain = memoryKeychain(FAKE_ALCHEMY_KEY, 'alchemy');
		assert.equal(await runAlchemySetup({ io: io(['']).io, keychain, check: allOk }), true);
		assert.equal(await keychain.read(), FAKE_ALCHEMY_KEY);
		// "-", then no: kept.
		assert.equal(await runAlchemySetup({ io: io(['-'], ['n']).io, keychain, check: allOk }), true);
		assert.equal(await keychain.read(), FAKE_ALCHEMY_KEY);
		// "-", then yes: gone.
		const del = io(['-'], ['y']);
		assert.equal(await runAlchemySetup({ io: del.io, keychain, check: allOk }), false);
		await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
		assert.match(del.printed.join('\n'), /Deleted/);
	});
});

describe('test mode', () => {
	const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
	/** @type {string} */ let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-alchemy-'));
	});
	after(() => rm(dir, { recursive: true, force: true }));

	/** @param {Record<string, string>} env */
	function run(env) {
		const child = spawn(
			process.execPath,
			[CLI, '--test-mode', '--config', join(dir, 'bridge.json'), '--port', '0'],
			{
				env: { ...process.env, ...env },
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
		return { child, exited, out: () => out };
	}
	/** @param {() => string} read @param {RegExp} pattern */
	async function waitFor(read, pattern) {
		const end = Date.now() + 10_000;
		while (Date.now() < end) {
			const m = pattern.exec(read());
			if (m) return m;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`timed out waiting for ${pattern}\n${read()}`);
	}

	test('the key comes from the environment and goes only to the fake Alchemy', async () => {
		await saveConfig({ ...defaultConfig(), bridge: { port: 0 } }, join(dir, 'bridge.json'));
		const fake = await startFakeAlchemy();
		const bridge = run({
			BELEGE_BRIDGE_TEST_ALCHEMY_KEY: FAKE_ALCHEMY_KEY,
			BELEGE_BRIDGE_TEST_ALCHEMY_URL: fake.url
		});
		try {
			const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
			const [, code] = await waitFor(bridge.out, /Pairing code[^:]*: (\S+)/);
			const { json } = await request(Number(port), '/pair', { method: 'POST', body: { code } });
			const auth = { authorization: `Bearer ${json.token}` };
			assert.equal((await request(Number(port), '/chains', { headers: auth })).json.alchemy, true);
			const res = await request(Number(port), '/ethereum/wallet', {
				method: 'POST',
				headers: auth,
				body: { address: EVM.wallet }
			});
			assert.equal(res.status, 200, JSON.stringify(res.json));
			assert.equal(res.json.source, 'alchemy');
			assert.ok(!bridge.out().includes(FAKE_ALCHEMY_KEY));
		} finally {
			bridge.child.kill('SIGTERM');
			await bridge.exited;
			await fake.close();
		}
	});

	test('a test key without a fake Alchemy is refused', async () => {
		await saveConfig({ ...defaultConfig(), bridge: { port: 0 } }, join(dir, 'bridge.json'));
		const bridge = run({ BELEGE_BRIDGE_TEST_ALCHEMY_KEY: FAKE_ALCHEMY_KEY });
		assert.equal(await bridge.exited, 1);
		assert.match(bridge.out(), /needs BELEGE_BRIDGE_TEST_ALCHEMY_URL/);
	});

	test('without a test key there is none: /chains says so', async () => {
		await saveConfig({ ...defaultConfig(), bridge: { port: 0 } }, join(dir, 'bridge.json'));
		const bridge = run({});
		try {
			const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
			const [, code] = await waitFor(bridge.out, /Pairing code[^:]*: (\S+)/);
			const { json } = await request(Number(port), '/pair', { method: 'POST', body: { code } });
			const res = await request(Number(port), '/chains', {
				headers: { authorization: `Bearer ${json.token}` }
			});
			assert.equal(res.json.alchemy, false);
		} finally {
			bridge.child.kill('SIGTERM');
			await bridge.exited;
		}
	});
});
