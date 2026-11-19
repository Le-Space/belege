// Filecoin Pay on the bridge: `filecoinpay.statement` against a fake of the
// makers' index, Blockscout and Filfox on 127.0.0.1, with and without a
// Blockscout key, and `pnpm setup:blockscout`. Everything made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FILECOIN_PAY, createFilecoinPayClient } from '@le-space/chains/filecoin-pay';
import { toFilecoinAddress } from '@le-space/chains/filecoin';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { isBlockscoutKey, runBlockscoutSetup, testCall } from '../src/setup-blockscout.js';
import { startFakeFilecoinPay } from './support/fake-filecoin-pay.js';
import { request } from './support/http.js';

const PAYER = `0x${'1a'.repeat(20)}`;
const PROVIDER = `0x${'a1'.repeat(20)}`;
const USDFC = FILECOIN_PAY.token.contract;
const WARM = Object.keys(FILECOIN_PAY.services)[0];
const KEY = 'proapi_made_up_key';

/** A payer with one rail: paid in in July, settled twice in August. */
const events = () =>
	/** @type {import('@le-space/chains/testing/filecoin-pay').PayEvent[]} */ ([
		{ at: '2026-07-01T10:00:00Z', deposit: '10', token: USDFC, from: PAYER, to: PAYER },
		{
			at: '2026-07-01T10:05:00Z',
			rail: 7,
			payer: PAYER,
			payee: PROVIDER,
			token: USDFC,
			operator: WARM
		},
		{
			at: '2026-08-03T09:00:00Z',
			settled: '1.2',
			railId: 7,
			toPayee: '1.19',
			commission: '0',
			fee: '0.01',
			upTo: '2026-08-03T00:00:00Z'
		},
		{
			at: '2026-08-20T09:00:00Z',
			settled: '0.5',
			railId: 7,
			toPayee: '0.5',
			commission: '0',
			fee: '0',
			upTo: '2026-08-19T00:00:00Z'
		},
		{ at: '2026-08-28T12:00:00Z', withdraw: '1', token: USDFC, from: PAYER, to: PAYER }
	]);

/**
 * A bridge with the Filecoin Pay reader pointed at a fake.
 *
 * @param {{ down?: { index?: boolean, blockscout?: boolean, filfox?: boolean }, key?: string | null }} [options]
 */
async function setup({ down = {}, key = null } = {}) {
	const fake = await startFakeFilecoinPay({
		contract: FILECOIN_PAY.contract,
		events: events(),
		funds: { [PAYER]: '7.3' },
		token: USDFC,
		toFilecoin: toFilecoinAddress,
		down,
		key: KEY
	});
	/** @type {{ hash: string, createdAt: string }[]} */
	let hashes = [];
	const pairing = createPairing({
		getHashes: () => hashes,
		saveHashes: async (h) => {
			hashes = h;
		}
	});
	/** @type {string[]} */
	const logs = [];
	const keychain = memoryKeychain(key, 'blockscout');
	const bridge = createBridgeServer({
		legacyRoutes: true,
		config: { ...defaultConfig(), appOrigins: [] },
		pairing,
		hibiscus: null,
		filecoinPay: createFilecoinPayClient({
			sleep: async () => {},
			pauseMs: 0,
			rates: { rate: async () => ({ rate: '0.9', source: 'coingecko' }) },
			now: () => new Date('2026-09-10T00:00:00Z'),
			keyed: { api: `${fake.url}/keyed/v2/api`, rpc: `${fake.url}/keyed/314/json-rpc` }
		}),
		filecoinPayLoopback: true,
		filecoinPayEndpoints: {
			index: `${fake.url}/index`,
			filfox: `${fake.url}/filfox`,
			blockscout: `${fake.url}/blockscout`
		},
		blockscoutKey: () => keychain.read().catch(() => null),
		log: (line) => logs.push(line)
	});
	const { port } = await bridge.listen({ port: 0 });
	const token = await pairing.pair(pairing.issueCode());
	/** @param {unknown} body @param {boolean} [withToken] */
	const ask = (body, withToken = true) =>
		request(port, '/filecoinpay/statement', {
			method: 'POST',
			headers: withToken ? { authorization: `Bearer ${token}` } : {},
			body
		});
	return {
		fake,
		logs,
		keychain,
		ask,
		close: async () => {
			await bridge.close();
			await fake.close();
		}
	};
}

