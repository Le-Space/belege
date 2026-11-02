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
		{ kind: 'filecoin', assets: ['FIL', 'USDFC'], native: 'FIL', api: 'https://filfox.info/api/v1' }
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

// FEVM tokens and swaps (issue #301): USDFC listed by its contract, a swap
// through SushiSwap's router in either direction, a lookalike "USDFC" from
// another contract never booked. Every address, CID and amount is made up;
// the contracts are the listed ones.
const USDFC = toFilecoinAddress('0x80b98d3aa09ffff255c3ba4a241111ff1262f045');
const SUSHI = toFilecoinAddress('0xac4c6e212a361c968f1725b4d055b47e63f80b75');
const WALLET = toFilecoinAddress(`0x${'12'.repeat(20)}`);
const POOL = toFilecoinAddress(`0x${'34'.repeat(20)}`);
const FAKE_TOKEN = toFilecoinAddress(`0x${'56'.repeat(20)}`);
const BUY = fakeMessageCid('FIL for USDFC');
const SELL = fakeMessageCid('USDFC for FIL');
const GOT = fakeMessageCid('USDFC received');
const LOOKALIKE = fakeMessageCid('a lookalike token');
const wei = (/** @type {string} */ n) =>
	(BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n).toString();

/** @param {string} message @param {number} height */
const fees = (message, height) => [
	{
		height,
		timestamp: 1_760_000_000 + height,
		message,
		from: WALLET,
		to: 'f02966277',
		value: '-1000',
		type: 'miner-fee'
	},
	{
		height,
		timestamp: 1_760_000_000 + height,
		message,
		from: WALLET,
		to: 'f099',
		value: '-500',
		type: 'burn-fee'
	}
];
/** @param {Record<string, any>} t */
const token = (t) => ({ timestamp: 1_760_000_000 + t.height, decimals: 18, ...t });

test('FEVM: USDFC by its contract, swaps through SushiSwap both ways, a lookalike left out', async () => {
	const fil = await startFakeFilfox({
		addresses: {
			[WALLET]: {
				balance: wei('90'),
				transfers: [
					{
						height: 10,
						timestamp: 1_760_000_010,
						message: BUY,
						from: WALLET,
						to: SUSHI,
						value: `-${wei('10')}`,
						type: 'send'
					},
					...fees(BUY, 10),
					{
						height: 20,
						timestamp: 1_760_000_020,
						message: SELL,
						from: POOL,
						to: WALLET,
						value: wei('4.8'),
						type: 'receive'
					},
					...fees(SELL, 20)
				],
				tokenTransfers: [
					token({
						height: 10,
						message: BUY,
						from: POOL,
						to: WALLET,
						token: USDFC,
						value: wei('10.4211'),
						symbol: 'USDFC'
					}),
					token({
						height: 20,
						message: SELL,
						from: WALLET,
						to: POOL,
						token: USDFC,
						value: wei('5'),
						symbol: 'USDFC'
					}),
					token({
						height: 30,
						message: GOT,
						from: POOL,
						to: WALLET,
						token: USDFC,
						value: wei('1'),
						symbol: 'USDFC'
					}),
					token({
						height: 40,
						message: LOOKALIKE,
						from: POOL,
						to: WALLET,
						token: FAKE_TOKEN,
						value: wei('1000'),
						symbol: 'USDFC'
					})
				]
			}
		},
		messages: { [BUY]: { to: SUSHI }, [SELL]: { to: SUSHI } }
	});
	try {
		const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
		const result = await service.sync({
			chain: 'filecoin',
			address: WALLET,
			endpoints: { api: fil.url }
		});
		const of = (/** @type {string} */ cid) => result.entries.filter((e) => e.hash === cid);

		// FIL → USDFC: both legs a swap through SushiSwap, the fee apart and naming it.
		const buy = of(BUY);
		assert.deepEqual(buy.map((e) => [e.kind, e.type, e.asset, e.amount]).sort(), [
			['fee', 'fee', 'FIL', '-0.0000000000000015'],
			['swap', 'received', 'USDFC', '10.4211'],
			['swap', 'sent', 'FIL', '-10']
		]);
		const swap = /** @type {any} */ (buy.find((e) => e.asset === 'USDFC')).swap;
		assert.equal(swap.via, 'SushiSwap');
		assert.deepEqual(swap.gave, [{ asset: 'FIL', amount: '10', listed: true }]);
		assert.deepEqual(swap.got, [{ asset: 'USDFC', amount: '10.4211', listed: true }]);
		assert.ok(/** @type {any} */ (buy.find((e) => e.type === 'fee')).swap);
		assert.equal(buy.filter((e) => e.kind === 'swap').length, 2);

		// USDFC → FIL: the FIL comes back in the same message.
		const sell = of(SELL).filter((e) => e.kind === 'swap');
		assert.deepEqual(sell.map((e) => [e.asset, e.amount]).sort(), [
			['FIL', '4.8'],
			['USDFC', '-5']
		]);
		assert.equal(/** @type {any} */ (sell[0]).swap.via, 'SushiSwap');

		// A plain receipt stays a transfer; the lookalike is not booked, only counted.
		assert.deepEqual(
			of(GOT).map((e) => [e.kind, e.asset, e.amount]),
			[['transfer', 'USDFC', '1']]
		);
		assert.equal(of(LOOKALIKE).length, 0);
		assert.equal(result.unknownAssets, 1);

		// The USDFC balance is the sum of its history: 10.4211 − 5 + 1.
		assert.deepEqual(result.balances, [
			{ asset: 'FIL', amount: '90', decimals: 18 },
			{ asset: 'USDFC', amount: '6.4211', decimals: 18 }
		]);
		// Only the two swaps' messages were asked for their receiver.
		assert.equal(fil.state.messages, 2);
		assert.equal(fil.state.tokenPages, 1);
	} finally {
		await fil.close();
	}
});

test('an address without token transfers is not asked for them', async () => {
	const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
	const before = filfox.state.tokenPages;
	await service.sync({ chain: 'filecoin', address: OURS, endpoints: { api: filfox.url } });
	assert.equal(filfox.state.tokenPages, before);
});
