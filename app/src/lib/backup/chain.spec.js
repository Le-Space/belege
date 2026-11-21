// Which chains of backups are older than the one backups go on with (#454):
// each full backup with its increments, from the history; the current chain
// and – without one – the newest kept full backup are never offered, and
// nothing is when no backup is kept at all. Made-up CIDs and sizes.
import { describe, expect, it } from 'vitest';

import {
	CHAIN_SETTING,
	chainAfter,
	chainFilesKey,
	loadChain,
	olderChains,
	reconcileChain,
	refusedIncrement,
	saveChain
} from './chain.js';
import { BACKUPS_KEY } from './history.js';
import { getSetting, setSetting } from '../store/settings.js';

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

	it('moves `kept` with a confirmed increment, and keeps a pending one aside', async () => {
		const one = await chainAfter(
			start(),
			{ heads: { db: ['h1'] }, files: ['f4'] },
			'QmInc1',
			'processed'
		);
		expect(one.kept).toEqual({ sequence: 1, previous: 'QmInc1', heads: { db: ['h1'] }, files: 4 });
		expect(one.pending).toEqual([]);
		const two = await chainAfter(one, { heads: { db: ['h2'] }, files: [] }, 'QmInc2', 'pending');
		expect(two.sequence).toBe(2);
		expect(two.kept).toEqual(one.kept);
		expect(two.pending).toEqual([
			{ sequence: 2, previous: 'QmInc2', heads: { db: ['h2'] }, files: 4, cid: 'QmInc2' }
		]);
		// Aleph confirms it later: kept moves on.
		const later = await reconcileChain(two, [inc(1, 'processed'), inc(2, 'processed')]);
		expect(later?.kept?.sequence).toBe(2);
		expect(later?.pending).toEqual([]);
		// Nothing new: the same chain back.
		expect(
			await reconcileChain(/** @type {any} */ (later), [inc(1, 'processed'), inc(2, 'processed')])
		).toBe(later);
	});

	it('goes back to `kept` when Aleph refuses an increment it first called pending', async () => {
		const one = await chainAfter(
			start(),
			{ heads: { db: ['h1'] }, files: ['f4'] },
			'QmInc1',
			'pending'
		);
		const two = await chainAfter(
			one,
			{ heads: { db: ['h2'] }, files: ['f5'] },
			'QmInc2',
			'pending'
		);
		const back = await reconcileChain(two, [inc(1, 'rejected', 1), inc(2, 'pending', 1)]);
		expect(back).toMatchObject({
			sequence: 0,
			previous: null,
			heads: { db: ['h0'] },
			files: ['f1', 'f2', 'f3'],
			pending: []
		});
	});

	it('a gap a restore cannot cross: refused, then a later one kept – null, a full backup next', async () => {
		const one = await chainAfter(
			start(),
			{ heads: { db: ['h1'] }, files: [] },
			'QmInc1',
			'pending'
		);
		const two = await chainAfter(one, { heads: { db: ['h2'] }, files: [] }, 'QmInc2', 'pending');
		expect(await reconcileChain(two, [inc(1, 'rejected'), inc(2, 'processed')])).toBeNull();
	});

	it('a chain from before: every increment refused or unknown – back to the full backup, with no heads', async () => {
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
		const back = await reconcileChain(/** @type {any} */ (old), history);
		// No heads: the next increment ships every entry again, which a restore merges.
		expect(back).toMatchObject({
			sequence: 0,
			previous: null,
			heads: {},
			files: ['f1', 'f2', 'f3']
		});
		expect(back?.kept).toEqual({ sequence: 0, previous: null, heads: {}, files: 3 });
	});

	it('a chain from before: receipt files in a refused increment go again', async () => {
		const old = {
			base: BASE,
			sequence: 2,
			previous: 'QmInc2',
			heads: { db: ['h2'] },
			files: ['f1', 'f2', 'f3']
		};
		const back = await reconcileChain(/** @type {any} */ (old), [
			inc(1, 'processed'),
			inc(2, 'rejected', 1)
		]);
		expect(back).toMatchObject({ sequence: 1, previous: 'QmInc1', heads: {}, files: ['f1', 'f2'] });
	});

	it('a chain from before that Aleph keeps whole: kept as it stands; one still pending: left alone', async () => {
		const old = {
			base: BASE,
			sequence: 1,
			previous: 'QmInc1',
			heads: { db: ['h1'] },
			files: ['f1']
		};
		expect((await reconcileChain(/** @type {any} */ (old), [inc(1, 'processed')]))?.kept).toEqual({
			sequence: 1,
			previous: 'QmInc1',
			heads: { db: ['h1'] },
			files: 1
		});
		expect(await reconcileChain(/** @type {any} */ (old), [inc(1, 'pending')])).toBe(old);
	});
});

