// Dust on own wallets, and lookalike addresses (address poisoning). Every
// address and amount is made up.
import { describe, expect, it } from 'vitest';

import { formatTxAmount } from '../bank/format.js';
import { classifyTransaction } from './classify.js';
import { buildMatchingContext } from './context.js';
import { addressBody, isDust, looksAlike } from './dust.js';
import { tx } from './fixtures.js';

const OWN = '0x1111aaaa00000000000000000000000000002222';
const EXCHANGE = '0xabcd000000000000000000000000000000009876';
// Same first and last four characters as EXCHANGE, different in between.
const POISON = '0xabcd555555555555555555555555555555559876';
const STRANGER = '0x7777000000000000000000000000000000003333';

const accounts = [
	{ id: 'W-USDC', source: 'ethereum', asset: 'USDC', walletAddress: OWN, name: 'Wallet USDC' }
];

/** @param {Record<string, any>} t */
const walletTx = (t) =>
	tx({
		accountId: 'W-USDC',
		source: 'ethereum',
		asset: 'USDC',
		movement: 'transfer',
		bookingType: 'Empfangen',
		...t
	});

const realIn = walletTx({
	id: 'real-in',
	amountCents: 4321,
	quantity: '50000000',
	counterpartyAddress: EXCHANGE
});

describe('lookalike addresses', () => {
	it('the part a person reads: after 0x, or after the bech32 prefix', () => {
		expect(addressBody('0xABCDef')).toBe('abcdef');
		expect(addressBody('nym1qqqqpppp')).toBe('qqqqpppp');
	});

	it('same ends, different middle: alike; the same address or other ends: not', () => {
		expect(looksAlike(POISON, EXCHANGE)).toBe(true);
		expect(looksAlike(POISON.toUpperCase().replace('0X', '0x'), EXCHANGE)).toBe(true);
		expect(looksAlike(EXCHANGE, EXCHANGE)).toBe(false);
		expect(looksAlike(STRANGER, EXCHANGE)).toBe(false);
		expect(looksAlike('nym1abcdqqqqqqqqqqwxyz', 'nym1abcdppppppppppwxyz')).toBe(true);
	});
});

describe('dust', () => {
	it('an incoming wallet transfer worth under a cent; not one sent, not a bank booking', () => {
		expect(isDust(walletTx({ amountCents: 0, quantity: '12' }))).toBe(true);
		expect(isDust(walletTx({ amountCents: 0, quantity: '-12' }))).toBe(false);
		expect(isDust(walletTx({ amountCents: 1, quantity: '12000' }))).toBe(false);
		expect(isDust(walletTx({ amountCents: 0, quantity: '12', movement: 'fee' }))).toBe(false);
		expect(isDust(tx({ amountCents: 0 }))).toBe(false);
	});

	it('needs no receipt; from a lookalike of a known address, it names that address', async () => {
		const dust = walletTx({
			id: 'dust',
			amountCents: 0,
			quantity: '12',
			counterpartyAddress: POISON
		});
		const plain = walletTx({
			id: 'plain',
			amountCents: 0,
			quantity: '12',
			counterpartyAddress: STRANGER
		});
		const ctx = await buildMatchingContext({
			accounts,
			transactions: [realIn, dust, plain],
			settings: null
		});
		expect(classifyTransaction(dust, ctx)).toEqual({ kind: 'crypto-dust', lookalike: EXCHANGE });
		expect(classifyTransaction(plain, ctx)).toEqual({ kind: 'crypto-dust' });
		expect(classifyTransaction(realIn, ctx)).toBeNull();
	});

	it('a lookalike of an own wallet counts too; dust from the own wallet is an own transfer', async () => {
		const ownLookalike = '0x1111aaab99999999999999999999999999992222';
		const dust = walletTx({ amountCents: 0, quantity: '5', counterpartyAddress: ownLookalike });
		const ctx = await buildMatchingContext({ accounts, transactions: [dust], settings: null });
		expect(classifyTransaction(dust, ctx)).toEqual({ kind: 'crypto-dust', lookalike: OWN });
	});

	it('a dust sender is no known address: two dust senders alike warn of nothing', async () => {
		const a = walletTx({ amountCents: 0, quantity: '5', counterpartyAddress: POISON });
		const b = walletTx({
			amountCents: 0,
			quantity: '5',
			counterpartyAddress: `0xabcd${'6'.repeat(32)}9876`
		});
		const ctx = await buildMatchingContext({ accounts, transactions: [a, b], settings: null });
		expect(classifyTransaction(a, ctx)).toEqual({ kind: 'crypto-dust' });
	});
});

describe('formatTxAmount', () => {
	it('under a cent is < 0,01 EUR (in) or > -0,01 EUR (out), never 0,00 EUR', () => {
		expect(formatTxAmount({ amountCents: 0, quantity: '12', currency: 'EUR' })).toMatch(
			/^< 0,01\sEUR$/
		);
		expect(formatTxAmount({ amountCents: 0, quantity: '-12', currency: 'EUR' })).toMatch(
			/^> -0,01\sEUR$/
		);
		expect(formatTxAmount({ amountCents: 0, currency: 'EUR' })).toMatch(/^0,00\sEUR$/);
		expect(formatTxAmount({ amountCents: -1234, quantity: '-5', currency: 'EUR' })).toMatch(
			/^-12,34\sEUR$/
		);
	});
});
