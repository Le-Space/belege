import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';

import {
	balancesOf,
	buildStatement,
	lastDay,
	monthStatements,
	statementNumber
} from './statement.js';
import { statementPdf, winAnsi } from './statement-pdf.js';

/** A made-up exchange account holding one crypto asset. */
const BTC = {
	id: 'A-BTC',
	name: 'Kraken BTC',
	source: 'kraken',
	ibanLast4: '',
	asset: 'BTC',
	decimals: 10,
	ledgerAccount: '1340',
	balance: '0.0070000000',
	balanceOn: '2026-10-05'
};

/** @param {string} id @param {string} bookedOn @param {number} amountCents @param {string} quantity @param {Record<string, any>} [over] */
const tx = (id, bookedOn, amountCents, quantity, over = {}) => ({
	id,
	accountId: 'A-BTC',
	bookedOn,
	amountCents,
	currency: 'EUR',
	counterparty: 'Kraken',
	purpose: 'Handel · Ref. R-1',
	asset: 'BTC',
	quantity,
	decimals: 10,
	valuation: { rate: '60000', currency: 'EUR', source: 'trade', at: `${bookedOn}T10:00:00Z` },
	...over
});

const TXS = [
	tx('T0', '2026-08-30', 30000, '50000000'), // before: +0.005
	tx('T1', '2026-09-02', 60000, '100000000'), // +0.01
	tx('T2', '2026-09-03', -12000, '-20000000', {
		purpose: 'Handel · Ref. R-2',
		valuation: { rate: '60000', currency: 'EUR', source: 'kraken', at: '2026-09-03T00:00:00Z' }
	}), // −0.002
	tx('T3', '2026-09-05', -6000, '-10000000', { purpose: 'Umbuchung Spot/Earn · Ref. R-3' }), // −0.001
	tx('T4', '2026-10-02', -12000, '-20000000') // after: −0.002
];

