// Reading a chart of accounts: DATEV Kontenbeschriftungen and plain CSV, both
// encodings, and what the suggestions make of it. Synthetic accounts only.
import { describe, expect, it } from 'vitest';

import { cleanChart, decodeChartBytes, parseChart } from './chart.js';
import { accountLabel, catalogueAccount, searchAccounts } from './skr03.js';

const DATEV = [
	'"EXTF";700;20;"Kontenbeschriftungen";3;20260901120000000;;"";"";"";1001;1;20260101;4;;;"";"";;;;"";;;;;;;;;',
	'Konto;Kontenbeschriftung;Sprach-ID',
	'1200;"Bank Konto A";"de-DE"',
	'4920;"Telefon";"de-DE"',
	'4964;"Software-Lizenzen ""Cloud""";"de-DE"',
	'8400;"Erlöse 19 % USt";"de-DE"',
	';"ohne Nummer";"de-DE"'
].join('\r\n');

describe('parseChart', () => {
	it('DATEV Kontenbeschriftungen: header skipped, headings used, quotes unescaped', () => {
		const p = parseChart(DATEV);
		expect(p.format).toBe('datev');
		expect(p.accounts).toEqual([
			{ number: '1200', name: 'Bank Konto A' },
			{ number: '4920', name: 'Telefon' },
			{ number: '4964', name: 'Software-Lizenzen "Cloud"' },
			{ number: '8400', name: 'Erlöse 19 % USt' }
		]);
		expect(p.skipped).toBe(1);
	});

	it('a CSV with its own headings, comma separated, extra columns', () => {
		const p = parseChart(
			'Kontonummer,Bezeichnung,Kontoart\n4930,Bürobedarf,Aufwand\n4210,Miete,Aufwand\n'
		);
		expect(p.format).toBe('csv');
		expect(p.accounts.map((a) => a.number)).toEqual(['4210', '4930']);
	});

	it('a CSV without headings, tab separated: the number column and the first text column', () => {
		const p = parseChart('4920\tTelefon\n4925\tTelefax und Internet\n');
		expect(p.accounts).toEqual([
			{ number: '4920', name: 'Telefon' },
			{ number: '4925', name: 'Telefax und Internet' }
		]);
	});

	it('nothing to read: no accounts', () => {
		expect(parseChart('').accounts).toEqual([]);
		expect(parseChart('Name;Ort\nAnna;Berlin').accounts).toEqual([]);
	});
});

describe('decodeChartBytes', () => {
	it('UTF-8 when it is, Windows-1252 otherwise (DATEV files)', () => {
		expect(decodeChartBytes(new TextEncoder().encode('﻿4930;Bürobedarf'))).toBe('4930;Bürobedarf');
		// "Erlöse" in Windows-1252: ö = 0xF6, not valid UTF-8 on its own.
		const cp1252 = new Uint8Array([
			0x38, 0x34, 0x30, 0x30, 0x3b, 0x45, 0x72, 0x6c, 0xf6, 0x73, 0x65
		]);
		expect(decodeChartBytes(cp1252)).toBe('8400;Erlöse');
	});
});

describe('the suggestions with a chart', () => {
	const chart = cleanChart({
		accounts: parseChart(DATEV).accounts,
		format: 'datev',
		fileName: 'EXTF_Kontenbeschriftungen.csv',
		importedAt: '2026-09-26T10:00:00Z'
	});

	it('only the accounts of the chart, with its names; expenses first for money out', () => {
		const out = searchAccounts('', { chart });
		expect(out.map((a) => a.number)).toEqual(['4920', '4964', '1200', '8400']);
		expect(searchAccounts('', { chart, income: true })[0].number).toBe('8400');
		expect(searchAccounts('lizenz', { chart }).map((a) => a.number)).toEqual(['4964']);
		expect(accountLabel('4964', chart)).toBe('4964 Software-Lizenzen "Cloud"');
	});

	it('a number outside the chart is unknown; an Automatikkonto stays one', () => {
		expect(catalogueAccount('4930', chart)).toBeNull();
		expect(catalogueAccount('4930')?.name).toBe('Bürobedarf');
		expect(catalogueAccount('8400', chart)).toMatchObject({
			name: 'Erlöse 19 % USt',
			automatic: 19
		});
	});

	it('cleanChart: none, broken entries dropped', () => {
		expect(cleanChart(null)).toBeNull();
		expect(cleanChart({ accounts: [{ number: 'x', name: 'y' }] })).toBeNull();
	});
});
