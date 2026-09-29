// Swaps on an EVM wallet (issue #115): a token given to a router and ETH got
// back as an internal transfer; the booked leg becomes a swap that names both
// sides and the router. Made-up addresses, tokens and amounts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEvm } from '../src/chains/evm.js';
import { CHAINS, KNOWN_EVM_CONTRACTS } from '../src/chains/registry.js';

const ME = `0x${'a1'.repeat(20)}`;
const ROUTER = '0x881d40237659c251811cec9c364ef91dc08d300c';
const SPENDER = '0x74de5d4fcbf63e00296fd95d33236b9794016631';
const XYZ = `0x${'5e'.repeat(20)}`;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const hash = (/** @type {string} */ b) => `0x${b.repeat(32)}`;
const base = { blockNumber: '100', timeStamp: '1784000000', transactionIndex: '3' };

/** A swap of 30 000 XYZ for 0.143 ETH through the MetaMask router. */
function swapLists(h = hash('ab')) {
	return {
		normal: [
			{
				...base,
				hash: h,
				from: ME,
				to: ROUTER,
				value: '0',
				gasUsed: '200000',
				gasPrice: '1000000000',
				isError: '0',
				txreceipt_status: '1'
			}
		],
		internal: [
			{
				...base,
				hash: h,
				from: SPENDER,
				to: ME,
				value: '143000000000000000',
				isError: '0',
				index: '4'
			}
		],
		tokens: [
			{
				...base,
				hash: h,
				from: ME,
				to: SPENDER,
				value: '30000000000000000000000',
				contractAddress: XYZ,
				tokenSymbol: 'XYZ',
				tokenDecimal: '18',
				logIndex: '1'
			}
		]
	};
}

test('a token given and ETH got back: the ETH leg is a swap naming both sides and the router', () => {
	const { entries, unknownTokens } = normalizeEvm(swapLists(), {
		address: ME,
		chain: CHAINS.ethereum
	});
	// XYZ is not in the list, but the wallet sent it: booked, by its contract (#115).
	assert.deepEqual(unknownTokens, []);
	const gaveLeg = entries.find((e) => e.type === 'sent');
	assert.equal(gaveLeg?.asset, 'XYZ');
	assert.equal(gaveLeg?.contract, XYZ);
	assert.equal(gaveLeg?.listed, false);
	const got = entries.find((e) => e.type === 'received');
	assert.ok(got);
	assert.equal(got.kind, 'swap');
	assert.equal(got.counterpartyLabel, KNOWN_EVM_CONTRACTS[SPENDER]);
	assert.deepEqual(got.swap, {
		gave: [{ asset: 'XYZ', amount: '30000', listed: false }],
		got: [{ asset: 'ETH', amount: '0.143', listed: true }],
		via: 'MetaMask Swap (Router)',
		// 200 000 gas at 1 gwei
		fee: { asset: 'ETH', amount: '0.0002' }
	});
	// The gas stays its own fee entry, and names the swap it paid for.
	assert.equal(entries.find((e) => e.type === 'fee')?.swap, got.swap);
	// The gas stays a fee; both legs are swaps.
	assert.deepEqual(entries.map((e) => e.kind).sort(), ['fee', 'swap', 'swap']);
});

test('two listed assets swapped: both legs are swaps', () => {
	const h = hash('cd');
	const { entries } = normalizeEvm(
		{
			normal: [
				{
					...base,
					hash: h,
					from: ME,
					to: ROUTER,
					value: '100000000000000000',
					gasUsed: '1',
					gasPrice: '1',
					isError: '0',
					txreceipt_status: '1'
				}
			],
			internal: [],
			tokens: [
				{
					...base,
					hash: h,
					from: SPENDER,
					to: ME,
					value: '250000000',
					contractAddress: USDC,
					tokenSymbol: 'USDC',
					tokenDecimal: '6',
					logIndex: '7'
				}
			]
		},
		{ address: ME, chain: CHAINS.ethereum }
	);
	const legs = entries.filter((e) => e.kind === 'swap');
	assert.equal(legs.length, 2);
	assert.deepEqual(legs[0].swap?.gave, [{ asset: 'ETH', amount: '0.1', listed: true }]);
	assert.deepEqual(legs[0].swap?.got, [{ asset: 'USDC', amount: '250', listed: true }]);
});

