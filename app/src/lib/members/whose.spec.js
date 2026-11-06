// Whose a device or a record is (#614). Made-up DIDs, peer ids and names.
import { describe, expect, it } from 'vitest';

import { whose } from './whose.js';

const W = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';
const OWNER = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const records = [
	{
		key: `member:${W}`,
		value: { label: 'Buchhaltung Test', role: 'bookkeeping', devices: ['12D3KooWjoined'] },
		author: OWNER
	},
	{ key: 'device:12D3KooWjoined', value: { label: 'Laptop' }, author: OWNER },
	{ key: 'device:12D3KooWsecond', value: { label: 'Telefon' }, author: W },
	{ key: 'device:12D3KooWowners', value: { label: 'Mac' }, author: OWNER }
];

describe('whose', () => {
	it('names a member by their write identity, and their devices', () => {
		const w = whose(records);
		expect(w.name(W)).toBe('Buchhaltung Test');
		expect(w.name(OWNER)).toBe('');
		expect(w.deviceOwner('12D3KooWjoined')).toBe('Buchhaltung Test');
		expect(w.deviceOwner('12D3KooWsecond')).toBe('Buchhaltung Test');
		expect(w.deviceOwner('12D3KooWowners')).toBe('');
		expect(w.devicesOf(W).sort()).toEqual(['12D3KooWjoined', '12D3KooWsecond']);
	});

	it('tells a device of a member from an own one, also for a reader, named or not', () => {
		const reader = 'did:key:z6MkrHKzgsahxBLyNAbLQyB1pcWNYC9GmywiWPgkrvntAZcj';
		const w = whose([
			...records,
			{
				key: `member:${reader}`,
				value: { label: '', role: 'reader', devices: ['12D3KooWreader'] },
				author: OWNER
			}
		]);
		expect(w.isMemberDevice('12D3KooWjoined')).toBe(true);
		expect(w.isMemberDevice('12D3KooWsecond')).toBe(true);
		expect(w.isMemberDevice('12D3KooWreader')).toBe(true);
		expect(w.isMemberDevice('12D3KooWowners')).toBe(false);
		expect(w.isMemberDevice('12D3KooWunknown')).toBe(false);
	});
});
