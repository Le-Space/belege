// The monthly DATEV export: the Buchungsstapel line by line, the encoding,
// the receipt numbers, a transfer booked once, the check list, and the ZIP.
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import { receipt, tx } from '../matching/fixtures.js';
import { encodeWindows1252 } from './cp1252.js';
import {
	COLUMNS,
	HEADER_FIELDS,
	amount,
	bookingLine,
	buchungsstapel,
	ddmm,
	headerLine,
	monthRange,
	text
} from './datev.js';
import { fileSlug, runMonthExport } from './build.js';
import { numberReceipts, planMonth, transferCounterpart } from './plan.js';

const SETTINGS = defaultDatevSettings();
const CREATED = new Date(Date.UTC(2026, 9, 2, 8, 30, 15, 123));
const confirmed = (/** @type {string} */ account, taxKey = '') => ({
	account,
	taxKey,
	confirmedAt: '2026-10-01T10:00:00.000Z'
});

const ACCOUNTS = [
	{ id: 'ACC-GLS', name: 'Konto A', ibanLast4: '4711', source: 'hibiscus', ledgerAccount: '1200' },
	{ id: 'ACC-REV', name: 'Konto B', ibanLast4: '0001', source: 'hibiscus', ledgerAccount: '1210' }
];

describe('DATEV fields', () => {
	it('amounts, dates, text', () => {
		expect(amount(-3999)).toBe('39,99');
		expect(amount(1234567)).toBe('12345,67');
		expect(amount(5)).toBe('0,05');
		expect(ddmm('2026-09-05')).toBe('0509');
		expect(text('Say "hi"; ok')).toBe('"Say ""hi""; ok"');
		expect(text('a\r\nb')).toBe('"a b"');
		expect(text('')).toBe('');
		expect(text('x'.repeat(80), 60)).toBe(`"${'x'.repeat(60)}"`);
	});

	it('the period and the start of the fiscal year', () => {
		expect(monthRange('2026-02')).toEqual({
			from: '2026-02-01',
			to: '2026-02-28',
			fiscalYearStart: '2026-01-01'
		});
		expect(monthRange('2026-03', 7).fiscalYearStart).toBe('2025-07-01');
		expect(monthRange('2026-09', 7).fiscalYearStart).toBe('2026-07-01');
	});

	it('the header line: 31 fields, as format version 13 has them', () => {
		const line = headerLine({
			settings: SETTINGS,
			month: '2026-09',
			created: CREATED,
			label: 'Belege 2026-09'
		});
		expect(line).toBe(
			'"EXTF";700;21;"Buchungsstapel";13;20261002083015123;;"";"";;1001;1;20260101;4;20260901;20260930;"Belege 2026-09";"";1;0;0;"EUR";;;;;;;;;'
		);
		expect(line.split(';')).toHaveLength(HEADER_FIELDS);
	});

	it('the column headings: 125, the first fourteen in this order', () => {
		expect(COLUMNS).toHaveLength(125);
		expect(COLUMNS.slice(0, 14)).toEqual([
			'Umsatz (ohne Soll/Haben-Kz)',
			'Soll/Haben-Kennzeichen',
			'WKZ Umsatz',
			'Kurs',
			'Basis-Umsatz',
			'WKZ Basis-Umsatz',
			'Konto',
			'Gegenkonto (ohne BU-Schlüssel)',
			'BU-Schlüssel',
			'Belegdatum',
			'Belegfeld 1',
			'Belegfeld 2',
			'Skonto',
			'Buchungstext'
		]);
	});

	it('a booking line: money out is H, money in is S, 125 fields', () => {
		const out = bookingLine({
			amountCents: -3999,
			account: '1200',
			contra: '4925',
			taxKey: '9',
			date: '2026-09-01',
			receiptNumber: '2026-09-001',
			text: 'Kabelnetz Beispiel GmbH'
		});
		expect(out.split(';').slice(0, 14)).toEqual([
			'39,99',
			'"H"',
			'',
			'',
			'',
			'',
			'1200',
			'4925',
			'"9"',
			'0109',
			'"2026-09-001"',
			'',
			'',
			'"Kabelnetz Beispiel GmbH"'
		]);
		expect(out.split(';')).toHaveLength(125);
		const inn = bookingLine({
			amountCents: 11900,
			account: '1200',
			contra: '8400',
			taxKey: '',
			date: '2026-09-15',
			receiptNumber: '',
			text: 'Kunde AG'
		});
		expect(inn.startsWith('119,00;"S";;;;;1200;8400;;1509;;;;"Kunde AG";')).toBe(true);
		expect(() =>
			bookingLine({
				amountCents: 1,
				account: '1200',
				contra: '4900',
				taxKey: '',
				date: '2026-09-01',
				receiptNumber: 'with space',
				text: ''
			})
		).toThrow('Belegfeld 1');
	});

	it('the whole stack: header, headings, lines, each ended by CRLF', () => {
		const csv = buchungsstapel({
			settings: SETTINGS,
			month: '2026-09',
			created: CREATED,
			lines: []
		});
		const lines = csv.split('\r\n');
		expect(lines).toHaveLength(3);
		expect(lines[2]).toBe('');
		expect(lines[1]).toBe(COLUMNS.join(';'));
		expect(csv.includes('\n\n')).toBe(false);
	});
});

