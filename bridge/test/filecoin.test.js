// A Filecoin wallet read through Filfox (a fake): addresses with checksums,
// a message's movements as entries, its fees as one, all pages, the balance.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	CHAINS,
	createWalletService,
	isFilecoinAddress,
	normalizeFilecoin,
	toFilecoinAddress
} from '../src/chains/index.js';
import { fakeFilecoinAddress, fakeMessageCid, startFakeFilfox } from './support/fake-filfox.js';

const OURS = fakeFilecoinAddress('own wallet');
const KRAKEN = fakeFilecoinAddress('exchange deposit address');
const FRIEND = fakeFilecoinAddress('a customer');
const OUT = fakeMessageCid('withdrawal to the exchange');
const IN = fakeMessageCid('payment received');
const chain = /** @type {import('../src/chains/registry.js').FilecoinChain} */ (CHAINS.filecoin);

const atto = (/** @type {string} */ fil) =>
	(BigInt(Math.round(Number(fil) * 1e6)) * 10n ** 12n).toString();

/** The two messages, as Filfox lists them; plus filler to need three pages. */
function transfers(extra = 0) {
	const list = [
		{
			height: 100,
			timestamp: 1_760_000_000,
			message: IN,
			from: FRIEND,
			to: OURS,
			value: atto('25'),
			type: 'receive'
		},
		{
			height: 200,
			timestamp: 1_760_006_000,
			message: OUT,
			from: OURS,
			to: KRAKEN,
			value: `-${atto('20')}`,
			type: 'send'
		},
		{
			height: 200,
			timestamp: 1_760_006_000,
			message: OUT,
			from: OURS,
			to: 'f02966277',
			value: '-5199919719831',
			type: 'miner-fee'
		},
		{
			height: 200,
			timestamp: 1_760_006_000,
			message: OUT,
			from: OURS,
			to: 'f099',
			value: '-4313038500',
			type: 'burn-fee'
		}
	];
	for (let i = 0; i < extra; i++) {
		list.push({
			height: 300 + i,
			timestamp: 1_760_010_000 + i * 30,
			message: fakeMessageCid(`filler ${i}`),
			from: FRIEND,
			to: OURS,
			value: atto('0.001'),
			type: 'receive'
		});
	}
	return list;
}

/** @type {Awaited<ReturnType<typeof startFakeFilfox>>} */ let filfox;
before(async () => {
	filfox = await startFakeFilfox({
		addresses: { [OURS]: { balance: '4990000000000000000', transfers: transfers(250) } }
	});
});
after(async () => filfox?.close());

test('addresses: f1, f3, f410f by their checksum; f0 as it is; anything else not', () => {
	assert.equal(isFilecoinAddress(OURS), true);
	assert.equal(isFilecoinAddress('f01518369'), true);
	assert.equal(
		isFilecoinAddress(`${OURS.slice(0, -1)}${OURS.endsWith('a') ? 'b' : 'a'}`),
		false,
		'one letter off'
	);
	assert.equal(isFilecoinAddress(OURS.toUpperCase()), false);
	assert.equal(isFilecoinAddress(`t${OURS.slice(1)}`), false, 'testnet');
	assert.equal(isFilecoinAddress('0xabc'), false);
});

test('a message: each send and receive an entry, its two fees one entry; the CID is the hash', () => {
	const entries = normalizeFilecoin(/** @type {any} */ (transfers()), chain);
	assert.deepEqual(
		entries.map((e) => [
			e.hash === OUT ? 'OUT' : 'IN',
			e.type,
			e.amount,
			e.counterparty === KRAKEN ? 'KRAKEN' : e.counterparty === FRIEND ? 'FRIEND' : e.counterparty
		]),
		[
			['IN', 'received', '25', 'FRIEND'],
			['OUT', 'fee', '-0.000005204232758331', ''],
			['OUT', 'sent', '-20', 'KRAKEN']
		]
	);
	assert.equal(entries[2].explorerUrl, `https://filfox.info/en/message/${OUT}`);
	assert.equal(entries[2].asset, 'FIL');
	assert.equal(entries[2].decimals, 18);
	assert.equal(entries[2].date, '2025-10-09');
});

test('the wallet service reads all pages and the balance; a bad address is refused before any request', async () => {
	const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
	const result = await service.sync({
		chain: 'filecoin',
		address: OURS,
		endpoints: { api: filfox.url }
	});
	assert.equal(filfox.state.pages, 3, '254 movements, 100 a page');
	assert.equal(result.transactions, 252);
	assert.equal(result.entries.length, 253);
	assert.deepEqual(result.balances, [{ asset: 'FIL', amount: '4.99', decimals: 18 }]);
	assert.equal(result.addressUrl, `https://filfox.info/en/address/${OURS}`);

	const before = filfox.state.requests;
	await assert.rejects(
		service.sync({ chain: 'filecoin', address: 'f1nichtgueltig', endpoints: { api: filfox.url } }),
		(/** @type {any} */ e) => e.code === 'WALLET_ADDRESS'
	);
	assert.equal(filfox.state.requests, before);
});

test('GET /chains names Filecoin with its explorer, and Filfox as its default API', () => {
	const service = createWalletService();
	const fil = service.chains().find((c) => c.id === 'filecoin');
	assert.deepEqual(
		{ kind: fil?.kind, assets: fil?.assets, native: fil?.nativeSymbol, api: fil?.endpoints.api },
		{ kind: 'filecoin', assets: ['FIL'], native: 'FIL', api: 'https://filfox.info/api/v1' }
	);
});

test('a 0x address is read as its f410f form (pinned; the app pins the same value)', async () => {
	const made = `0x${'ab'.repeat(20)}`;
	const f410 = 'f410fvov2xk5lvov2xk5lvov2xk5lvov2xk5lc6wbxja';
	assert.equal(toFilecoinAddress(made), f410);
	assert.equal(
		toFilecoinAddress(made.toUpperCase().replace('0X', '0x')),
		f410,
		'case does not matter'
	);
	assert.equal(isFilecoinAddress(f410), true);
	assert.equal(toFilecoinAddress(` ${OURS} `), OURS, 'other addresses as they are');
	const fevm = await startFakeFilfox({ addresses: { [f410]: { balance: '0', transfers: [] } } });
	try {
		const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
		const result = await service.sync({
			chain: 'filecoin',
			address: made,
			endpoints: { api: fevm.url }
		});
		assert.equal(result.addressUrl, `https://filfox.info/en/address/${f410}`);
	} finally {
		await fevm.close();
	}
});