describe('filecoinpay.statement', () => {
	/** @type {Awaited<ReturnType<typeof setup>>} */ let b;
	before(async () => {
		b = await setup();
	});
	after(() => b?.close());

	test('a month from the index, valued; only with a token; counts in the log, no address', async () => {
		const r = await b.ask({ address: PAYER, month: '2026-08' });
		assert.equal(r.status, 200);
		assert.deepEqual(
			[r.json.opening, r.json.closing, r.json.source, r.json.blockscoutKey],
			['10', '7.3', 'index', false]
		);
		assert.deepEqual(r.json.totals, {
			deposits: '0',
			withdrawals: '1',
			usage: '1.7',
			eurCents: 153
		});
		assert.equal(r.json.usage.length, 2);
		assert.equal((await b.ask({ address: PAYER, month: '2026-08' }, false)).status, 401);
		const line = b.logs.find((l) => l.startsWith('filecoin pay: statement'));
		assert.match(
			String(line),
			/2 settlement\(s\), 0 paid in, 1 taken out, from index, Blockscout without a key/
		);
		assert.ok(b.logs.every((l) => !/0x[0-9a-f]{40}|f410f/i.test(l)));
		assert.deepEqual(b.fake.authorizations, []);
	});

	test('the payer as f410f…, and one way only when asked', async () => {
		const r = await b.ask({ address: toFilecoinAddress(PAYER), month: '2026-08', source: 'logs' });
		assert.equal(r.status, 200);
		assert.deepEqual([r.json.address, r.json.source, r.json.closing], [PAYER, 'logs', '7.3']);
	});

	test('what is no payer, no month or no https endpoint is refused', async () => {
		const bad = await b.ask({ address: 'f0123', month: '2026-08' });
		assert.deepEqual([bad.status, bad.json.code], [400, 'FILPAY_ADDRESS']);
		const month = await b.ask({ address: PAYER, month: '2026-8' });
		assert.deepEqual([month.status, month.json.code], [400, 'FILPAY_MONTH']);
		const before = b.fake.calls.length;
		for (const endpoints of [
			{ index: 'http://example.org/graph' },
			{ blockscout: 'ftp://example.org' },
			{ filfox: 'https://user:secret@example.org' },
			{ index: 'http://192.168.1.10/graph' }
		]) {
			const r = await b.ask({ address: PAYER, month: '2026-08', endpoints });
			assert.deepEqual([r.status, r.json.code], [400, 'FILPAY_ENDPOINT']);
		}
		assert.equal(b.fake.calls.length, before, 'nothing was asked');
	});
});

describe('with a Blockscout key', () => {
	test('the key goes to the keyed host in a header: in no URL, no log and no answer', async () => {
		const b = await setup({ down: { index: true }, key: KEY });
		try {
			const r = await b.ask({ address: PAYER, month: '2026-08' });
			assert.equal(r.status, 200);
			assert.deepEqual(
				[r.json.source, r.json.indexFailed !== null, r.json.closing, r.json.blockscoutKey],
				['logs', true, '7.3', true]
			);
			assert.ok(b.fake.authorizations.length >= 5);
			assert.ok(b.fake.authorizations.every((a) => a.startsWith('/keyed/')));
			assert.ok(b.fake.calls.every((c) => !c.includes('key in the URL')));
			assert.ok(!r.text.includes(KEY));
			assert.ok(b.logs.every((l) => !l.includes(KEY)));
			assert.match(
				b.logs.join('\n'),
				/from logs \(the index did not answer\), Blockscout with a key/
			);
		} finally {
			await b.close();
		}
	});

	test('a Blockscout the request names gets no key', async () => {
		const b = await setup({ down: { index: true }, key: KEY });
		try {
			const r = await b.ask({
				address: PAYER,
				month: '2026-08',
				endpoints: { blockscout: `${b.fake.url}/blockscout` }
			});
			assert.equal(r.status, 200);
			assert.equal(r.json.blockscoutKey, false);
			assert.deepEqual(b.fake.authorizations, []);
		} finally {
			await b.close();
		}
	});

	test('a key Blockscout refuses: an error that names the host, not the key', async () => {
		const b = await setup({ down: { index: true }, key: 'proapi_another_key' });
		try {
			const r = await b.ask({ address: PAYER, month: '2026-08' });
			assert.ok(r.status >= 400);
			assert.ok(!r.text.includes('proapi_'));
			assert.ok(b.logs.every((l) => !l.includes('proapi_')));
		} finally {
			await b.close();
		}
	});
});

