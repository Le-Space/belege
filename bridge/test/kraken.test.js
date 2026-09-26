// The Kraken client against a fake Kraken: signature, paging, rate limit,
// asset codes. Nothing goes to the network.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createKrakenClient, KrakenError, parseAsset } from '../src/kraken.js';
import {
	FAKE_ASSETS,
	FAKE_KRAKEN_KEY,
	FAKE_KRAKEN_SECRET,
	startFakeKraken
} from './support/fake-kraken.js';

const credentials = async () => ({ key: FAKE_KRAKEN_KEY, secret: FAKE_KRAKEN_SECRET });

describe('asset codes', () => {
	test('become a symbol and a wallet', () => {
		assert.deepEqual(parseAsset('XXBT', FAKE_ASSETS), {
			symbol: 'BTC',
			wallet: 'spot',
			decimals: 10
		});
		assert.deepEqual(parseAsset('ZEUR', FAKE_ASSETS), {
			symbol: 'EUR',
			wallet: 'spot',
			decimals: 4
		});
		assert.deepEqual(parseAsset('AKT.S', FAKE_ASSETS), {
			symbol: 'AKT',
			wallet: 'earn',
			decimals: 8
		});
		assert.deepEqual(parseAsset('XBT.M', FAKE_ASSETS), {
			symbol: 'BTC',
			wallet: 'earn',
			decimals: 10
		});
		assert.equal(parseAsset('ETH2.S', {}).symbol, 'ETH');
		assert.equal(parseAsset('ETH2', {}).wallet, 'earn');
		assert.equal(parseAsset('ZUSD', {}).symbol, 'USD');
		assert.equal(parseAsset('NYM', {}).symbol, 'NYM');
	});
});

describe('Kraken client', () => {
	/** @type {Awaited<ReturnType<typeof startFakeKraken>>} */ let kraken;
	before(async () => {
		kraken = await startFakeKraken();
	});
	after(() => kraken.close());

	const client = (/** @type {Partial<Parameters<typeof createKrakenClient>[0]>} */ over = {}) =>
		createKrakenClient({
			getCredentials: credentials,
			baseUrl: kraken.url,
			sleep: async () => {},
			...over
		});

	test('balances: every non-zero one, normalised', async () => {
		const balances = await client().balances();
		assert.deepEqual(balances.map((b) => `${b.asset}/${b.wallet}=${b.amount}`).sort(), [
			'AKT/earn=6.17283900',
			'BTC/earn=0.0010000000',
			'BTC/spot=0.0070000000',
			'ETH/spot=0.0499000000',
			'EUR/spot=98.3500'
		]);
	});

	test('ledgers: every page, by ofs, oldest first, only from the start day', async () => {
		kraken.calls.length = 0;
		const entries = await client().ledgers('2026-08-01');
		const pages = kraken.calls.filter((c) => c.method === 'Ledgers');
		assert.ok(pages.length >= 2, 'more than one page');
		assert.deepEqual(
			pages.map((p) => p.params.ofs),
			pages.map((_, i) => String(i * 50))
		);
		assert.equal(entries.length, 8 + 50); // the September entries and 50 daily rewards
		const times = entries.map((e) => e.time);
		assert.deepEqual(times, [...times].sort());
		assert.ok(entries.every((e) => e.date >= '2026-08-01'));
		assert.equal((await client().ledgers('2026-09-06')).length, 1 + 15); // withdrawal, rewards 6–20 Sept

		const trade = entries.filter((e) => e.refid === 'R-TR1');
		assert.deepEqual(trade.map((e) => [e.asset, e.wallet, e.amount, e.fee, e.decimals]).sort(), [
			['BTC', 'spot', '0.0100000000', '0.0000000000', 10],
			['EUR', 'spot', '-600.0000', '1.5600', 4]
		]);
		const earnIn = entries.find((e) => e.id === 'L-EARN-IN');
		assert.equal(earnIn?.asset, 'BTC');
		assert.equal(earnIn?.wallet, 'earn');
		assert.equal(earnIn?.date, '2026-09-05');
	});

	test('waits and retries when Kraken says the rate limit is exceeded', async () => {
		const limited = await startFakeKraken({ rateLimitedCalls: 2 });
		/** @type {number[]} */ const waited = [];
		try {
			const balances = await createKrakenClient({
				getCredentials: credentials,
				baseUrl: limited.url,
				sleep: async (ms) => {
					waited.push(ms);
				}
			}).balances();
			assert.ok(balances.length > 0);
			assert.deepEqual(waited, [5000, 10000]);
		} finally {
			await limited.close();
		}
	});

	test('a wrong key is an auth error that says what to do', async () => {
		await assert.rejects(
			client({
				getCredentials: async () => ({ key: 'wrong', secret: FAKE_KRAKEN_SECRET })
			}).balances(),
			(e) => e instanceof KrakenError && e.code === 'KRAKEN_AUTH' && /setup:kraken/.test(e.message)
		);
	});

	test('nonces grow even within one millisecond', async () => {
		const fresh = await startFakeKraken();
		try {
			const c = createKrakenClient({
				getCredentials: credentials,
				baseUrl: fresh.url,
				now: () => 1_790_000_000_000
			});
			await c.balances();
			await c.balances(); // the fake refuses a nonce that does not grow
		} finally {
			await fresh.close();
		}
	});
});
