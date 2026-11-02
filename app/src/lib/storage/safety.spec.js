import { describe, expect, it } from 'vitest';

import { BACKUP_DUE_DAYS, booksSafety, requestPersistence } from './safety.js';

const now = new Date('2026-10-15T12:00:00Z');
const daysAgo = (/** @type {number} */ n) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('requestPersistence', () => {
	it('asks only when the storage is not kept yet', async () => {
		let asked = 0;
		const kept = { persisted: async () => true, persist: async () => (asked++, true) };
		expect(await requestPersistence(kept)).toBe(true);
		expect(asked).toBe(0);
		const notYet = { persisted: async () => false, persist: async () => (asked++, false) };
		expect(await requestPersistence(notYet)).toBe(false);
		expect(asked).toBe(1);
	});

	it('cannot say without the API, or when it throws', async () => {
		expect(await requestPersistence(undefined)).toBe(null);
		const broken = {
			persisted: async () => {
				throw new Error('no');
			},
			persist: async () => true
		};
		expect(await requestPersistence(broken)).toBe(null);
	});
});

describe('booksSafety', () => {
	it('warns when the browser may clear the books and there is no other copy', () => {
		for (const persisted of [false, null]) {
			const s = booksSafety({ persisted, lastBackup: null, devices: 0, now });
			expect(s.level).toBe('warn');
			expect(s.backupAgeDays).toBe(null);
		}
		const old = booksSafety({
			persisted: false,
			lastBackup: daysAgo(BACKUP_DUE_DAYS),
			devices: 0,
			now
		});
		expect(old).toMatchObject({ level: 'warn', backupAgeDays: BACKUP_DUE_DAYS });
	});

	it('reminds when the storage is kept but no recent backup or device is', () => {
		expect(booksSafety({ persisted: true, lastBackup: null, devices: 0, now }).level).toBe(
			'remind'
		);
		expect(booksSafety({ persisted: true, lastBackup: daysAgo(30), devices: 0, now }).level).toBe(
			'remind'
		);
	});

	it('is calm with a recent backup, an own device, or nothing to lose', () => {
		expect(booksSafety({ persisted: false, lastBackup: daysAgo(2), devices: 0, now }).level).toBe(
			'ok'
		);
		expect(booksSafety({ persisted: false, lastBackup: null, devices: 1, now }).level).toBe('ok');
		expect(
			booksSafety({ persisted: false, lastBackup: null, devices: 0, empty: true, now }).level
		).toBe('ok');
	});

	it('takes a broken date for no backup', () => {
		const s = booksSafety({ persisted: true, lastBackup: 'gestern', devices: 0, now });
		expect(s).toMatchObject({ level: 'remind', backupAgeDays: null });
	});
});