describe('pnpm setup:blockscout', () => {
	/** @param {string[]} answers */
	const io = (answers) => {
		/** @type {string[]} */
		const printed = [];
		const next = async () => answers.shift() ?? '';
		return {
			io: { ask: next, askHidden: next, print: (/** @type {string} */ l) => printed.push(l) },
			printed
		};
	};

	test('a key Blockscout takes is stored, and never printed', async () => {
		const keychain = memoryKeychain(null, 'blockscout');
		const { io: ioFake, printed } = io([KEY]);
		assert.equal(await runBlockscoutSetup({ io: ioFake, keychain, check: async () => 'ok' }), true);
		assert.equal(await keychain.read(), KEY);
		assert.ok(printed.some((l) => /Filecoin: answers/.test(l)));
		assert.ok(printed.every((l) => !l.includes(KEY)));
	});

	test('a key Blockscout refuses, or of the wrong form, is not stored', async () => {
		const keychain = memoryKeychain(null, 'blockscout');
		const refused = io([KEY]);
		assert.equal(
			await runBlockscoutSetup({ io: refused.io, keychain, check: async () => 'refused-key' }),
			false
		);
		assert.match(refused.printed.join('\n'), /did not accept/);
		let called = false;
		const odd = io(['not a key!']);
		assert.equal(
			await runBlockscoutSetup({
				io: odd.io,
				keychain,
				check: async () => {
					called = true;
					return 'ok';
				}
			}),
			false
		);
		assert.equal(called, false);
		await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
		assert.equal(isBlockscoutKey(KEY), true);
	});

	test('Enter keeps the stored key, "-" deletes it after a yes', async () => {
		const keychain = memoryKeychain(KEY, 'blockscout');
		assert.equal(await runBlockscoutSetup({ io: io(['']).io, keychain }), true);
		assert.equal(await keychain.read(), KEY);
		assert.equal(await runBlockscoutSetup({ io: io(['-', 'n']).io, keychain }), true);
		assert.equal(await runBlockscoutSetup({ io: io(['-', 'y']).io, keychain }), false);
		await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
	});

	test('the test call: the key in a header, only the outcome comes back', async () => {
		const fake = await startFakeFilecoinPay({
			contract: FILECOIN_PAY.contract,
			events: [],
			funds: {},
			key: KEY
		});
		try {
			const api = `${fake.url}/keyed/v2/api`;
			// The fake answers a block number for nothing it knows: "No logs found" is no number.
			const f = /** @type {typeof fetch} */ (
				async (input, init) => {
					assert.ok(!String(input).includes(KEY));
					const res = await fetch(input, { ...init, redirect: 'follow' });
					return res.ok ? Response.json({ jsonrpc: '2.0', id: 1, result: '0x64' }) : res;
				}
			);
			assert.equal(await testCall(KEY, { fetch: f, api }), 'ok');
			assert.equal(await testCall('proapi_another_key', { fetch: f, api }), 'refused-key');
			assert.equal(
				await testCall(KEY, {
					fetch: async () => {
						throw new Error('offline');
					},
					api
				}),
				'unreachable'
			);
		} finally {
			await fake.close();
		}
	});
});
