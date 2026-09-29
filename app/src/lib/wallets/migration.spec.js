// Token migrations and bookings without a rate (issue #162). Made-up addresses, tokens and amounts.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { importTransactions } from '../bank/import.js';
import { describeWalletEntry, walletTransactions } from './wallet-sync.js';
import { buildMatchingContext } from '../matching/context.js';
import { classifyTransaction } from '../matching/classify.js';
import { classificationLine } from '../matching/explain.js';
import { migrationCandidates } from '../matching/view.js';
import { isDust } from '../matching/dust.js';
import { setManualRate } from '../booking/actions.js';

const ME = `0x${'a1'.repeat(20)}`;
const PROJECT = `0x${'c3'.repeat(20)}`;
const ZERO = `0x${'0'.repeat(40)}`;
const OLD = `0x${'01'.repeat(20)}`;
const NEW = `0x${'02'.repeat(20)}`;

/** @param {Record<string, any>} over */
const entry = (over) => ({
	hash: `0x${'ab'.repeat(32)}`,
	height: 100,
	time: '2026-05-02T10:41:47Z',
	date: '2026-05-02',
	kind: 'transfer',
	decimals: 18,
	counterpartyLabel: '',
	memo: '',
	success: true,
	explorerUrl: '',
	listed: false,
	...over
});
const burn = entry({
	id: 'burn',
	type: 'sent',
	asset: 'OLD',
	amount: '-1000000',
	counterparty: ZERO,
	contract: OLD,
	byOther: true,
	txFrom: PROJECT
});
const arrival = entry({
	id: 'arrival',
	hash: `0x${'cd'.repeat(32)}`,
	height: 200,
	time: '2026-07-02T09:00:00Z',
	date: '2026-07-02',
	type: 'received',
	asset: 'NEW',
	amount: '140',
	counterparty: PROJECT,
	contract: NEW
});
/** OLD is priced (0.00015 EUR), NEW is not. */
const rates = async (/** @type {string} */ asset, /** @type {string} */ date) => {
	if (asset !== 'OLD') throw new Error(`no rate found for ${asset} on ${date}`);
	return {
		asset,
		date,
		currency: /** @type {const} */ ('EUR'),
		rate: '0.00015',
		usdRate: null,
		source: /** @type {const} */ ('dex'),
		at: `${date}T00:00:00Z`
	};
};

describe('a burn by the project, and its replacement', () => {
	it('named for what it is; the replacement is worth what was burned', async () => {
		expect(describeWalletEntry(/** @type {any} */ (burn)).label).toBe('Vom Projekt verbrannt');
		const { byAsset, unpriced } = await walletTransactions(
			/** @type {any[]} */ ([burn, arrival]),
			rates
		);
		expect(unpriced).toEqual([]);
		const b = byAsset.get('OLD')?.[0];
		const a = byAsset.get('NEW')?.[0];
		expect(b?.amountCents).toBe(-15000);
		expect(b?.movedByOther).toEqual({ by: PROJECT });
		expect(a?.amountCents).toBe(15000);
		expect(a?.crypto?.valuation).toMatchObject({ source: 'migration', ref: burn.hash });
	});

	it('from someone else, or too late: no migration rate – kept with "Kurs fehlt" instead', async () => {
		for (const changed of [
			{ counterparty: `0x${'dd'.repeat(20)}` },
			{ date: '2027-02-01', time: '2027-02-01T00:00:00Z' }
		]) {
			const other = { ...arrival, ...changed };
			const { byAsset, unpriced } = await walletTransactions(
				/** @type {any[]} */ ([burn, other]),
				rates
			);
			const a = byAsset.get('NEW')?.[0];
			expect(a?.amountCents, JSON.stringify(changed)).toBe(0);
			expect(a?.rateMissing?.reason).toContain('no rate found for NEW');
			expect(a?.crypto?.quantity).toBe('140000000000000000000');
			expect(unpriced.map((u) => u.asset)).toEqual(['NEW']);
		}
	});
});