describe('statement', () => {
	it('numbers statements by ledger account, else by position', () => {
		expect(statementNumber('2026-09', BTC, 0)).toBe('KA-2026-09-1340');
		expect(statementNumber('2026-09', { ...BTC, ledgerAccount: '' }, 2)).toBe('KA-2026-09-3');
		expect(lastDay('2026-02')).toBe('2026-02-28');
		expect(lastDay('2028-02')).toBe('2028-02-29');
	});

	it('lists the month’s bookings with quantities, and totals in euros and in the asset', () => {
		const s = buildStatement({
			month: '2026-09',
			account: BTC,
			index: 0,
			transactions: TXS,
			classifications: { T3: { kind: 'own-transfer' } },
			receiptNumbers: new Map([['T1', '2026-09-004']])
		});
		expect(s.lines.map((l) => [l.tx.id, l.quantity, l.receipt])).toEqual([
			['T1', '100000000', '2026-09-004'],
			['T2', '-20000000', '—'],
			['T3', '-10000000', 'Umbuchung']
		]);
		expect(s.totals).toEqual({
			inCents: 60000,
			outCents: -18000,
			netCents: 42000,
			quantity: '70000000'
		});
	});

	it('names what stands in for a receipt, also for staking (#57)', () => {
		const s = buildStatement({
			month: '2026-09',
			account: BTC,
			index: 0,
			transactions: TXS,
			classifications: {
				T1: { kind: 'crypto-stake' },
				T2: { kind: 'crypto-reward' },
				T3: { kind: 'bank-fee' }
			},
			receiptNumbers: new Map()
		});
		expect(s.lines.map((l) => l.receipt)).toEqual(['Staking', 'Ertrag', 'Gebühr']);
	});

	it('works the balance back from the last known one, exactly in the asset', () => {
		// now 0.007; after the month −0.002 → end 0.009; the month +0.007 → start 0.002
		expect(balancesOf(BTC, TXS, '2026-09')).toEqual({
			opening: { cents: 0, units: '20000000', source: 'derived' },
			closing: { cents: 0, units: '90000000', source: 'derived' },
			check: null
		});
		// a balance from inside the month says nothing about its end
		expect(balancesOf({ ...BTC, balanceOn: '2026-09-20' }, TXS, '2026-09')).toBeNull();
		// a bank account without a balance: none
		expect(balancesOf({ id: 'B', name: 'Konto A' }, [], '2026-09')).toBeNull();
		// a euro account on an exchange: in cents
		const eur = { id: 'E', asset: 'EUR', decimals: 4, balance: '98.3500', balanceOn: '2026-10-01' };
		expect(
			balancesOf(
				eur,
				[
					{ bookedOn: '2026-09-10', amountCents: -1000 },
					{ bookedOn: '2026-10-01', amountCents: 500 }
				],
				'2026-09'
			)
		).toEqual({
			opening: { cents: 10335, units: null, source: 'derived' },
			closing: { cents: 9335, units: null, source: 'derived' },
			check: null
		});
	});

	it('takes the month’s balances from Kraken where it has them, gaps or not (#287)', () => {
		// A movement after the month was never booked: worked back, the month shifts by it.
		const gap = { ...BTC, balance: '0.0080000000' };
		expect(balancesOf(gap, TXS, '2026-09')?.closing.units).toBe('100000000');
		// Kraken's balance at the month's end does not care.
		const fromKraken = {
			...gap,
			monthBalances: { '2026-09': { opening: '20000000', closing: '90000000' } }
		};
		expect(balancesOf(fromKraken, TXS, '2026-09')).toEqual({
			opening: { cents: 0, units: '20000000', source: 'kraken' },
			closing: { cents: 0, units: '90000000', source: 'kraken' },
			check: {
				status: 'ok',
				by: 'month',
				booked: { cents: 0, units: '90000000' },
				difference: { cents: 0, units: '0' }
			}
		});
		// Read from the month's middle: the end from Kraken, the start worked back from it.
		const endOnly = { ...gap, monthBalances: { '2026-09': { closing: '90000000' } } };
		expect(balancesOf(endOnly, TXS, '2026-09')).toEqual({
			opening: { cents: 0, units: '20000000', source: 'derived' },
			closing: { cents: 0, units: '90000000', source: 'kraken' },
			check: null
		});
		// A euro account: in cents.
		const eur = {
			id: 'E',
			asset: 'EUR',
			decimals: 4,
			monthBalances: { '2026-09': { opening: '50000', closing: '983500' } }
		};
		expect(
			balancesOf(
				eur,
				[
					{ bookedOn: '2026-09-01', amountCents: 10000 },
					{ bookedOn: '2026-09-12', amountCents: -665 }
				],
				'2026-09'
			)
		).toEqual({
			opening: { cents: 500, units: null, source: 'kraken' },
			closing: { cents: 9835, units: null, source: 'kraken' },
			check: {
				status: 'ok',
				by: 'month',
				booked: { cents: 9835, units: null },
				difference: { cents: 0, units: null }
			}
		});
	});

	it('reconciles Kraken’s month: start + bookings must give the end (#287)', () => {
		// A movement of the month never booked: 0.001 BTC missing.
		const account = {
			...BTC,
			monthBalances: { '2026-09': { opening: '20000000', closing: '100000000' } }
		};
		expect(balancesOf(account, TXS, '2026-09')?.check).toEqual({
			status: 'open',
			by: 'month',
			booked: { cents: 0, units: '90000000' },
			difference: { cents: 0, units: '10000000' }
		});
		// Euros of four decimals rounded to cents: half a cent a booking is no gap.
		const eur = {
			id: 'E',
			asset: 'EUR',
			decimals: 4,
			monthBalances: { '2026-09': { opening: '0', closing: '101050' } }
		};
		const two = [
			{ bookedOn: '2026-09-01', amountCents: 500 },
			{ bookedOn: '2026-09-02', amountCents: 510 }
		];
		expect(balancesOf(eur, two, '2026-09')?.check?.status).toBe('ok');
		expect(balancesOf(eur, two.slice(0, 1), '2026-09')?.check?.status).toBe('open');
	});

	it('reconciles a wallet read in full: every booking from nothing gives the end (#287)', () => {
		// Today 0.010, everything booked: end of September 0.012, the bookings to it too.
		const wallet = {
			...BTC,
			source: 'bitcoin',
			kind: 'wallet',
			fullHistory: true,
			balance: '0.0100000000'
		};
		expect(balancesOf(wallet, TXS, '2026-09')?.check).toEqual({
			status: 'ok',
			by: 'history',
			booked: { cents: 0, units: '120000000' },
			difference: { cents: 0, units: '0' }
		});
		// The August deposit was deleted (or never read): every month is off by it.
		const withoutT0 = TXS.slice(1);
		expect(balancesOf(wallet, withoutT0, '2026-09')?.check).toMatchObject({
			status: 'open',
			difference: { units: '50000000' }
		});
		// A pruned node's part of the history proves nothing: unchecked.
		expect(balancesOf({ ...wallet, fullHistory: false }, withoutT0, '2026-09')?.check).toBeNull();
	});

	it('one statement per account with a booking in the month, by ledger account', () => {
		const bank = { id: 'A-BANK', name: 'Konto A', ibanLast4: '4711', ledgerAccount: '1200' };
		const idle = { id: 'A-IDLE', name: 'Konto C', ibanLast4: '0000', ledgerAccount: '1100' };
		const list = monthStatements({
			month: '2026-09',
			accounts: [BTC, idle, bank],
			transactions: [
				...TXS,
				{ id: 'B1', accountId: 'A-BANK', bookedOn: '2026-09-09', amountCents: -990 }
			],
			classifications: {},
			receiptNumbers: new Map()
		});
		expect(list.map((s) => s.number)).toEqual(['KA-2026-09-1200', 'KA-2026-09-1340']);
	});
});

