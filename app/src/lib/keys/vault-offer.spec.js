import { describe, expect, it } from 'vitest';

import { backupAsksVaultIndex, keysOffersVaultIndex } from './vault-offer.js';

const base = { owner: true, indexOn: false, paused: false, answered: false, backedUp: true };

describe('keeping the vault on Aleph, offered (#1049)', () => {
	it('is offered with a single passkey, on the keys page and at the backup', () => {
		expect(keysOffersVaultIndex(base)).toBe(true);
		expect(backupAsksVaultIndex(base)).toBe(true);
	});

	it('is not offered while the network is paused', () => {
		expect(keysOffersVaultIndex({ ...base, paused: true })).toBe(false);
		expect(backupAsksVaultIndex({ ...base, paused: true })).toBe(false);
	});

	it('is not offered once the vault is on Aleph', () => {
		expect(keysOffersVaultIndex({ ...base, indexOn: true })).toBe(false);
		expect(backupAsksVaultIndex({ ...base, indexOn: true })).toBe(false);
	});

	it('is not offered to a member, who has no books’ vault', () => {
		expect(keysOffersVaultIndex({ ...base, owner: false })).toBe(false);
		expect(backupAsksVaultIndex({ ...base, owner: false })).toBe(false);
	});

	it('is asked at the backup once: a no stays a no there, the keys page still offers it', () => {
		expect(backupAsksVaultIndex({ ...base, answered: true })).toBe(false);
		expect(keysOffersVaultIndex({ ...base, answered: true })).toBe(true);
	});

	it('is asked at the backup only once a backup was made', () => {
		expect(backupAsksVaultIndex({ ...base, backedUp: false })).toBe(false);
	});
});
