// What every chain reader shares (#264): amounts from units, explorer links,
// endpoint checks, the fetcher's errors and swap detection. Every address,
// hash and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
	addressUrl,
	checkEndpoint,
	isLocalHostname,
	isPrivateAddress,
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

test('an endpoint is on the public internet: no private, local or link-local host, however written', () => {
	for (const host of [
		'127.0.0.1',
		'127.1.2.3',
		'localhost',
		'api.localhost',
		'10.0.0.5',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.20',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'224.0.0.1',
		'[::1]',
		'[::]',
		'[fc00::1]',
		'[fd12:3456::1]',
		'[fe80::1]',
		'[::ffff:10.0.0.5]',
		'[::ffff:7f00:1]',
		'[64:ff9b::10.0.0.5]',
		// Other spellings of 127.0.0.1 and 10.0.0.5, which a URL reads as addresses.
		'2130706433',
		'0x7f.0.0.1',
		'0177.0.0.1',
		'10.5',
		// A machine's bare name, and suffixes kept for local use.
		'nas',
		'printer.local',
		'db.internal',
		'router.lan',
		'box.home.arpa',
		'intranet.corp'
	]) {
		assert.equal(checkEndpoint(`https://${host}/api`), null, host);
		assert.equal(checkEndpoint(`https://${host}:8443`), null, host);
	}
	// The public internet, in a name and in both kinds of address.
	assert.equal(checkEndpoint('https://rpc.example.com/v1'), 'https://rpc.example.com/v1');
	assert.equal(checkEndpoint('https://172.15.0.1'), 'https://172.15.0.1');
	assert.equal(checkEndpoint('https://172.32.0.1'), 'https://172.32.0.1');
	assert.equal(checkEndpoint('https://100.63.0.1'), 'https://100.63.0.1');
	assert.equal(checkEndpoint('https://[2001:db8::1]'), 'https://[2001:db8::1]');
	assert.equal(checkEndpoint('https://internal.example.com'), 'https://internal.example.com');
	// For the tests: this machine, by its two plain names only.
	assert.equal(
		checkEndpoint('https://127.0.0.1:9', { allowLoopback: true }),
		'https://127.0.0.1:9'
	);
	assert.equal(checkEndpoint('http://10.0.0.5:9', { allowLoopback: true }), null);
	assert.equal(checkEndpoint('https://192.168.1.20', { allowLoopback: true }), null);
});

test('an address is told from a public one as a resolver gives it', () => {
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'169.254.0.1',
		'::1',
		'fe80::1%en0',
		'fd00::1',
		'::ffff:192.168.0.1'
	]) {
		assert.equal(isPrivateAddress(address), true, address);
	}
	for (const address of ['93.184.216.34', '2606:2800:220:1::1', '1.1.1.1']) {
		assert.equal(isPrivateAddress(address), false, address);
	}
	assert.equal(isLocalHostname('example.com.'), false);
	assert.equal(isLocalHostname(''), true);
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
