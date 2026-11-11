// Which chains of backups are older than the one backups go on with (#454):
// each full backup with its increments, from the history; the current chain
// and – without one – the newest kept full backup are never offered, and
// nothing is when no backup is kept at all. Made-up CIDs and sizes.
import { describe, expect, it } from 'vitest';

import { chainAfter, olderChains, reconcileChain } from './chain.js';

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

describe('the chain as far as Aleph keeps it', () => {
	const BASE = 'QmBase';
	/** @param {number} seq @param {string} status @param {number} [files] */
	const inc = (seq, status, files = 0) =>
		row({
			at: `2026-11-0${seq}T10:00:00Z`,
			cid: `QmInc${seq}`,
			kind: 'increment',
			base: BASE,
			sequence: seq,
			status,
			files
		});
	/** A chain started at the full backup, with three receipt files. */
	const start = () => ({
		base: BASE,
		sequence: 0,
		previous: null,
		heads: { db: ['h0'] },
		files: ['f1', 'f2', 'f3'],
		kept: { sequence: 0, previous: null, heads: { db: ['h0'] }, files: 3 },
		pending: []
	});

	it('moves `kept` with a confirmed increment, and keeps a pending one aside', () => {
		const one = chainAfter(
			start(),
			{ heads: { db: ['h1'] }, files: ['f4'] },
			'QmInc1',
			'processed'
		);
		expect(one.kept).toEqual({ sequence: 1, previous: 'QmInc1', heads: { db: ['h1'] }, files: 4 });
		expect(one.pending).toEqual([]);
		const two = chainAfter(one, { heads: { db: ['h2'] }, files: [] }, 'QmInc2', 'pending');
		expect(two.sequence).toBe(2);
		expect(two.kept).toEqual(one.kept);
		expect(two.pending).toEqual([
			{ sequence: 2, previous: 'QmInc2', heads: { db: ['h2'] }, files: 4, cid: 'QmInc2' }
		]);
		// Aleph confirms it later: kept moves on.
		const later = reconcileChain(two, [inc(1, 'processed'), inc(2, 'processed')]);
		expect(later?.kept?.sequence).toBe(2);
		expect(later?.pending).toEqual([]);
		// Nothing new: the same chain back.
		expect(
			reconcileChain(/** @type {any} */ (later), [inc(1, 'processed'), inc(2, 'processed')])
		).toBe(later);
	});

	it('goes back to `kept` when Aleph refuses an increment it first called pending', () => {
		const one = chainAfter(start(), { heads: { db: ['h1'] }, files: ['f4'] }, 'QmInc1', 'pending');
		const two = chainAfter(one, { heads: { db: ['h2'] }, files: ['f5'] }, 'QmInc2', 'pending');
		const back = reconcileChain(two, [inc(1, 'rejected', 1), inc(2, 'pending', 1)]);
		expect(back).toMatchObject({
			sequence: 0,
			previous: null,
			heads: { db: ['h0'] },
			files: ['f1', 'f2', 'f3'],
			pending: []
		});
	});

	it('a gap a restore cannot cross: refused, then a later one kept – null, a full backup next', () => {
		const one = chainAfter(start(), { heads: { db: ['h1'] }, files: [] }, 'QmInc1', 'pending');
		const two = chainAfter(one, { heads: { db: ['h2'] }, files: [] }, 'QmInc2', 'pending');
		expect(reconcileChain(two, [inc(1, 'rejected'), inc(2, 'processed')])).toBeNull();
	});

	it('a chain from before: every increment refused or unknown – back to the full backup, with no heads', () => {
		const old = {
			base: BASE,
			sequence: 5,
			previous: 'QmInc5',
			heads: { db: ['h5'] },
			files: ['f1', 'f2', 'f3']
		};
		const history = [
			inc(1, 'rejected'),
			inc(2, 'rejected'),
			inc(3, 'unknown'),
			inc(4, 'rejected'),
			inc(5, 'rejected')
		];
		const back = reconcileChain(/** @type {any} */ (old), history);
		// No heads: the next increment ships every entry again, which a restore merges.
		expect(back).toMatchObject({
			sequence: 0,
			previous: null,
			heads: {},
			files: ['f1', 'f2', 'f3']
		});
		expect(back?.kept).toEqual({ sequence: 0, previous: null, heads: {}, files: 3 });
	});

	it('a chain from before: receipt files in a refused increment go again', () => {
		const old = {
			base: BASE,
			sequence: 2,
			previous: 'QmInc2',
			heads: { db: ['h2'] },
			files: ['f1', 'f2', 'f3']
		};
		const back = reconcileChain(/** @type {any} */ (old), [
			inc(1, 'processed'),
			inc(2, 'rejected', 1)
		]);
		expect(back).toMatchObject({ sequence: 1, previous: 'QmInc1', heads: {}, files: ['f1', 'f2'] });
	});

	it('a chain from before that Aleph keeps whole: kept as it stands; one still pending: left alone', () => {
		const old = {
			base: BASE,
			sequence: 1,
			previous: 'QmInc1',
			heads: { db: ['h1'] },
			files: ['f1']
		};
		expect(reconcileChain(/** @type {any} */ (old), [inc(1, 'processed')])?.kept).toEqual({
			sequence: 1,
			previous: 'QmInc1',
			heads: { db: ['h1'] },
			files: 1
		});
		expect(reconcileChain(/** @type {any} */ (old), [inc(1, 'pending')])).toBe(old);
	});
});
