// A payment into a known payment contract explains itself. The contract's
// address is public; wallets and amounts are made up.
import { describe, expect, it } from 'vitest';

import { addressBook, payeeName } from '../bank/payee.js';
import { classifyTransaction } from '../matching/classify.js';
import { classificationLine } from '../matching/explain.js';
import { knownContract } from './known-contracts.js';

const FILECOIN_PAY = 'f410feoy6aghqro4yenelcwug52jg527x6tnkxl36cyi';

const deposit = {
	id: 'W1',
	source: 'filecoin',
	movement: 'transfer',
	asset: 'USDFC',
	amountCents: -146,
	counterparty: FILECOIN_PAY,
	counterpartyAddress: FILECOIN_PAY
};

/** @param {Partial<import('../matching/classify.js').ClassifyContext>} [more] */
const ctx = (more = {}) =>
	/** @type {any} */ ({
		rules: [],
		companyNames: [],
		ownIbans: new Set(),
		feeKeys: new Set(),
		learnedVendors: new Map(),
		notTransfers: new Set(),
		...more
	});

describe('a known payment contract', () => {
	it('is known by its address on its chain, and nowhere else', () => {
		expect(knownContract(deposit)).toMatchObject({ name: 'Filecoin Pay', kind: 'payment-account' });
		expect(knownContract({ ...deposit, counterpartyAddress: FILECOIN_PAY.toUpperCase() })).not.toBe(
			null
		);
		expect(knownContract({ ...deposit, source: 'ethereum' })).toBeNull();
		expect(knownContract({ ...deposit, counterpartyAddress: 'f410fotheraddress' })).toBeNull();
		expect(knownContract({ source: 'hibiscus', counterpartyAddress: FILECOIN_PAY })).toBeNull();
	});

	it('names the payment instead of "unbekannte Adresse"', () => {
		expect(payeeName(deposit, addressBook({})).name).toBe('Filecoin Pay');
	});

	it('makes paying in, and taking out, an own transfer – no receipt', () => {
		const c = classifyTransaction(deposit, ctx());
		expect(c).toEqual({
			kind: 'own-transfer',
			account: '1360',
			via: 'payment-contract',
			company: 'Filecoin Pay',
			address: FILECOIN_PAY
		});
		expect(classificationLine(/** @type {any} */ (c), {})).toContain('Filecoin Pay');
		expect(classifyTransaction({ ...deposit, amountCents: 146 }, ctx())?.via).toBe(
			'payment-contract'
		);
	});

	it('gives way to what a person said about the address', () => {
		const said = { kind: 'private', name: 'Mein Test', alias: `addr:filecoin:${FILECOIN_PAY}` };
		expect(classifyTransaction(deposit, ctx({ addressKindOf: () => said }))).toMatchObject({
			kind: 'rule-private'
		});
		// Said to be a vendor's: the payment needs its invoice, as the person decided.
		expect(
			classifyTransaction(deposit, ctx({ addressKindOf: () => ({ ...said, kind: 'vendor' }) }))
		).toBeNull();
	});
});