describe('Windows-1252', () => {
	it('umlauts, ß and € as their ANSI bytes', () => {
		expect([...encodeWindows1252('äöüÄÖÜß€')]).toEqual([
			0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf, 0x80
		]);
		expect([...encodeWindows1252('A;"')]).toEqual([0x41, 0x3b, 0x22]);
		expect([...encodeWindows1252('–')]).toEqual([0x96]);
	});
	it('characters outside it: without accent, or "?"', () => {
		expect(new TextDecoder('windows-1252').decode(encodeWindows1252('Łódź ő 😀'))).toBe('?ódz o ?');
		// A decomposed ä is one byte, too.
		expect([...encodeWindows1252('ä')]).toEqual([0xe4]);
	});
});

describe('receipt numbers', () => {
	it('YYYY-MM-NNN in order, kept once given, continuing after the highest', () => {
		const a = { id: 'A' };
		const b = { id: 'B', exportNumber: '2026-09-002' };
		const c = { id: 'C' };
		const other = { id: 'X', exportNumber: '2026-08-007' };
		const { numbers, fresh } = numberReceipts('2026-09', [a, b, c, a], [a, b, c, other]);
		expect([...numbers.entries()]).toEqual([
			['A', '2026-09-003'],
			['B', '2026-09-002'],
			['C', '2026-09-004']
		]);
		expect(fresh).toEqual([
			{ receiptId: 'A', number: '2026-09-003' },
			{ receiptId: 'C', number: '2026-09-004' }
		]);
	});
});

/**
 * A month of books: an expense with a receipt, an income, a transfer, a fee.
 *
 * @returns {any}
 */
function books() {
	const kabel = receipt(
		{
			vendor: 'Kabelnetz Beispiel GmbH',
			gross: 39.99,
			invoice_date: '2026-08-28',
			vat: [{ rate: 19, amount: 6.38 }]
		},
		{ id: 'R-KABEL', fileCid: 'cid-kabel', mime: 'application/pdf', source: 'upload' }
	);
	const second = receipt(
		{ vendor: 'Kabelnetz Beispiel GmbH', gross: 0, invoice_date: '2026-08-28' },
		{ id: 'R-KABEL-2', fileCid: 'cid-kabel-2', mime: 'application/pdf', source: 'upload' }
	);
	const loose = receipt(
		{ vendor: 'Übrig GmbH', gross: 5, invoice_date: '2026-09-10' },
		{ id: 'R-LOOSE' }
	);
	const held = receipt(
		{ vendor: 'Fremd Ltd', gross: 7, invoice_date: '2026-09-11' },
		{ id: 'R-HELD', authVerdict: 'fail', status: 'rückfrage' }
	);
	const transactions = [
		tx({
			id: 'T1',
			bookedOn: '2026-09-01',
			amountCents: -3999,
			counterparty: 'KABELNETZ',
			receiptId: 'R-KABEL',
			booking: confirmed('4925', '9')
		}),
		tx({
			id: 'T2',
			bookedOn: '2026-09-15',
			amountCents: 11900,
			counterparty: 'Kunde "Nord"; AG',
			booking: confirmed('8400')
		}),
		tx({
			id: 'T3',
			bookedOn: '2026-09-20',
			amountCents: -50000,
			counterparty: 'Muster UG',
			purpose: 'Umbuchung',
			booking: confirmed('1360')
		}),
		tx({
			id: 'T4',
			accountId: 'ACC-REV',
			bookedOn: '2026-09-21',
			amountCents: 50000,
			counterparty: 'Muster UG',
			purpose: 'Top-up',
			booking: confirmed('1360')
		}),
		tx({
			id: 'T5',
			bookedOn: '2026-09-30',
			amountCents: -990,
			bookingType: 'Abschluss',
			purpose: 'Abschluss',
			booking: confirmed('4970')
		}),
		tx({ id: 'T6', bookedOn: '2026-08-31', amountCents: -100, booking: confirmed('4900') })
	];
	const matches = [
		{
			id: 'M1',
			transactionId: 'T1',
			receiptId: 'R-KABEL',
			state: 'confirmed',
			reasons: ['manual'],
			score: 120
		},
		{ id: 'M2', transactionId: 'T1', receiptId: 'R-KABEL-2', state: 'auto', reasons: [], score: 90 }
	];
	const classifications = {
		T3: { kind: 'own-transfer', via: 'counter-booking', counterBookingId: 'T4' },
		T4: { kind: 'own-transfer', via: 'counter-booking', counterBookingId: 'T3' },
		T5: { kind: 'bank-fee', via: 'booking-type' }
	};
	return {
		transactions,
		receipts: [kabel, second, loose, held],
		matches,
		classifications,
		accounts: ACCOUNTS
	};
}

