// The history of backups (issue #77): newest first, the chain a record
// continues whole, the other chains' rows capped. Made-up CIDs.
import { describe, expect, it } from 'vitest';

import { KEEP, withBackup } from './history.js';

/** @param {Partial<import('./history.js').BackupRecord>} b */
const row = (b) =>
	/** @type {import('./history.js').BackupRecord} */ ({
		at: '2026-10-20T10:00:00Z',
		provider: 'aleph',
		size: 1_000,
		status: 'processed',
		entries: 1,
		files: 0,
		missing: 0,
		kind: 'full',
		cid: 'QmFull',
		...b
	});

describe('the history keeps the current chain whole', () => {
	it('newest first, and the other chains at most KEEP rows', () => {
		/** @type {import('./history.js').BackupRecord[]} */
		let list = [];
		// An old chain with more rows than KEEP.
		list = withBackup(list, row({ cid: 'QmOld' }));
		for (let i = 1; i <= KEEP + 10; i++) {
			list = withBackup(
				list,
				row({ cid: `QmOldInc${i}`, kind: 'increment', base: 'QmOld', sequence: i })
			);
		}
		expect(list).toHaveLength(KEEP + 11);
		// A new chain: its rows stay whatever their number; the old chain's are capped.
		list = withBackup(list, row({ cid: 'QmNew' }));
		for (let i = 1; i <= KEEP + 20; i++) {
			list = withBackup(
				list,
				row({ cid: `QmNewInc${i}`, kind: 'increment', base: 'QmNew', sequence: i })
			);
		}
		const ofNew = list.filter((b) => b.cid === 'QmNew' || b.base === 'QmNew');
		const ofOld = list.filter((b) => b.cid === 'QmOld' || b.base === 'QmOld');
		expect(ofNew).toHaveLength(KEEP + 21);
		expect(ofOld).toHaveLength(KEEP);
		expect(list[0].cid).toBe(`QmNewInc${KEEP + 20}`);
		// The old chain's newest rows are the ones kept.
		expect(ofOld[0].cid).toBe(`QmOldInc${KEEP + 10}`);
		expect(ofOld.some((b) => b.cid === 'QmOld')).toBe(false);
	});

	it('a record of another chain caps the current one in turn', () => {
		let list = withBackup([], row({ cid: 'QmA' }));
		for (let i = 1; i <= KEEP + 5; i++) {
			list = withBackup(
				list,
				row({ cid: `QmAInc${i}`, kind: 'increment', base: 'QmA', sequence: i })
			);
		}
		list = withBackup(list, row({ cid: 'QmB' }));
		expect(list).toHaveLength(KEEP + 1);
		expect(list[0].cid).toBe('QmB');
	});
});
