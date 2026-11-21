// The other books of this passkey (#524): when an unlock asks Aleph's index
// by itself, when what it names is offered, and what the offer says of it.
// Made-up values.
import { describe, expect, it } from 'vitest';

import { asksAtUnlock, describeOther, worthOffering } from './other-vault.js';

const empty = { paused: false, online: true, mode: 'public', member: false, empty: true };

describe('the other books of a passkey', () => {
	it('an unlock asks by itself only for empty books on a device that is online publicly', () => {
		expect(asksAtUnlock(empty)).toBe(true);
		expect(asksAtUnlock({ ...empty, mode: 'both' })).toBe(true);
		// Paused, or device sync never switched on: nothing is asked.
		expect(asksAtUnlock({ ...empty, paused: true })).toBe(false);
		expect(asksAtUnlock({ ...empty, online: false })).toBe(false);
		// The own network, or by code alone: Aleph is not part of it.
		expect(asksAtUnlock({ ...empty, mode: 'lan' })).toBe(false);
		expect(asksAtUnlock({ ...empty, mode: 'qr' })).toBe(false);
		// Books with something in them, or someone else's.
		expect(asksAtUnlock({ ...empty, empty: false })).toBe(false);
		expect(asksAtUnlock({ ...empty, member: true })).toBe(false);
	});

	it('unasked, only a vault with more slots is offered; asked for, any', () => {
		const one = { vault: { slots: [{}] } };
		const three = { vault: { slots: [{}, {}, {}] } };
		expect(worthOffering('unlock', one, three)).toBe(true);
		expect(worthOffering('unlock', one, one)).toBe(false);
		expect(worthOffering('unlock', three, one)).toBe(false);
		expect(worthOffering('restore', three, one)).toBe(true);
		expect(worthOffering('asked', one, one)).toBe(true);
	});

	it('the offer counts the passkeys, names the words and the earliest date', () => {
		const record = {
			vault: { id: 'v', slots: [{ kid: 'a' }, { kid: 'b' }, { kid: 'words' }] },
			slots: [
				{ kid: 'b', label: '', credentialId: 'cred-b', addedAt: '2026-03-02T10:00:00.000Z' },
				{ kid: 'a', label: '', credentialId: 'cred-a', addedAt: '2026-01-05T10:00:00.000Z' },
				// From outside: a date that is none is passed over.
				{ kid: 'words', label: '', credentialId: '', addedAt: 'not a date' }
			],
			removed: []
		};
		expect(describeOther(record, 'words')).toEqual({
			passkeys: 2,
			words: true,
			since: '2026-01-05T10:00:00.000Z'
		});
		expect(describeOther({ ...record, slots: [] }, 'none')).toEqual({
			passkeys: 3,
			words: false,
			since: ''
		});
	});
});
