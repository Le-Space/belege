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
			opening: { cents: 0, units: '20000000' },
			closing: { cents: 0, units: '90000000' }
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
		).toEqual({ opening: { cents: 10335, units: null }, closing: { cents: 9335, units: null } });
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
			'Anfangsbestand 0,002',
			'02.09.2026 Kraken · Handel · Ref. R-1 0,01 60.000,00 H 600,00 —',
			'-0,002 60.000,00 K -120,00',
			'Endbestand 0,009',
			'Summe des Monats 0,007 420,00',
			'K = Kraken, CG = CoinGecko'
		]) {
			expect(text.replace(/\s+/g, ' ')).toContain(part);
		}
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
		expect(winAnsi('\u22121 → 日本')).toBe('-1 ? ??');
	});
});
