// The payment of a purchase of Aleph credits is known by the transaction
// Aleph names for it, and a receipt the books made themselves teaches no
// partner. Made-up addresses, hashes and amounts.
import { describe, expect, it } from 'vitest';

import { classifyTransaction } from './classify.js';
import { buildMatchingContext } from './context.js';
import { classificationLine } from './explain.js';
import {
	addressKindOf,
	forgetSelfReceiptPartners,
	learnAccount,
	learnFromLink,
	nameAddress
} from './partners.js';

const ACCOUNT = '0x' + '1a'.repeat(20);
const PAID_TO = '0x' + '6b'.repeat(20);
const HASH = '0x' + 'c3'.repeat(32);

/** A partners collection in memory. */
function collection() {
	/** @type {Record<string, any>[]} */
	const rows = [];
	let n = 0;
	return {
		rows,
		list: async () => rows.map((r) => ({ ...r })),
		/** @param {Record<string, any>} r */
		put: async (r) => {
			const record = { ...r, id: r.id ?? `p${++n}` };
			const at = rows.findIndex((x) => x.id === record.id);
			if (at >= 0) rows[at] = record;
			else rows.push(record);
			return record;
		}
	};
}

const payment = {
	id: 'W1',
	accountId: 'wallet-a',
	source: 'ethereum',
	movement: 'transfer',
	asset: 'ALEPH',
	bookedOn: '2026-03-04',
	amountCents: -1234,
	txRef: HASH.toUpperCase().replace('0X', '0x'),
	counterpartyAddress: PAID_TO
};

const context = (purchases = [{ address: ACCOUNT, txHash: HASH, credits: 3_000_000 }]) =>
	buildMatchingContext({
		accounts: [],
		transactions: [payment],
		settings: null,
		alephPurchases: purchases
	});

describe('the payment of an Aleph credit purchase', () => {
	it('needs no receipt of its own: Aleph names its transaction', async () => {
		const ctx = await context();
		const c = classifyTransaction(payment, ctx);
		expect(c).toEqual({
			kind: 'prepaid-topup',
			vendor: 'Aleph Cloud',
			via: 'aleph-purchase',
			address: ACCOUNT,
			credits: 3_000_000
		});
		const line = classificationLine(/** @type {any} */ (c), {});
		expect(line).toContain('Aleph-Credits');
		expect(line).toContain('3.000.000');
	});

	it('is known on an exchange’s withdrawal by its on-chain hash', async () => {
		const ctx = await context();
		const withdrawal = {
			id: 'K1',
			source: 'kraken',
			movement: 'transfer',
			asset: 'ALEPH',
			amountCents: -1234,
			txRef: 'REF-1',
			chainTxRef: HASH.slice(2)
		};
		expect(classifyTransaction(withdrawal, ctx)?.via).toBe('aleph-purchase');
	});

	it('leaves the network fee a fee, and other bookings alone', async () => {
		const ctx = await context();
		expect(
			classifyTransaction({ ...payment, id: 'W1:fee', movement: 'fee', amountCents: -7 }, ctx)
		).toMatchObject({ kind: 'bank-fee' });
		// Money that came in pays for nothing.
		expect(classifyTransaction({ ...payment, id: 'W2', amountCents: 1234 }, ctx)).toBeNull();
		expect(
			classifyTransaction({ ...payment, id: 'W3', txRef: '0x' + 'd4'.repeat(32) }, ctx)
		).toBeNull();
		// Nothing read from Aleph: nothing is assumed.
		expect(classifyTransaction(payment, await context([]))).toBeNull();
	});
});

describe('a receipt the books made themselves', () => {
	const selfMade = { id: 'R1', source: 'eigenbeleg', vendor: 'Eigenbeleg' };

	it('teaches no partner: "Eigenbeleg" is nobody', async () => {
		const partners = collection();
		expect(await learnFromLink(/** @type {any} */ (partners), selfMade, payment)).toBeNull();
		expect(
			await learnAccount(/** @type {any} */ (partners), selfMade, payment, {
				account: '4980',
				taxKey: ''
			})
		).toBeNull();
		expect(partners.rows).toEqual([]);
		// A vendor's own receipt still does.
		const learned = await learnFromLink(
			/** @type {any} */ (partners),
			{ id: 'R2', source: 'upload', vendor: 'Wolkenfabrik Hosting GmbH' },
			payment
		);
		expect(learned?.name).toBe('Wolkenfabrik Hosting GmbH');
	});

	it('gives back what it taught before, and keeps what a person said', async () => {
		const partners = collection();
		const alias = `addr:evm:${PAID_TO}`;
		await partners.put({
			name: 'Eigenbeleg',
			aliases: [alias, 'some shop'],
			learnedFrom: 'link',
			account: '4980',
			taxKey: '9'
		});
		await partners.put({
			name: 'Aleph Cloud (Eigenbeleg)',
			aliases: ['other'],
			learnedFrom: 'link'
		});
		await partners.put({ name: 'Wolkenfabrik Hosting GmbH', aliases: ['wolkenfabrik'] });
		expect(addressKindOf(partners.rows, payment)?.name).toBe('Eigenbeleg');

		expect(await forgetSelfReceiptPartners(/** @type {any} */ (partners))).toBe(2);
		expect(addressKindOf(partners.rows, payment)).toBeNull();
		expect(partners.rows[0]).toMatchObject({ name: 'Eigenbeleg', aliases: [] });
		expect(partners.rows[0]).not.toHaveProperty('account');
		expect(partners.rows[2].aliases).toEqual(['wolkenfabrik']);
		expect(await forgetSelfReceiptPartners(/** @type {any} */ (partners))).toBe(0);

		// Said by hand to be private under that name: that stays.
		await nameAddress(/** @type {any} */ (partners), payment, 'Eigenbeleg', 'private');
		expect(await forgetSelfReceiptPartners(/** @type {any} */ (partners))).toBe(0);
		expect(addressKindOf(partners.rows, payment)?.kind).toBe('private');
	});
});
