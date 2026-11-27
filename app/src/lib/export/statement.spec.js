import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';

import {
	balancesOf,
	buildStatement,
	lastDay,
	monthStatements,
	statementNumber
} from './statement.js';
import { statementPdf } from './statement-pdf.js';
import { PDFDocument } from 'pdf-lib';
import { pdfFonts, pdfText } from '@le-space/pdf';

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

	it('reconciles a wallet’s month from its explorer or its own history, and says which (#287)', async () => {
		// The explorer's balances: September's start and end, and a September movement never booked.
		const wallet = {
			...BTC,
			source: 'ethereum',
			kind: 'wallet',
			fullHistory: true,
			monthBalances: {
				'2026-09': { opening: '50000000', closing: '110000000', source: 'explorer' }
			}
		};
		const balances = balancesOf(wallet, TXS, '2026-09');
		expect(balances?.opening.source).toBe('explorer');
		expect(balances?.closing.source).toBe('explorer');
		expect(balances?.check).toEqual({
			status: 'open',
			by: 'month',
			booked: { cents: 0, units: '120000000' },
			difference: { cents: 0, units: '-10000000' }
		});
		const fromHistory = {
			...wallet,
			monthBalances: {
				'2026-09': { opening: '50000000', closing: '120000000', source: 'history' }
			}
		};
		expect(balancesOf(fromHistory, TXS, '2026-09')?.check).toMatchObject({
			status: 'ok',
			by: 'month'
		});
		const draw = async (/** @type {Record<string, any>} */ account) => {
			const s = buildStatement({
				month: '2026-09',
				account,
				index: 0,
				transactions: TXS,
				classifications: {},
				receiptNumbers: new Map()
			});
			const bytes = await statementPdf(s, { created: new Date('2026-10-05T12:00:00Z') });
			const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
			return text.replace(/\s+/g, ' ');
		};
		const byHistory = await draw(fromHistory);
		expect(byHistory).toContain('Anfangsbestand (laut Wallet) 0,005');
		expect(byHistory).toContain('Endbestand (laut Wallet, abgestimmt) 0,012');
		// Whole, not cut short in the column.
		const byExplorer = await draw({
			...wallet,
			monthBalances: {
				'2026-09': { opening: '50000000', closing: '120000000', source: 'explorer' }
			}
		});
		expect(byExplorer).toContain('Endbestand (laut Explorer, abgestimmt) 0,012');
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

	it('draws text in other scripts, not as "?" (@le-space/pdf)', async () => {
		const pdf = await PDFDocument.create();
		const { regular } = await pdfFonts(pdf);
		regular.draw(pdf.addPage(), 'Перевод · Ödeme · Grüße € – Straße\u00a0·', {
			x: 10,
			y: 10,
			size: 9
		});
		const { text } = await extractText(await getDocumentProxy(await pdf.save()), {
			mergePages: true
		});
		expect(text).toContain('Перевод · Ödeme · Grüße € – Straße');
		expect(pdfText('\u22121 日本')).toBe('\u22121 日本');
	});
});

describe('network fees on the statement (#1044)', () => {
	/** A made-up Akash wallet. */
	const AKT = {
		id: 'W-AKT',
		name: 'Wallet AKT Test',
		source: 'akash',
		kind: 'wallet',
		asset: 'AKT',
		decimals: 6,
		ledgerAccount: '1365'
	};
	/** A fee of 0.005 AKT, 1 cent, with a made-up hash. @param {number} n @param {string} bookedOn */
	const fee = (n, bookedOn) => ({
		id: `W-AKT:fee${n}`,
		accountId: 'W-AKT',
		source: 'akash',
		movement: 'fee',
		bookedOn,
		bookedAt: `${bookedOn}T10:0${n % 10}:00.000Z`,
		amountCents: -1,
		currency: 'EUR',
		counterparty: 'Akash-Netzwerk',
		purpose: 'Netzwerkgebühr (Gas)',
		asset: 'AKT',
		quantity: '-5000',
		decimals: 6,
		txRef: String(n).padStart(4, '0').repeat(16),
		valuation: { rate: '2', currency: 'EUR', source: 'coingecko', at: `${bookedOn}T00:00:00Z` }
	});
	const sent = {
		...fee(9, '2026-09-04'),
		id: 'W-AKT:send',
		movement: 'transfer',
		amountCents: -200,
		quantity: '-1000000',
		counterparty: 'Konto B',
		purpose: 'Gesendet'
	};
	const txs = [fee(1, '2026-09-02'), fee(2, '2026-09-03'), sent, fee(3, '2026-09-07')];
	const build = (/** @type {Record<string, any>} */ over = {}) =>
		buildStatement({
			month: '2026-09',
			account: AKT,
			index: 0,
			transactions: txs,
			classifications: {},
			receiptNumbers: new Map(),
			...over
		});

	it('folds a month’s fees into one line on the last fee’s day; every booking stays in lines', () => {
		const s = build();
		expect(s.number).toBe('KA-2026-09-1365');
		expect(s.lines).toHaveLength(4);
		expect(s.lines.filter((l) => l.group === 'NG-2026-09-AKT')).toHaveLength(3);
		expect(s.shown.map((l) => [l.date, l.text, l.amountCents, l.quantity, l.receipt])).toEqual([
			['2026-09-04', 'Konto B · Gesendet', -200, '-1000000', '—'],
			['2026-09-07', 'Netzwerkgebühren · 3 Transaktionen · −0,03 €', -3, '-15000', '—']
		]);
		expect(s.feeGroups.map((g) => [g.label, g.count])).toEqual([['NG-2026-09-AKT', 3]]);
		expect(s.totals).toMatchObject({ outCents: -203, quantity: '-1015000' });
		// Switched off, or a single fee: a line each.
		expect(build({ collectFees: false }).shown).toHaveLength(4);
		const single = build({ transactions: [fee(1, '2026-09-02'), sent] });
		expect(single.feeGroups).toEqual([]);
		expect(single.shown).toHaveLength(2);
	});

	it('draws the collective line and, after the totals, each fee with its hash', async () => {
		const bytes = await statementPdf(build(), { created: new Date('2026-10-05T12:00:00Z') });
		const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
		const flat = text.replace(/\s+/g, ' ');
		for (const part of [
			'Auszug-Nr. KA-2026-09-1365',
			'07.09.2026 Netzwerkgebühren · 3 Transaktionen -0,015 -0,03 —',
			'−0,03 € · Sammelposten NG-2026-09-AKT · jede Gebühr im Anhang',
			'Anhang: Netzwerkgebühren',
			'NG-2026-09-AKT · 3 Transaktionen',
			'02.09.2026 10:01:00 UTC -0,005 2,00 CG -0,01',
			`Tx ${'0001'.repeat(16)}`,
			`Tx ${'0003'.repeat(16)}`
		])
			expect(flat).toContain(part);
		expect(flat.indexOf('Summe des Monats')).toBeLessThan(flat.indexOf('Anhang: Netzwerkgebühren'));
	});
});