describe('planMonth', () => {
	it('one line per booking; the transfer once, from the lower ledger, against the other bank', () => {
		const b = books();
		const plan = planMonth({ month: '2026-09', ...b });
		expect(plan.blocked).toBe(false);
		expect(plan.bookings.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
		expect(plan.lines.map((l) => l.tx.id)).toEqual(['T1', 'T2', 'T3', 'T5']);
		expect(plan.transferSides.map((s) => s.tx.id)).toEqual(['T4']);
		const [expense, income, transfer, fee] = plan.lines.map((l) => bookingLine(l.line));
		expect(expense.split(';').slice(0, 14).join(';')).toBe(
			'39,99;"H";;;;;1200;4925;"9";0109;"2026-09-001";;;"Kabelnetz Beispiel GmbH"'
		);
		// A ";" inside a quoted text stays text.
		expect(income.startsWith('119,00;"S";;;;;1200;8400;;1509;;;;"Kunde ""Nord""; AG";')).toBe(true);
		expect(transfer.split(';').slice(0, 14).join(';')).toBe(
			'500,00;"H";;;;;1200;1210;;2009;;;;"Muster UG"'
		);
		expect(fee.split(';').slice(0, 14).join(';')).toBe(
			'9,90;"H";;;;;1200;4970;;3009;;;;"Abschluss"'
		);
		// Both receipts of T1 are numbered and go into the ZIP; Belegfeld 1 has the first.
		expect(plan.receipts.map((r) => r.id)).toEqual(['R-KABEL', 'R-KABEL-2']);
		expect(plan.numbers.get('R-KABEL-2')).toBe('2026-09-002');
	});

	it('the lower ledger decides which side, not the month', () => {
		const b = books();
		const accounts = [
			{ ...ACCOUNTS[0], ledgerAccount: '1810' },
			{ ...ACCOUNTS[1], ledgerAccount: '1210' }
		];
		const plan = planMonth({ month: '2026-09', ...b, accounts });
		expect(plan.transferSides.map((s) => s.tx.id)).toEqual(['T3']);
		const line = plan.lines.find((l) => l.tx.id === 'T4');
		expect(line?.line).toMatchObject({ account: '1210', contra: '1810', amountCents: 50000 });
	});

	it('a transfer confirmed on another account is no transfer; one without its other side keeps 1360', () => {
		const b = books();
		const t3 = { ...b.transactions[2], booking: confirmed('1800') };
		expect(transferCounterpart(t3, b.transactions, b.classifications)).toBeNull();
		const alone = b.transactions.filter((/** @type {any} */ t) => t.id !== 'T4');
		const plan = planMonth({ month: '2026-09', ...b, transactions: alone });
		expect(plan.lines.find((l) => l.tx.id === 'T3')?.line.contra).toBe('1360');
	});

	it('the check list: a missing account or ledger blocks; the rest warns', () => {
		const b = books();
		const withOpen = [
			...b.transactions,
			tx({ id: 'T7', bookedOn: '2026-09-22', amountCents: -2200, counterparty: 'Café' })
		];
		const plan = planMonth({ month: '2026-09', ...b, transactions: withOpen });
		expect(plan.blocked).toBe(true);
		expect(plan.checks.unassigned.map((t) => t.id)).toEqual(['T7']);
		expect(plan.checks.missingReceipt.map((t) => t.id)).toEqual(['T2', 'T7']);
		expect(plan.checks.unlinkedReceipts.map((r) => r.id)).toEqual(['R-LOOSE']);
		expect(plan.checks.unverified.map((r) => r.id)).toEqual(['R-HELD']);

		const noLedger = planMonth({
			month: '2026-09',
			...b,
			accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], ledgerAccount: null }]
		});
		expect(noLedger.blocked).toBe(true);
		expect(noLedger.checks.noLedger.map((a) => a.id)).toEqual(['ACC-REV']);

		const warningsOnly = planMonth({ month: '2026-09', ...b });
		expect(warningsOnly.blocked).toBe(false);
		expect(warningsOnly.checks.missingReceipt.length).toBeGreaterThan(0);
		expect(planMonth({ month: '2026-07', ...b }).blocked).toBe(true);
	});
});