describe('statement PDF', () => {
	it('draws a crypto account: quantity, rate with its source, balances, legend', async () => {
		const s = buildStatement({
			month: '2026-09',
			account: BTC,
			index: 0,
			transactions: TXS,
			classifications: {},
			receiptNumbers: new Map()
		});
		const bytes = await statementPdf(s, { created: new Date('2026-10-05T12:00:00Z') });
		const { text, totalPages } = await extractText(await getDocumentProxy(bytes), {
			mergePages: true
		});
		expect(totalPages).toBe(1);
		for (const part of [
			'Kraken BTC',
			'Sachkonto 1340',
			'Menge BTC',
			'Anfangsbestand (errechnet) 0,002',
			'02.09.2026 Kraken · Handel · Ref. R-1 0,01 60.000,00 H 600,00 —',
			'-0,002 60.000,00 K -120,00',
			'Endbestand (errechnet) 0,009',
			'Summe des Monats 0,007 420,00',
			'K = Kraken, CG = CoinGecko'
		]) {
			expect(text.replace(/\s+/g, ' ')).toContain(part);
		}
	});

	it('says whether the bookings lead to the closing balance, and the gap where not (#287)', async () => {
		const wallet = { ...BTC, kind: 'wallet', fullHistory: true, balance: '0.0100000000' };
		const draw = async (/** @type {Record<string, any>[]} */ transactions) => {
			const s = buildStatement({
				month: '2026-09',
				account: wallet,
				index: 0,
				transactions,
				classifications: {},
				receiptNumbers: new Map()
			});
			const bytes = await statementPdf(s, { created: new Date('2026-10-05T12:00:00Z') });
			const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
			return text.replace(/\s+/g, ' ');
		};
		const ok = await draw(TXS);
		expect(ok).toContain('Endbestand (errechnet, abgestimmt) 0,012');
		expect(ok).not.toContain('Nicht abgestimmt');
		const open = await draw(TXS.slice(1));
		expect(open).toContain('Endbestand (errechnet) 0,012');
		expect(open).toContain('Nicht abgestimmt: Buchungen ergeben 0,007');
		expect(open).toContain('Differenz 0,005');
		expect(open).toContain('oder eine Buchung wurde gelöscht');
	});

	it('breaks long months onto more pages and repeats the head', async () => {
		const many = Array.from({ length: 150 }, (_, i) =>
			tx(`M${String(i).padStart(3, '0')}`, '2026-09-15', 100, '1000')
		);
		const s = buildStatement({
			month: '2026-09',
			account: { ...BTC, balance: undefined },
			index: 0,
			transactions: many,
			classifications: {},
			receiptNumbers: new Map()
		});
		const pdf = await getDocumentProxy(
			await statementPdf(s, { created: new Date('2026-10-01T00:00:00Z') })
		);
		expect(pdf.numPages).toBeGreaterThan(1);
		const { text } = await extractText(pdf, { mergePages: false });
		expect(text[1]).toContain('Kontoauszug KA-2026-09-1340 · Kraken BTC');
		expect(text.at(-1)).toContain(`Seite ${pdf.numPages} von ${pdf.numPages}`);
	});

	it('keeps text Helvetica can draw, replaces the rest', () => {
		expect(winAnsi('Grüße € – Straße\u00a0·')).toBe('Grüße € – Straße ·');
		expect(winAnsi('\u22121 → 日本')).toBe('-1 -> ??');
	});
});