describe('booking a burn and linking its replacement', () => {
	const accounts = [
		{ id: 'acc-old', source: 'ethereum', name: 'Wallet OLD', walletAddress: ME, asset: 'OLD' },
		{ id: 'acc-new', source: 'ethereum', name: 'Wallet NEW', walletAddress: ME, asset: 'NEW' }
	];
	const b = {
		id: 'b',
		accountId: 'acc-old',
		source: 'ethereum',
		movement: 'transfer',
		bookedOn: '2026-05-02',
		amountCents: -15000,
		currency: 'EUR',
		asset: 'OLD',
		quantity: '-1000000000000000000000000',
		decimals: 18,
		counterpartyAddress: ZERO,
		movedByOther: { by: PROJECT }
	};
	const a = {
		id: 'a',
		accountId: 'acc-new',
		source: 'ethereum',
		movement: 'transfer',
		bookedOn: '2026-07-02',
		amountCents: 0,
		currency: 'EUR',
		asset: 'NEW',
		quantity: '140000000000000000000',
		decimals: 18,
		counterpartyAddress: PROJECT,
		rateMissing: { reason: 'x' }
	};

	it('the burn needs no receipt; its replacement is offered; linked, both are a migration', async () => {
		let ctx = await buildMatchingContext({ accounts, transactions: [b, a], settings: null });
		expect(classifyTransaction(b, ctx)).toEqual({ kind: 'token-burn' });
		expect(classificationLine(/** @type {any} */ ({ kind: 'token-burn' }), { accounts })).toContain(
			'Vom Projekt verbrannt'
		);
		expect(migrationCandidates(b, [b, a], accounts).map((t) => t.id)).toEqual(['a']);
		// A burn sent by the wallet itself stays a payment to a foreign address.
		expect(classifyTransaction({ ...b, movedByOther: undefined }, ctx)?.kind).not.toBe(
			'token-burn'
		);
		ctx = await buildMatchingContext({
			accounts,
			transactions: [b, a],
			settings: { migrations: ['a|b'] }
		});
		expect(classifyTransaction(a, ctx)).toMatchObject({
			kind: 'token-migration',
			counterBookingId: 'b'
		});
		expect(classifyTransaction(b, ctx)).toMatchObject({
			kind: 'token-migration',
			counterBookingId: 'a'
		});
	});

	it('without a rate it is no dust', () => {
		expect(isDust(a)).toBe(false);
		expect(isDust({ ...a, rateMissing: null })).toBe(true);
	});
});

describe('a rate by hand, and a later sync', () => {
	/** @type {any} */
	let store;
	beforeEach(() => {
		store = {
			transactions: memoryCollection(/** @type {any} */ ('transactions')).collection,
			events: memoryCollection(/** @type {any} */ ('events')).collection,
			accounts: memoryCollection(/** @type {any} */ ('accounts')).collection
		};
	});
	/** @returns {import('../bank/import.js').IncomingTransaction} */
	const incoming = (/** @type {Record<string, any>} */ over = {}) => ({
		sourceId: 'arrival',
		date: '2026-07-02',
		amountCents: 0,
		currency: 'EUR',
		counterpartyName: PROJECT,
		purpose: 'Empfangen',
		movement: /** @type {const} */ ('transfer'),
		txRef: `0x${'cd'.repeat(32)}`,
		rateMissing: { reason: 'no rate found for NEW' },
		crypto: { asset: 'NEW', quantity: '140000000000000000000', decimals: 18, valuation: null },
		...over
	});

	it('the rate by hand sets the amount; a sync without a rate or with another leaves it', async () => {
		const account = { id: 'acc-new', source: 'ethereum', fingerprintAccount: 'eth:new' };
		await importTransactions({
			transactions: store.transactions,
			account,
			incoming: [incoming()],
			events: store.events
		});
		const [stored] = await store.transactions.list();
		expect(stored.rateMissing).toEqual({ reason: 'no rate found for NEW' });
		await expect(setManualRate(store, stored.id, 'abc')).rejects.toThrow('Zahl ab 0');
		await expect(setManualRate(store, stored.id, '-1')).rejects.toThrow('Zahl ab 0');
		await setManualRate(store, stored.id, '1,5');
		const manual = await store.transactions.get(stored.id);
		expect(manual).toMatchObject({
			amountCents: 21000,
			rateMissing: null,
			valuation: { source: 'manual', rate: '1.5' }
		});
		await importTransactions({
			transactions: store.transactions,
			account,
			incoming: [incoming()],
			events: store.events
		});
		await importTransactions({
			transactions: store.transactions,
			account,
			incoming: [
				incoming({
					amountCents: 3000,
					rateMissing: undefined,
					crypto: {
						asset: 'NEW',
						quantity: '140000000000000000000',
						decimals: 18,
						valuation: { rate: '0.2', currency: 'EUR', source: 'dex', at: 'x' }
					}
				})
			],
			events: store.events
		});
		expect(await store.transactions.get(stored.id)).toMatchObject({
			amountCents: 21000,
			valuation: { source: 'manual' }
		});
	});
});

describe('a worthless token', () => {
	it('takes a rate of 0 by hand: the amount is 0, and the rate is no longer missing', async () => {
		const store = {
			transactions: memoryCollection(/** @type {any} */ ('transactions')).collection,
			events: memoryCollection(/** @type {any} */ ('events')).collection
		};
		const tx = await store.transactions.put({
			amountCents: 0,
			quantity: '-30000000000000000000000',
			decimals: 18,
			rateMissing: { reason: 'no rate found for OLD' }
		});
		await setManualRate(store, tx.id, '0');
		expect(await store.transactions.get(tx.id)).toMatchObject({
			amountCents: 0,
			rateMissing: null,
			valuation: { rate: '0', source: 'manual' }
		});
	});
});
