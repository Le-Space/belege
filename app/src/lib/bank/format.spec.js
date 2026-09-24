import { describe, expect, it } from 'vitest';

import {
	displayPurpose,
	formatDayHeading,
	formatMoney,
	groupByDay,
	matchesSearch,
	monthSummaries
} from './format.js';

const nb = (/** @type {string} */ s) => s.replace(/\u00a0/g, ' ');

describe('German formatting', () => {
	it('money with the currency code, sign kept', () => {
		expect(nb(formatMoney(-2242))).toBe('-22,42 EUR');
		expect(nb(formatMoney(143976))).toBe('1.439,76 EUR');
		expect(nb(formatMoney(0))).toBe('0,00 EUR');
		expect(nb(formatMoney(-1999, 'USD'))).toBe('-19,99 USD');
	});

	it('day headings as the Belege.AI list shows them', () => {
		expect(formatDayHeading('2026-09-22')).toBe('Dienstag, 22.9.2026');
		expect(formatDayHeading('2026-08-01')).toBe('Samstag, 1.8.2026');
	});
});

describe('grouping', () => {
	const txs = [
		{ id: 'A', bookedOn: '2026-08-14', amountCents: -747 },
		{ id: 'B', bookedOn: '2026-09-22', amountCents: -2242 },
		{ id: 'C', bookedOn: '2026-09-22', amountCents: 143976, receiptId: 'R1' },
		{ id: 'D', bookedOn: '2026-09-01', amountCents: 5 }
	];

	it('months newest first, with counts and receipt coverage', () => {
		expect(monthSummaries(txs)).toEqual([
			{ month: '2026-09', label: 'September 2026', count: 3, withReceipt: 1, coverage: 33 },
			{ month: '2026-08', label: 'August 2026', count: 1, withReceipt: 0, coverage: 0 }
		]);
	});

	it('days newest first, newest id first inside a day', () => {
		const days = groupByDay(txs);
		expect(days.map((d) => d.day)).toEqual(['2026-09-22', '2026-09-01', '2026-08-14']);
		expect(days[0].items.map((t) => t.id)).toEqual(['C', 'B']);
		expect(days[0].label).toBe('Dienstag, 22.9.2026');
	});
});

describe('search', () => {
	const tx = {
		id: 'X',
		bookedOn: '2026-09-22',
		amountCents: -143976,
		counterparty: 'Kaffeerösterei Nordlicht GmbH',
		purpose: 'Rechnung KR-2026-0917'
	};

	it('finds by name and purpose, case-insensitive', () => {
		for (const q of ['nordlicht', 'KAFFEE', 'kr-2026', '  Nordlicht '])
			expect(matchesSearch(tx, q)).toBe(true);
		expect(matchesSearch(tx, 'südlicht')).toBe(false);
		expect(matchesSearch(tx, '')).toBe(true);
	});

	it('finds by amount in the usual spellings', () => {
		for (const q of [
			'1439,76',
			'1.439,76',
			'1439.76',
			'-1.439,76',
			'1439,7',
			'1439,76 €',
			'1.439,76 EUR'
		]) {
			expect(matchesSearch(tx, q), q).toBe(true);
		}
		expect(matchesSearch(tx, '1439,77')).toBe(false);
		expect(matchesSearch(tx, '+1439,76')).toBe(false);
	});

	it('finds by date in the usual spellings', () => {
		for (const q of ['22.09.2026', '22.9.2026', '22.9.', '2026-09-22', '2026-09']) {
			expect(matchesSearch(tx, q), q).toBe(true);
		}
		expect(matchesSearch(tx, '23.9.2026')).toBe(false);
	});
});

describe('displayPurpose', () => {
	it('takes the SVWZ value when the bank tags it', () => {
		expect(
			displayPurpose(
				'EREF+RE-2026-17 MREF+M-1 CRED+DE00ZZZ00000000000 SVWZ+Rechnung 2026-17 vom 03.08. ABWA+Jemand'
			)
		).toBe('Rechnung 2026-17 vom 03.08.');
		expect(displayPurpose('SVWZ: Miete August')).toBe('Miete August');
	});

	it('takes the text before the first tag when there is no SVWZ (GLS style)', () => {
		expect(
			displayPurpose(
				'Kundennummer: K000 Rechnungsnummer: 0000123 EREF: 999 MREF: M-K000-0001 CRED: DE00ZZZ00000000000 IBAN: DE00000000000000000000 BIC: TESTDEFF'
			)
		).toBe('Kundennummer: K000 Rechnungsnummer: 0000123');
		expect(displayPurpose('2680709 / 2680709 IBAN: DE00000000000000000000 BIC: TESTDEFF')).toBe(
			'2680709 / 2680709'
		);
	});

	it('leaves untagged text alone and does not mistake words for tags', () => {
		expect(displayPurpose('D170138619,2026-1220699   7,47 0,00')).toBe(
			'D170138619,2026-1220699 7,47 0,00'
		);
		expect(displayPurpose('Credit for services')).toBe('Credit for services');
		expect(displayPurpose('')).toBe('');
		expect(displayPurpose(undefined)).toBe('');
	});

	it('falls back to the raw text when only tags are there', () => {
		expect(displayPurpose('EREF: 123 MREF: 456')).toBe('EREF: 123 MREF: 456');
	});
});