describe('the ZIP', () => {
	/** @type {any} */
	let store;
	beforeEach(() => {
		// The fixtures' ids are readable, not ULIDs: receipts in a plain Map.
		/** @type {Map<string, any>} */
		const docs = new Map();
		store = {
			receipts: {
				get: async (/** @type {string} */ id) => structuredClone(docs.get(id) ?? null),
				put: async (/** @type {any} */ r) => (docs.set(r.id, structuredClone(r)), r),
				list: async () => [...docs.values()].map((r) => structuredClone(r))
			},
			events: memoryCollection('events').collection
		};
	});

	it('holds the stack in Windows-1252, the receipts, the overview; numbers stay', async () => {
		const b = books();
		for (const r of b.receipts) await store.receipts.put(r);
		const files = {
			'cid-kabel': new Uint8Array([37, 80, 68, 70, 1]),
			'cid-kabel-2': new Uint8Array([37, 80, 68, 70, 2])
		};
		const blobs = {
			get: async (/** @type {string} */ cid) => files[/** @type {keyof typeof files} */ (cid)]
		};
		const plan = planMonth({ month: '2026-09', ...b, receipts: await store.receipts.list() });
		const { zip, fileName, paths } = await runMonthExport({
			store,
			blobs,
			plan,
			settings: SETTINGS,
			accounts: b.accounts,
			classifications: b.classifications,
			now: () => CREATED
		});
		expect(fileName).toBe('DATEV_2026-09.zip');
		expect(paths).toEqual([
			'DATEV/EXTF_Buchungsstapel_2026-09.csv',
			'Belege/2026-09-001_Kabelnetz_Beispiel_GmbH.pdf',
			'Belege/2026-09-002_Kabelnetz_Beispiel_GmbH.pdf',
			'Uebersicht_2026-09.csv'
		]);
		const unzipped = unzipSync(zip);
		expect([...unzipped['Belege/2026-09-002_Kabelnetz_Beispiel_GmbH.pdf']]).toEqual([
			37, 80, 68, 70, 2
		]);
		const csv = new TextDecoder('windows-1252').decode(
			unzipped['DATEV/EXTF_Buchungsstapel_2026-09.csv']
		);
		const lines = csv.split('\r\n');
		expect(lines[0].startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
		expect(lines[1].includes('Gegenkonto (ohne BU-Schlüssel)')).toBe(true);
		expect(lines).toHaveLength(2 + 4 + 1);
		// The umlaut is one byte in the file.
		const raw = unzipped['DATEV/EXTF_Buchungsstapel_2026-09.csv'];
		expect(raw.includes(0xfc)).toBe(true);
		expect(raw.includes(0xc3)).toBe(false);
		const bytes = unzipped['Uebersicht_2026-09.csv'];
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const overview = strFromU8(bytes);
		expect(overview.startsWith('Datum;Betrag;')).toBe(true);
		expect(overview).toContain(
			'01.09.2026;-39,99;Kabelnetz Beispiel GmbH;Konto A ···4711;1200;4925;9;2026-09-001;2026-09-001, 2026-09-002;Von Hand;'
		);
		expect(overview).toContain('nicht im Buchungsstapel');
		expect(overview).toContain('"Kunde ""Nord""; AG"');

		// The numbers are kept, and the Verlauf says what went out.
		/** @type {any[]} */
		const stored = await store.receipts.list();
		expect(
			stored
				.filter((r) => r.exportNumber)
				.map((r) => r.exportNumber)
				.sort()
		).toEqual(['2026-09-001', '2026-09-002']);
		const [event] = await store.events.list();
		expect(event).toMatchObject({ kind: 'export', month: '2026-09', bookings: 4, receipts: 2 });
		// A new receipt linked to the fee later: the old numbers stay, it gets the next.
		const again = planMonth({
			month: '2026-09',
			...b,
			receipts: stored,
			matches: [
				...b.matches,
				{ id: 'M3', transactionId: 'T5', receiptId: 'R-LOOSE', state: 'confirmed', reasons: [] }
			]
		});
		expect(again.numbers.get('R-KABEL')).toBe('2026-09-001');
		expect(again.numbers.get('R-LOOSE')).toBe('2026-09-003');
	});

	it('refuses a blocked month, and names files safely', async () => {
		const b = books();
		const plan = planMonth({ month: '2026-07', ...b });
		await expect(
			runMonthExport({
				store,
				blobs: { get: async () => new Uint8Array() },
				plan,
				settings: SETTINGS,
				accounts: [],
				classifications: {}
			})
		).rejects.toThrow('nicht bereit');
		expect(fileSlug('Müller & Söhne GmbH / Straße')).toBe('Mueller_Soehne_GmbH_Strasse');
		expect(fileSlug('***')).toBe('Beleg');
	});
});
