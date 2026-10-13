import { describe, expect, it } from 'vitest';

import { parseLetter } from '../../../scripts/travel-rates-abroad.mjs';
import { ABROAD_LETTERS, NOT_LISTED, abroadCities, abroadRate } from './rates-abroad.js';

describe('the rates abroad (#379)', () => {
	it('holds this year’s BMF letter: add the new one each year when it is published', () => {
		const newest =
			ABROAD_LETTERS.map((l) => l.from)
				.sort()
				.at(-1) ?? '';
		expect(newest >= `${new Date().getUTCFullYear()}-01-01`, `newest letter from ${newest}`).toBe(
			true
		);
	});

	it('every letter: a row for each country’s rest, each city once, the partial rate below the full', () => {
		for (const letter of ABROAD_LETTERS) {
			const keys = letter.rows.map((r) => `${r[0]}:${r[1]}`);
			expect(new Set(keys).size, letter.from).toBe(keys.length);
			for (const country of new Set(letter.rows.map((r) => r[0]))) {
				expect(keys, `${letter.from} ${country}`).toContain(`${country}:null`);
			}
			expect(keys).toContain(`${NOT_LISTED}:null`);
			for (const [country, , full, partial, lodging] of letter.rows) {
				expect(country).toMatch(/^[A-Z]{2}$/);
				expect(country).not.toBe('DE');
				expect(partial, country).toBeLessThan(full);
				expect(lodging, country).toBeGreaterThan(0);
			}
		}
	});

	it('by the letter in force, a city’s own, the rest of the country for any other place', () => {
		// As the letter of 5 Dec 2025 prints them.
		expect(abroadRate('RU', '2026-03-01', 'Moskau')).toMatchObject({
			country: 'RU',
			city: 'Moskau',
			full: 3000,
			partial: 2000,
			lodging: 23500,
			from: '2026-01-01',
			via: null
		});
		expect(abroadRate('RU', '2026-03-01', 'Kasan')).toMatchObject({ city: null, full: 2800 });
		expect(abroadRate('FR', '2026-03-01', 'Paris')).toMatchObject({ full: 5800, partial: 3900 });
		expect(abroadRate('FR', '2026-03-01')).toMatchObject({ full: 5300, partial: 3600 });
		// The letter of 2 Dec 2024 for 2025: Albania changed from it.
		expect(abroadRate('AL', '2025-12-31')).toMatchObject({ full: 2700, from: '2025-01-01' });
		expect(abroadRate('AL', '2026-01-01')).toMatchObject({ full: 3300, from: '2026-01-01' });
		// A city the newer letter no longer lists: the rest of the country.
		expect(abroadRate('CN', '2025-06-01', 'Chengdu')).toMatchObject({ city: 'Chengdu' });
		expect(abroadRate('CN', '2026-06-01', 'Chengdu')).toMatchObject({ city: null });
		expect(abroadRate('AT', '2024-12-31')).toBeNull();
		expect(abroadCities('US', '2026-03-01')).toContain('New York City');
		expect(abroadCities('AT', '2026-03-01')).toEqual([]);
	});

	it('a country the letter does not list: another’s rates, and why', () => {
		// Named in the letter: Micronesia as the Philippines, Grenada as Trinidad and Tobago.
		expect(abroadRate('FM', '2026-03-01')).toMatchObject({ country: 'PH', via: 'district' });
		expect(abroadRate('GD', '2026-03-01')).toMatchObject({ country: 'TT', via: 'district' });
		// A territory: its mother country's (Guadeloupe → France, the rest of it).
		expect(abroadRate('GP', '2026-03-01')).toMatchObject({
			country: 'FR',
			city: null,
			via: 'territory'
		});
		// Hong Kong is a city of China in the letter.
		expect(abroadRate('HK', '2026-03-01')).toMatchObject({
			country: 'CN',
			city: 'Hongkong',
			full: 8300,
			via: null
		});
		// Afghanistan is in the 2025 letter, not in 2026's: Luxembourg's then.
		expect(abroadRate('AF', '2025-06-01')).toMatchObject({ country: 'AF', via: null });
		expect(abroadRate('AF', '2026-06-01')).toMatchObject({
			country: 'LU',
			full: 6300,
			via: 'notListed'
		});
	});
});

describe('reading a letter’s table (scripts/travel-rates-abroad.mjs)', () => {
	it('countries, cities, names on two lines, page breaks; a name it does not know stops it', () => {
		// A made-up excerpt in the layout pdftotext gives the letter; the numbers are invented.
		const head = `        Übersicht über die ab 1. Januar 2099 geltenden Pauschbeträge für
     Verpflegungsmehraufwendungen und Übernachtungskosten im Ausland
                                   24 Stunden Abwesen-
                                         €              €                €`;
		const text = `Bundesministerium der Finanzen
Ägypten  50  33  112
${head}
Belgien                                 10             7              100
China

                                                                                         1
${head}
–      Hongkong                         20             14             200
–      im Übrigen                       11             8              110
Korea, Demokratische                    12             9               90
Volksrepublik
Frankreich
–      Paris sowie die                  30             20             300
Departments 77, 78, 91 bis 95
–      im Übrigen                       13             9              130
Vereinigtes Königreich von
Großbritannien und Nordirland
–     London                            40             27              400
–     im Übrigen                        14             10              140
`;
		expect(parseLetter(text)).toEqual([
			['BE', null, 10, 7, 100],
			['CN', 'Hongkong', 20, 14, 200],
			['CN', null, 11, 8, 110],
			['KP', null, 12, 9, 90],
			['FR', 'Paris', 30, 20, 300],
			['FR', null, 13, 9, 130],
			['GB', 'London', 40, 27, 400],
			['GB', null, 14, 10, 140]
		]);
		expect(() => parseLetter(`${head}\nAtlantis   10   7   100\n`)).toThrow(/Atlantis/);
	});
});
