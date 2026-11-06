// Own wallets: address checks, the EVM (Blockscout) client against a fake
// node on 127.0.0.1, and the /chains and /<chain>/wallet routes; the Cosmos
// client's own tests are in @belege/chain-cosmos (#264). All
// addresses, hashes and amounts are made up (support/fake-chains.js).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	bech32Decode,
	bech32Encode,
	isCosmosAddress,
	moduleAddress
} from '../src/chains/bech32.js';
import { CHAINS, publicChains } from '../src/chains/registry.js';
import {
	createEvmClient,
	isEvmAddress,
	normalizeEvm,
	toChecksumAddress
} from '../src/chains/evm.js';
import { checkEndpoint } from '../src/chains/http.js';
import { createWalletService } from '../src/chains/index.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import {
	EVM,
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
			// Monero's explorers have no page for an address: the chain hides them.
			if (c.kind === 'monero') assert.equal(c.explorer.address, '');
			else assert.match(c.explorer.address, /^https:\/\/.*\{address\}/);
		}
	});

	test('Monero is listed, and refused for a sync by address: its export is imported in the app', async () => {
		assert.equal(CHAINS.monero.native.symbol, 'XMR');
		assert.equal(CHAINS.monero.native.decimals, 12);
		const service = createWalletService({ fetch: async () => assert.fail('nothing is asked') });
		await assert.rejects(
			service.sync({ chain: 'monero', address: '4' + '1'.repeat(94) }),
			(/** @type {any} */ e) => e.code === 'WALLET_IMPORT_ONLY' && e.status === 400
		);
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
			// The native coin's balance after each change, oldest first, read page by page (#287).
			assert.deepEqual(result.balanceHistory, [
				{
					asset: 'ETH',
					decimals: 18,
					points: [
						{ time: '2026-02-10T12:00:00.000Z', value: '500000000000000000' },
						{ time: '2026-03-20T09:00:00.000Z', value: '310000000000000000' }
					]
				}
			]);
			assert.equal(scout.calls.filter((c) => c.v2).length, 2);
			// The address travels lower case, in a GET to Blockscout only (query, or the v2 path).
			assert.ok(scout.calls.filter((c) => !c.rpc).every((c) => c.address === EVM.wallet));
			assert.deepEqual(
				scout.calls.filter((c) => c.rpc).map((c) => c.rpc),
				['eth_chainId']
			);
		} finally {
			await scout.close();
		}
	});

	test('no balance history where the API has none: not an error (#287)', async () => {
		const scout = await startFakeBlockscout({ coinBalanceHistory: null });
		try {
			const result = await createEvmClient({ sleep: noSleep }).history({
				chain: ethereum,
				address: toChecksumAddress(EVM.wallet),
				endpoints: scout.endpoints
			});
			assert.equal(result.balanceHistory, undefined);
			assert.ok(result.entries.length > 0);
		} finally {
			await scout.close();
		}
	});

	test('ids stay when an internal transaction is indexed late or a token is listed later', () => {
		const history = sampleEvmHistory();
		const ids = (/** @type {any} */ h, /** @type {any} */ chain = ethereum) =>
			normalizeEvm(h, { address: EVM.wallet, chain }).entries.map((e) => e.id);
		const before = ids({ ...history, internal: [] });
		const late = ids(history);
		const spamListed = ids(history, {
			...ethereum,
			tokens: { ...ethereum.tokens, [EVM.spamToken]: { symbol: 'TESTTOKEN', decimals: 6 } }
		});
		assert.equal(late.length, before.length + 1);
		assert.equal(spamListed.length, late.length + 1);
		for (const id of before) {
			assert.ok(late.includes(id), id);
			assert.ok(spamListed.includes(id), id);
		}
		assert.ok(before.includes(`${fakeHash('usdc-out', true)}:fee`));
		assert.ok(before.includes(`${fakeHash('eth-in', true)}:value`));
	});

	test('refuses an API of another chain, or one that does not say, before reading anything', async () => {
		for (const [chainId, code] of [
			['0x2105', 'WALLET_WRONG_CHAIN'],
			[null, 'WALLET_CHAIN_UNVERIFIED']
		]) {
			const scout = await startFakeBlockscout({ chainId: /** @type {any} */ (chainId) });
			try {
				await assert.rejects(
					createEvmClient({ sleep: noSleep }).history({
						chain: ethereum,
						address: EVM.wallet,
						endpoints: scout.endpoints
					}),
					{ code }
				);
				assert.equal(scout.calls.filter((c) => c.action).length, 0);
			} finally {
				await scout.close();
			}
		}
	});

	test('an API error message loses addresses and hashes before it can reach the log', async () => {
		const client = createEvmClient({
			sleep: noSleep,
			fetch: async (url) =>
				new Response(
					JSON.stringify(
						String(url).endsWith('/eth-rpc')
							? { jsonrpc: '2.0', id: 1, result: '0x1' }
							: {
									status: '0',
									message: `Error for ${EVM.wallet} in ${fakeHash('x', true)}`,
									result: null
								}
					),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		});
		await assert.rejects(
			client.history({
				chain: ethereum,
				address: EVM.wallet,
				endpoints: { api: 'https://api.example.org/api' }
			}),
			(/** @type {any} */ e) => {
				assert.equal(e.code, 'WALLET_NODE');
				assert.doesNotMatch(e.message, /0x[0-9a-f]{8,}/i);
				return true;
			}
		);
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
