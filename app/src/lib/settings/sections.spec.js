// The parts of Einstellungen: old anchors still arrive, and a tile says
// where its part stands. Made-up books.
import { describe, expect, it } from 'vitest';

import { isSettingsSection, sectionOfAnchor, tileStates } from './sections.js';

describe('the parts of Einstellungen', () => {
	it('takes an anchor of the old long page to the part it is in now', () => {
		expect(sectionOfAnchor('#buchhaltung')).toEqual({ id: 'buchhaltung', hash: '' });
		expect(sectionOfAnchor('schluessel')).toEqual({ id: 'schluessel', hash: '' });
		expect(sectionOfAnchor('#rekey')).toEqual({ id: 'schluessel', hash: '#rekey' });
		expect(sectionOfAnchor('#nirgends')).toBeNull();
		expect(sectionOfAnchor('')).toBeNull();
		expect(isSettingsSection('speicher')).toBe(true);
		expect(isSettingsSection('../x')).toBe(false);
	});

	it('says on each tile where the part stands', () => {
		const states = tileStates({
			accounts: [
				{ id: 'a', ledgerAccount: '1200' },
				{ id: 'b' },
				{ id: 'c', ledgerAccount: ' ' },
				{ id: 'd', deleted: true }
			],
			partners: [
				{ id: 'p', aliases: ['x'] },
				{ id: 'q', aliases: [] },
				{ id: 'r', aliases: ['y'], deleted: true }
			],
			matchingSettings: { companyNames: ['Beispiel UG'], rules: [] },
			chart: { accounts: [{ number: '1200', name: 'Bank' }], format: 'csv' }
		});
		expect(states.buchhaltung).toEqual({
			key: 'ledgerMissing',
			params: { count: 2, total: 3 },
			warn: true
		});
		expect(states.gelerntes).toEqual({ key: 'learned', params: { count: 1 } });
		expect(states.firma).toEqual({ key: 'companySet', params: { count: 1 } });
		expect(states.kontenplan).toEqual({ key: 'chart', params: { count: 1 } });

		const empty = tileStates({ accounts: [], partners: [], matchingSettings: null, chart: null });
		expect(empty.buchhaltung).toEqual({ key: 'noAccounts' });
		expect(empty.firma).toEqual({ key: 'companyMissing', warn: true });
		expect(empty.kontenplan).toEqual({ key: 'chartNone' });
		expect(
			tileStates({
				accounts: [{ id: 'a', ledgerAccount: '1200' }],
				partners: [],
				matchingSettings: null,
				chart: null
			}).buchhaltung
		).toEqual({ key: 'ledgerDone', params: { total: 1 } });
	});
});