describe('refusedIncrement', () => {
	const inc = (/** @type {Partial<import('./history.js').BackupRecord>} */ b) =>
		row({ kind: 'increment', base: 'QmBase', ...b });
	const full = row({ at: '2026-11-01T10:00:00Z', cid: 'QmBase' });

	it('is the newest increment of the chain when Aleph refused it', () => {
		const refused = inc({
			at: '2026-11-02T10:05:00Z',
			cid: 'QmInc1b',
			sequence: 1,
			status: 'rejected',
			errorCode: 4
		});
		const backups = [
			refused,
			inc({ at: '2026-11-02T10:00:00Z', cid: 'QmInc1a', sequence: 1, status: 'rejected' }),
			full
		];
		expect(refusedIncrement(backups, 'QmBase')).toBe(refused);
	});

	it('counts a refusal for credits the same (no error code)', () => {
		const backups = [
			inc({ at: '2026-11-02T10:00:00Z', cid: 'QmInc1', sequence: 1, status: 'rejected' }),
			full
		];
		expect(refusedIncrement(backups, 'QmBase')?.cid).toBe('QmInc1');
	});

	it('is lifted by a later one Aleph keeps or is still deciding on', () => {
		const refused = inc({
			at: '2026-11-02T10:00:00Z',
			cid: 'QmInc1',
			sequence: 1,
			status: 'rejected'
		});
		for (const status of ['processed', 'pending']) {
			const later = inc({ at: '2026-11-02T11:00:00Z', cid: 'QmInc1c', sequence: 1, status });
			expect(refusedIncrement([later, refused, full], 'QmBase')).toBeNull();
		}
		// The refused one kept again: a second row for the same file.
		const again = inc({ at: '2026-11-02T10:30:00Z', cid: 'QmInc1', sequence: 1 });
		expect(refusedIncrement([again, refused, full], 'QmBase')).toBeNull();
	});

	it('looks only at the chain backups go on with, and only at increments', () => {
		const other = inc({
			at: '2026-11-03T10:00:00Z',
			cid: 'QmOtherInc',
			base: 'QmOther',
			sequence: 1,
			status: 'rejected'
		});
		const kept = inc({ at: '2026-11-02T10:00:00Z', cid: 'QmInc1', sequence: 1 });
		expect(refusedIncrement([other, kept, full], 'QmBase')).toBeNull();
		expect(refusedIncrement([other, kept, full], 'QmOther')).toBe(other);
		// A refused full backup is the chain's block (auto.svelte.js), not this one.
		const refusedFull = row({ at: '2026-11-04T10:00:00Z', cid: 'QmNewBase', status: 'rejected' });
		expect(refusedIncrement([refusedFull], 'QmNewBase')).toBeNull();
		expect(refusedIncrement([full], 'QmBase')).toBeNull();
		expect(refusedIncrement([other], null)).toBeNull();
	});

	it('takes the higher number when two rows have the same time', () => {
		const at = '2026-11-02T10:00:00Z';
		const backups = [
			inc({ at, cid: 'QmInc1', sequence: 1 }),
			inc({ at, cid: 'QmInc2', sequence: 2, status: 'rejected' })
		];
		expect(refusedIncrement(backups, 'QmBase')?.cid).toBe('QmInc2');
	});
});

/**
 * The sealed settings as far as the chain uses them: records by id, a write
 * counted per key, the bytes of each write's value beside it.
 */
function settingsCollection() {
	/** @type {Map<string, any>} */
	const records = new Map();
	/** @type {{ key: string, bytes: number }[]} */
	const writes = [];
	let next = 0;
	const collection = /** @type {any} */ ({
		async list(/** @type {any} */ { where, includeDeleted = false } = {}) {
			return [...records.values()]
				.filter((r) => includeDeleted || !r.deleted)
				.filter((r) => !where || where(r));
		},
		async put(/** @type {any} */ input) {
			const record = { ...input, id: input.id ?? `id${next++}`, deleted: input.deleted ?? false };
			records.set(record.id, record);
			writes.push({ key: record.key, bytes: JSON.stringify(record.value ?? null).length });
			return record;
		}
	});
	return { collection, writes };
}

