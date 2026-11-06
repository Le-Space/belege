// What every chain reader shares (#264): amounts from units, explorer links,
// endpoint checks, the fetcher's errors and swap detection. Every address,
// hash and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
	addressUrl,
	checkEndpoint,
	createJsonFetcher,
	hostOf,
	markSwaps,
	txUrl,
	unitsToDecimal,
	WalletError
} from '../src/index.js';

test('units → a signed decimal, trailing zeros dropped', () => {
	assert.equal(unitsToDecimal(1500000n, 6), '1.5');
	assert.equal(unitsToDecimal(-25n, 6), '-0.000025');
	assert.equal(unitsToDecimal(0n, 18), '0');
	assert.equal(unitsToDecimal(10n ** 18n, 18), '1');
	assert.equal(unitsToDecimal(7n, 0), '7');
});

test('explorer links fill the templates, encoded', () => {
	const explorer = {
		name: 'Example',
		tx: 'https://explorer.example.com/tx/{tx}',
		address: 'https://explorer.example.com/a/{address}'
	};
	assert.equal(txUrl(explorer, 'ab/cd'), 'https://explorer.example.com/tx/ab%2Fcd');
	assert.equal(addressUrl(explorer, 'f1xyz'), 'https://explorer.example.com/a/f1xyz');
});

test('an endpoint must be https without user, query or fragment; loopback only when allowed', () => {
	assert.equal(checkEndpoint('https://rpc.example.com/'), 'https://rpc.example.com');
	assert.equal(checkEndpoint('http://rpc.example.com'), null);
	assert.equal(checkEndpoint('https://user@rpc.example.com'), null);
	assert.equal(checkEndpoint('https://rpc.example.com/?a=1'), null);
	assert.equal(checkEndpoint('http://127.0.0.1:9/api'), null);
	assert.equal(
		checkEndpoint('http://127.0.0.1:9/api', { allowLoopback: true }),
		'http://127.0.0.1:9/api'
	);
	assert.equal(hostOf('https://rpc.example.com/path?address=f1xyz'), 'rpc.example.com');
	assert.equal(hostOf('not a url'), '?');
});

test('the fetcher answers JSON, and a refusal is a WalletError naming the host only', async () => {
	const server = http.createServer((req, res) => {
		res.writeHead(req.url === '/ok' ? 200 : 404, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ path: req.url }));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	try {
		const get = createJsonFetcher({ fetch, sleep: async () => {} });
		assert.deepEqual(await get(`http://127.0.0.1:${port}/ok`), { path: '/ok' });
		await assert.rejects(get(`http://127.0.0.1:${port}/secret-address`), (e) => {
			assert.ok(e instanceof WalletError);
			assert.equal(e.message.includes('secret-address'), false);
			return true;
		});
	} finally {
		await new Promise((resolve) => server.close(() => resolve(undefined)));
	}
});

test('a transaction that gives one asset and gets another is a swap; its gas is named in it', () => {
	const base = { height: 1, time: '', date: '', counterparty: '', counterpartyLabel: '', memo: '' };
	const entries = /** @type {any[]} */ ([
		{
			...base,
			id: 'h1:a',
			hash: 'h1',
			type: 'sent',
			kind: 'transfer',
			asset: 'ETH',
			amount: '-1',
			order: '1'
		},
		{
			...base,
			id: 'h1:b',
			hash: 'h1',
			type: 'received',
			kind: 'transfer',
			asset: 'USDC',
			amount: '2000',
			order: '2'
		},
		{
			...base,
			id: 'h1:fee',
			hash: 'h1',
			type: 'fee',
			kind: 'fee',
			asset: 'ETH',
			amount: '-0.01',
			order: '3'
		},
		{
			...base,
			id: 'h2:a',
			hash: 'h2',
			type: 'received',
			kind: 'transfer',
			asset: 'ETH',
			amount: '1',
			order: '4'
		}
	]);
	markSwaps(entries, [], (hash) => (hash === 'h1' ? 'Example Router' : ''));
	const [gave, got, gas, plain] = entries;
	assert.equal(gave.kind, 'swap');
	assert.equal(got.kind, 'swap');
	assert.deepEqual(gave.swap, {
		gave: [{ asset: 'ETH', amount: '1', listed: true }],
		got: [{ asset: 'USDC', amount: '2000', listed: true }],
		via: 'Example Router',
		fee: { asset: 'ETH', amount: '0.01' }
	});
	assert.equal(gas.kind, 'fee', 'the gas stays a fee of its own');
	assert.equal(gas.swap, gave.swap);
	assert.equal(plain.kind, 'transfer', 'one side only is no swap');
});
