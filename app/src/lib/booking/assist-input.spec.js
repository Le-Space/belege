// What "✦ Konto vorschlagen" offers the model: learned accounts of the same
// vendor first, learned accounts outside the chart still offered, personal
// accounts left out. Synthetic vendors and accounts only.
import { describe, expect, it } from 'vitest';

import { MAX_LEARNED, accountsForAssist, learnedForAssist } from './assist-input.js';

const name = (/** @type {string} */ vendors) => `booked for ${vendors}`;

describe('learnedForAssist', () => {
	it('the vendor of this payment first, then the rest, at most MAX_LEARNED', () => {
		const partners = [
			...Array.from({ length: MAX_LEARNED + 5 }, (_, i) => ({
				name: `Firma ${i} AG`,
				account: '4930'
			})),
			{ name: 'Wolkenfabrik Hosting GmbH', account: '4922' },
			{ name: 'ohne Konto GmbH', account: '' }
		];
		const learned = learnedForAssist(partners, ['WOLKENFABRIK', 'Rechnung 10/2026', null]);
		expect(learned).toHaveLength(MAX_LEARNED);
		expect(learned[0]).toEqual({ vendor: 'Wolkenfabrik Hosting GmbH', account: '4922' });
	});
});

describe('accountsForAssist', () => {
	const chart = {
		format: /** @type {const} */ ('csv'),
		fileName: 'plan.csv',
		importedAt: '',
		accounts: [
			{ number: '4920', name: 'Telefon' },
			{ number: '4925', name: 'Telefax und Internetkosten' },
			{ number: '4930', name: 'Bürobedarf' },
			{ number: '70001', name: 'Stromwerk Test AG, Musterweg 1, 12345 Musterstadt' }
		]
	};
	const catalogue = chart.accounts;

	it('a learned account outside the chart is offered first, with its vendors as name', () => {
		const out = accountsForAssist(
			catalogue,
			[{ vendor: 'Wolkenfabrik Hosting GmbH', account: '4922' }],
			chart,
			name
		);
		expect(out[0]).toEqual({ number: '4922', name: 'booked for Wolkenfabrik Hosting GmbH' });
		expect(out.map((a) => a.number)).toEqual(['4922', '4920', '4925', '4930']);
	});

	it('a learned account in the chart keeps the chart name and is not repeated', () => {
		const out = accountsForAssist(
			catalogue,
			[{ vendor: 'Stromwerk Test AG', account: '4925' }],
			chart,
			name
		);
		expect(out[0]).toEqual({ number: '4925', name: 'Telefax und Internetkosten' });
		expect(out.filter((a) => a.number === '4925')).toHaveLength(1);
	});

	it('personal accounts of the chart are not offered', () => {
		const out = accountsForAssist(catalogue, [], chart, name);
		expect(out.map((a) => a.number)).not.toContain('70001');
	});

	it('without a chart: the catalogue as it is', () => {
		const out = accountsForAssist([{ number: '4930', name: 'Bürobedarf' }], [], null, name);
		expect(out).toEqual([{ number: '4930', name: 'Bürobedarf' }]);
	});
});