describe('the chain keeps its receipt files out of its own record (#558)', () => {
	const BASE = 'QmBase';
	const files = Array.from({ length: 200 }, (_, i) => `QmFile${String(i).padStart(40, '0')}`);
	const base = () => ({
		base: BASE,
		sequence: 0,
		previous: null,
		heads: { db: ['h0'] },
		files: files.slice(0, 200),
		kept: { sequence: 0, previous: null, heads: { db: ['h0'] }, files: 200 },
		pending: []
	});
	/** @param {number} seq @param {string} status */
	const inc = (seq, status) =>
		row({
			at: `2026-11-0${seq}T10:00:00Z`,
			cid: `QmInc${seq}`,
			kind: 'increment',
			base: BASE,
			sequence: seq,
			status
		});

	it('writes each backup’s new files once, in a record of its own; the chain’s record stays small', async () => {
		const { collection: settings, writes } = settingsCollection();
		await saveChain(settings, base());
		let chain = /** @type {any} */ (base());
		for (let seq = 1; seq <= 20; seq++) {
			chain = await chainAfter(
				chain,
				{ heads: { db: [`h${seq}`] }, files: [`QmNew${seq}`] },
				`QmInc${seq}`,
				'processed'
			);
			await saveChain(settings, chain);
		}
		// No list of files in the chain's record, however long the chain.
		const stored = await getSetting(settings, CHAIN_SETTING);
		expect(stored).not.toHaveProperty('files');
		const chainWrites = writes.filter((w) => w.key === CHAIN_SETTING);
		expect(chainWrites).toHaveLength(21);
		expect(Math.max(...chainWrites.map((w) => w.bytes))).toBeLessThan(1_000);
		// The full backup's 200 files written once, each increment's one file once.
		expect(writes.filter((w) => w.key === chainFilesKey(BASE, 0))).toHaveLength(1);
		expect(await getSetting(settings, chainFilesKey(BASE, 7))).toEqual(['QmNew7']);
		// Loaded, the chain has them all, in the order shipped.
		const loaded = await loadChain(settings);
		expect(loaded?.sequence).toBe(20);
		expect(loaded?.files).toEqual([
			...files,
			...Array.from({ length: 20 }, (_, i) => `QmNew${i + 1}`)
		]);
	});

	it('a chain gone back leaves out what the refused increment shipped, and the next one under its number writes its own', async () => {
		const { collection: settings } = settingsCollection();
		await saveChain(settings, base());
		const one = await chainAfter(
			base(),
			{ heads: { db: ['h1'] }, files: ['QmNew1'] },
			'QmInc1',
			'processed'
		);
		await saveChain(settings, one);
		const two = await chainAfter(
			one,
			{ heads: { db: ['h2'] }, files: ['QmNew2'] },
			'QmInc2',
			'pending'
		);
		await saveChain(settings, two);
		await setSetting(settings, BACKUPS_KEY, [inc(1, 'processed'), inc(2, 'rejected')]);
		const back = /** @type {any} */ (await loadChain(settings));
		expect(back.sequence).toBe(1);
		expect(back.files).toEqual([...files, 'QmNew1']);
		// Loaded again: the same, from the records.
		expect((await loadChain(settings))?.files).toEqual([...files, 'QmNew1']);
		// The next increment, number 2 again, ships the refused one's file again and another.
		const again = await chainAfter(
			back,
			{ heads: { db: ['h2b'] }, files: ['QmNew2', 'QmNew3'] },
			'QmInc2b',
			'processed'
		);
		await saveChain(settings, again);
		await setSetting(settings, BACKUPS_KEY, [
			inc(1, 'processed'),
			inc(2, 'rejected'),
			row({ ...inc(2, 'processed'), cid: 'QmInc2b', at: '2026-11-03T10:00:00Z' })
		]);
		expect((await loadChain(settings))?.files).toEqual([...files, 'QmNew1', 'QmNew2', 'QmNew3']);
	});

	it('a chain from before carries its files itself: they move into records split by what Aleph kept', async () => {
		const { collection: settings } = settingsCollection();
		const old = {
			base: BASE,
			sequence: 2,
			previous: 'QmInc2',
			heads: { db: ['h2'] },
			files: [...files, 'QmNew1', 'QmNew2'],
			kept: { sequence: 1, previous: 'QmInc1', heads: { db: ['h1'] }, files: 201 },
			pending: [
				{ sequence: 2, previous: 'QmInc2', heads: { db: ['h2'] }, files: 202, cid: 'QmInc2' }
			]
		};
		await setSetting(settings, CHAIN_SETTING, old);
		await setSetting(settings, BACKUPS_KEY, [inc(1, 'processed'), inc(2, 'pending')]);
		expect((await loadChain(settings))?.files).toEqual(old.files);
		expect(await getSetting(settings, CHAIN_SETTING)).not.toHaveProperty('files');
		expect(await getSetting(settings, chainFilesKey(BASE, 1))).toEqual([...files, 'QmNew1']);
		expect(await getSetting(settings, chainFilesKey(BASE, 2))).toEqual(['QmNew2']);
		// Aleph refuses the pending one: back to what it kept, without its file.
		await setSetting(settings, BACKUPS_KEY, [inc(1, 'processed'), inc(2, 'rejected')]);
		expect((await loadChain(settings))?.files).toEqual([...files, 'QmNew1']);
	});

	it('a new full backup clears the lists of the chain before it', async () => {
		const { collection: settings } = settingsCollection();
		await saveChain(settings, base());
		await saveChain(settings, {
			...base(),
			base: 'QmOtherBase',
			files: ['QmOnly']
		});
		expect(await getSetting(settings, chainFilesKey(BASE, 0))).toBeNull();
		expect((await loadChain(settings))?.files).toEqual(['QmOnly']);
	});
});
