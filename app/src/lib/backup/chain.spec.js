// Which chains of backups are older than the one backups go on with (#454):
// each full backup with its increments, from the history; the current chain
// and – without one – the newest kept full backup are never offered, and
// nothing is when no backup is kept at all. Made-up CIDs and sizes.
import { describe, expect, it } from 'vitest';

import { olderChains } from './chain.js';

/** @param {Partial<import('./history.js').BackupRecord>} b */
const row = (b) =>
	/** @type {import('./history.js').BackupRecord} */ ({
		provider: 'aleph',
		size: 1_000,
		status: 'processed',
		entries: 1,
		files: 0,
		missing: 0,
		kind: 'full',
		...b
	});

const HISTORY = [
	row({ at: '2026-10-20T10:00:00Z', cid: 'QmNew', size: 4_000 }),
	row({
		at: '2026-10-21T10:00:00Z',
		cid: 'QmNewInc1',
		kind: 'increment',
		base: 'QmNew',
		sequence: 1
	}),
	row({ at: '2026-09-01T10:00:00Z', cid: 'QmOld', size: 3_000, status: 'rejected' }),
	// Kept again: a second row, the same file.
	row({ at: '2026-09-01T10:05:00Z', cid: 'QmOld', size: 3_000 }),
	row({
		at: '2026-09-02T10:00:00Z',
		cid: 'QmOldInc1',
		kind: 'increment',
		base: 'QmOld',
		sequence: 1,
		size: 200
	}),
	row({
		at: '2026-09-03T10:00:00Z',
		cid: 'QmOldInc2',
		kind: 'increment',
		base: 'QmOld',
		sequence: 2,
		size: 300
	}),
	// Forgotten already: nothing to offer.
	row({ at: '2026-08-01T10:00:00Z', cid: 'QmGone', status: 'forgotten' })
];

describe('olderChains', () => {
	it('offers every chain but the current one, with its increments and what Aleph keeps of it', () => {
		const older = olderChains(HISTORY, 'QmNew');
		expect(older.map((c) => [c.base, c.at, c.increments, c.bytes])).toEqual([
			['QmOld', '2026-09-01T10:00:00Z', 2, 3_500]
		]);
		expect(older[0].records).toHaveLength(4);
	});

	it('without a chain, keeps the newest kept full backup', () => {
		expect(olderChains(HISTORY, null).map((c) => c.base)).toEqual(['QmOld']);
		const before = HISTORY.filter((b) => b.cid !== 'QmNew' && b.base !== 'QmNew');
		expect(olderChains(before, undefined).map((c) => c.base)).toEqual([]);
	});

	it('offers nothing while the current chain is not kept: every chain could be the last backup', () => {
		const lost = HISTORY.map((b) => (b.cid === 'QmNew' ? { ...b, status: 'unknown' } : b));
		expect(olderChains(lost, 'QmNew')).toEqual([]);
		expect(olderChains(HISTORY, 'QmElsewhere')).toEqual([]);
	});
});