test('no swap: one side only, the same asset both ways, or a plain transfer', () => {
	const h = hash('ef');
	const sendOnly = normalizeEvm(
		{
			normal: [
				{
					...base,
					hash: h,
					from: ME,
					to: `0x${'77'.repeat(20)}`,
					value: '5',
					gasUsed: '1',
					gasPrice: '1',
					isError: '0',
					txreceipt_status: '1'
				}
			],
			internal: [],
			tokens: []
		},
		{ address: ME, chain: CHAINS.ethereum }
	);
	assert.ok(sendOnly.entries.every((e) => e.kind !== 'swap'));
	// An airdrop of an unknown token alone: nothing booked, no swap.
	const airdrop = normalizeEvm(
		{
			normal: [],
			internal: [],
			tokens: [
				{
					...base,
					hash: hash('12'),
					from: `0x${'99'.repeat(20)}`,
					to: ME,
					value: '1',
					contractAddress: XYZ,
					tokenSymbol: 'XYZ',
					tokenDecimal: '18',
					logIndex: '0'
				}
			]
		},
		{ address: ME, chain: CHAINS.ethereum }
	);
	assert.deepEqual(airdrop.entries, []);
});

test('a symbol the token claims is cut to letters and digits', () => {
	const lists = swapLists(hash('34'));
	lists.tokens[0].tokenSymbol = 'XYZ<script>visit site.com';
	const { entries } = normalizeEvm(lists, { address: ME, chain: CHAINS.ethereum });
	const asset = entries.find((e) => e.kind === 'swap')?.swap?.gave[0].asset ?? '';
	assert.match(asset, /^[\p{L}\p{N}._-]{1,12}$/u);
});

test('an unlisted token only received (an airdrop) is not booked; a lookalike symbol never', () => {
	const drop = normalizeEvm(
		{
			normal: [],
			internal: [],
			tokens: [
				{
					...base,
					hash: hash('56'),
					from: `0x${'99'.repeat(20)}`,
					to: ME,
					value: '5',
					contractAddress: XYZ,
					tokenSymbol: 'XYZ',
					tokenDecimal: '18',
					logIndex: '0'
				}
			]
		},
		{ address: ME, chain: CHAINS.ethereum }
	);
	assert.deepEqual(drop.entries, []);
	assert.deepEqual(drop.unknownTokens, [XYZ]);
	const fakeUsdc = `0x${'fa'.repeat(20)}`;
	const fake = normalizeEvm(
		{
			normal: [],
			internal: [],
			tokens: [
				{
					...base,
					hash: hash('78'),
					from: ME,
					to: `0x${'99'.repeat(20)}`,
					value: '5',
					contractAddress: fakeUsdc,
					tokenSymbol: 'USDC',
					tokenDecimal: '6',
					logIndex: '0'
				}
			]
		},
		{ address: ME, chain: CHAINS.ethereum }
	);
	assert.deepEqual(fake.entries, []);
});

test('a token that leaves in a transaction this wallet did not send: moved by someone else, and by whom (#162)', () => {
	const PROJECT = `0x${'c3'.repeat(20)}`;
	const ZERO = `0x${'0'.repeat(40)}`;
	const burn = hash('cd');
	const lists = {
		normal: [],
		internal: [],
		tokens: [
			{
				...base,
				hash: burn,
				from: ME,
				to: ZERO,
				value: '1000000000000000000000000',
				contractAddress: XYZ,
				tokenSymbol: 'XYZ',
				tokenDecimal: '18',
				logIndex: '7'
			}
		],
		senders: { [burn]: PROJECT }
	};
	const { entries } = normalizeEvm(lists, { address: ME, chain: CHAINS.ethereum });
	assert.equal(entries.length, 1);
	assert.equal(entries[0].type, 'sent');
	assert.equal(entries[0].byOther, true);
	assert.equal(entries[0].txFrom, PROJECT);
	// Sent by the wallet itself: neither.
	const own = swapLists();
	const mine = normalizeEvm(own, { address: ME, chain: CHAINS.ethereum }).entries.find(
		(e) => e.asset === 'XYZ'
	);
	assert.equal(mine?.byOther, undefined);
	assert.equal(mine?.txFrom, undefined);
});
