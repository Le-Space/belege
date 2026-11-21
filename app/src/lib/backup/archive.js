// A backup of everything the app keeps, as one sealed file (issue #77).
//
// What goes in, block by block, exactly as it lies in this browser's
// blockstore – so a restore puts back the same CIDs, the same signed entries
// and the same writer, and the books open as if they had never left:
//   - the eight OrbitDB databases, through @le-space/orbitdb-storage-bridge's
//     `bundleDatabases`: each log entry (already sealed with the database
//     key), the manifest and access controller, every writer's identity, and
//     the package's metadata naming every database with its heads;
//   - every receipt file (receipts' `fileCid`, deleted ones too, for their log
//     still names them) and every mail kept as received (`emlCid`, #288): the
//     dag-cbor root and its 1 MiB chunks, already sealed with the blob key.
//     Mail receipts are receipt files like any other.
//     The package knows nothing of these; they are walked here.
// A dag-cbor block on top – the CAR's root – holds the package's metadata and
// what Belege adds: the receipt files, the app's version, the date.
//
// The CAR is written by the package (`createCARFromBlocks`) and read back by
// its verifying reader (`restore-cid`), which checks every block against its
// own CID. The whole CAR is sealed once more with the backup key
// (database-keys.js `deriveBackupKey`): a storage service sees one opaque
// file – not how many records there are, nor which are receipts.
//
//   sealed backup = "belegeB2" ‖ the storage bridge's envelope in frames
//
// In frames (#512, `backends/frames`): the CAR in pieces of 1 MiB, each
// sealed by itself with AES-256-GCM under a key of this one file's (HKDF from
// the backup key and a salt), its place in the file in the nonce and in what
// is authenticated with it, the last one marked as last, and a key check in
// front. So a restore opens the file as it arrives – a frame, its blocks into
// the blockstore, the next frame – and holds a frame and a block, not the
// backup three times over, which a phone's browser tab does not survive. A
// frame left out, moved or altered, and a file cut short, are refused at
// that frame; a wrong key before the first one. The manifest is the CAR's
// first block: whose backup this is, is known before the rest is stored.
//
// Backups made before are sealed in one piece,
//
//   "belegeB1" ‖ nonce ‖ AES-GCM(CAR)
//
// and still restore. They can only be opened whole – one tag at the end of
// the file vouches for all of it – so they need the memory they always did.
//
// No block is read from the network: a receipt file's block this browser
// lacks is counted as missing, never fetched, and a backup with missing blocks
// says so.
//
// Increments (#454). A full backup is the base of a chain; after it, a backup
// holds only what is new: through the storage bridge's `collectIncrement`
// (`/live-backup`), the log entries no backup of the chain had – walked from
// each database's heads down to the heads the chain last shipped – with every
// changed database's manifest, access controller and writers' identities, and
// the receipt files the chain has not got yet. Its root is the storage
// bridge's increment manifest (`kind: "increment"`, `base`, `sequence`,
// `previous`); a block of Belege's own beside it names the files and the app's
// version. Sealed the same way, so Aleph sees one more opaque file. Restoring
// is the base and its increments together (`mergeIncrements`): every block of
// all of them, each database joined at the heads of all of them; a chain with
// a hole is refused, it would join heads onto entries nobody has.

import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import { sealer } from '../db-encryption.js';

/** What a backup sealed in one piece starts with: those made before #512. */
export const MAGIC = new TextEncoder().encode('belegeB1');
/** What a backup sealed in frames starts with; also what its frames are bound to. */
export const MAGIC_FRAMED = new TextEncoder().encode('belegeB2');
const FORMAT = 2;

/** @param {Uint8Array} bytes @param {Uint8Array} magic */
const startsWith = (bytes, magic) =>
	bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/**
 * @typedef {object} BackupManifest
 * @property {'belege-backup'} kind
 * @property {number} v
 * @property {string} createdAt ISO
 * @property {string} appVersion
 * @property {any} metadata the storage bridge's: `databases` [{ name, address, type, manifestCID, entryCount, heads }]
 * @property {string[]} files receipt files' root CIDs it carries whole (a file lacking blocks here is left out, #558)
 * @property {number} fileBlocks the receipt files' blocks in the backup
 * @property {number} missing receipt-file blocks this browser did not have
 */

/**
 * @typedef {{ stage: 'database', index: number, total: number, name: string, entries: number }
 *   | { stage: 'files', done: number, total: number }
 *   | { stage: 'sealing', bytes: number }} BackupProgress
 */

/** @param {any} got @returns {Promise<Uint8Array>} */
async function collect(got) {
	const value = await got;
	if (value instanceof Uint8Array) return value;
	/** @type {Uint8Array[]} */
	const parts = [];
	for await (const part of value) parts.push(part);
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * The receipt files' blocks, from this browser only. A file goes in only
 * whole – its root and every chunk here (#558): a device that has a receipt
 * by sync before its file's blocks arrived has the file in `incomplete`, and
 * none of its blocks go along. The chain counts only `complete` ones as
 * shipped, so the next increment tries the others again.
 *
 * @param {any} blockstore Helia's blockstore
 * @param {string[]} files root CIDs
 * @param {(done: number) => void} [onFile]
 * @returns {Promise<{ blocks: Map<string, { cid: CID, bytes: Uint8Array }>, missing: number,
 *   complete: string[], incomplete: string[] }>} `missing`: the blocks this browser lacked
 */
export async function fileBlocks(blockstore, files, onFile) {
	/** @type {Map<string, { cid: CID, bytes: Uint8Array }>} */
	const blocks = new Map();
	let missing = 0;
	/** @type {string[]} */
	const complete = [];
	/** @type {string[]} */
	const incomplete = [];
	for (const [i, file] of files.entries()) {
		/** This file's blocks, put with the others once all of them are here. */
		/** @type {Map<string, { cid: CID, bytes: Uint8Array }>} */
		const own = new Map();
		let lacking = 0;
		/** @param {CID} cid */
		const take = async (cid) => {
			const name = cid.toV1().toString();
			const had = blocks.get(name) ?? own.get(name);
			if (had) return had.bytes;
			const bytes = await collect(blockstore.get(cid, { offline: true })).catch(() => undefined);
			if (!bytes) {
				lacking++;
				return undefined;
			}
			own.set(name, { cid, bytes });
			return bytes;
		};
		const root = await take(CID.parse(file));
		if (root) {
			/** @type {any} */
			const value = dagCbor.decode(root);
			for (const chunk of Array.isArray(value?.chunks) ? value.chunks : []) {
				await take(CID.asCID(chunk) ?? CID.parse(String(chunk)));
			}
		}
		if (lacking === 0) {
			for (const [name, block] of own) blocks.set(name, block);
			complete.push(file);
		} else {
			missing += lacking;
			incomplete.push(file);
		}
		onFile?.(i + 1);
	}
	return { blocks, missing, complete, incomplete };
}

/**
 * "belegeB2" ‖ the CAR sealed in frames. The whole file is made in memory, as
 * the upload wants its body whole; it is the restore that opens it in pieces.
 *
 * @param {Uint8Array} car @param {Uint8Array} backupKey
 */
async function seal(car, backupKey) {
	const { sealFramed } = await import('@le-space/orbitdb-storage-bridge/backends/frames');
	const sealed = await sealFramed(car, { key: backupKey, context: MAGIC_FRAMED });
	const out = new Uint8Array(MAGIC_FRAMED.length + sealed.length);
	out.set(MAGIC_FRAMED, 0);
	out.set(sealed, MAGIC_FRAMED.length);
	return out;
}

/**
 * The blocks with the manifest in front: a restore that reads the file as it
 * arrives knows whose backup it is before it stores the rest.
 *
 * @param {Map<string, any>} blocks @param {string} root
 * @returns {Map<string, any>}
 */
function rootFirst(blocks, root) {
	if (!blocks.has(root)) return blocks;
	const ordered = new Map([[root, blocks.get(root)]]);
	for (const [name, block] of blocks) if (name !== root) ordered.set(name, block);
	return ordered;
}

/**
 * Every receipt file the books name: receipts' files, mails kept as received
 * and e-invoice XML, deleted receipts' too, for their log still names them.
 *
 * @param {import('../store/repository.js').Collection} receipts
 */
async function receiptFiles(receipts) {
	return [
		...new Set(
			(await receipts.list({ includeDeleted: true }))
				.flatMap((r) => [r.fileCid, r.emlCid, r.xmlCid])
				.filter((c) => typeof c === 'string' && c)
		)
	];
}

/** What the collection of a collection's access list is called in a backup. */
export const ACCESS_LIST = 'access:';

/**
 * The collections with their access lists in front (store/books-access.js):
 * who may write is in a database of its own, which a backup has to carry –
 * without it, a restore on a device that never saw the list refuses every
 * entry a member wrote ("not allowed to write to the log"). In front, so a
 * restore reads them first. A list two collections share goes once.
 *
 * @param {Record<string, any>} databases
 * @returns {Record<string, any>}
 */
export function withAccessLists(databases) {
	/** @type {Record<string, any>} */
	const lists = {};
	const seen = new Set();
	for (const [collection, database] of Object.entries(databases)) {
		const list = database?.access?.listDatabase?.();
		if (!list || seen.has(String(list.address))) continue;
		seen.add(String(list.address));
		lists[`${ACCESS_LIST}${collection}`] = list;
	}
	return { ...lists, ...databases };
}

/**
 * Build and seal a backup.
 *
 * @param {object} params
 * @param {Record<string, any>} params.databases the opened OrbitDB databases, by collection
 * @param {any} params.blockstore Helia's blockstore
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {Uint8Array} params.key the backup key
 * @param {string} params.appVersion
 * @param {() => Date} [params.now]
 * @param {(progress: BackupProgress) => void} [params.onProgress]
 * @returns {Promise<{ sealed: Uint8Array, manifest: BackupManifest, blocks: number, carBytes: number }>}
 */
export async function buildBackup({
	databases,
	blockstore,
	receipts,
	key: backupKey,
	appVersion,
	now = () => new Date(),
	onProgress
}) {
	const at = now();
	databases = withAccessLists(databases);
	// Loaded here, not at the top: only the page that backs up needs this code.
	const { bundleDatabases } = await import('@le-space/orbitdb-storage-bridge/extract-blocks');
	const { createCARFromBlocks } = await import('@le-space/orbitdb-storage-bridge/backup-car');

	const { blocks, metadata } = await bundleDatabases(databases, {
		timestamp: at.getTime(),
		onProgress: (p) =>
			onProgress?.({
				stage: 'database',
				index: p.index,
				total: p.total,
				// The collection, as the app names it, not the derived database name.
				name: Object.keys(databases)[p.index] ?? p.name,
				entries: p.entries
			})
	});
	// The package's names are the derived ones; the app's own go beside them.
	/** @type {any} */ (metadata).databases.forEach(
		(/** @type {any} */ d, /** @type {number} */ i) => {
			d.collection = Object.keys(databases)[i];
		}
	);

	const named = await receiptFiles(receipts);
	onProgress?.({ stage: 'files', done: 0, total: named.length });
	// Only whole files go in, and only they are named: the chain takes them as
	// shipped (chain.js), and the next increment tries the others again.
	const {
		blocks: own,
		missing,
		complete: files
	} = await fileBlocks(blockstore, named, (done) =>
		onProgress?.({ stage: 'files', done, total: named.length })
	);
	for (const [name, block] of own) if (!blocks.has(name)) blocks.set(name, block);

	/** @type {BackupManifest} */
	const manifest = {
		kind: 'belege-backup',
		v: FORMAT,
		createdAt: at.toISOString(),
		appVersion,
		metadata,
		files,
		fileBlocks: own.size,
		missing
	};
	const root = dagCbor.encode(manifest);
	const rootCid = CID.createV1(dagCbor.code, await sha256.digest(root));
	blocks.set(rootCid.toString(), { cid: rootCid, bytes: root });

	const car = await createCARFromBlocks(rootFirst(blocks, rootCid.toString()), rootCid.toString());
	onProgress?.({ stage: 'sealing', bytes: car.length });
	return {
		sealed: await seal(car, backupKey),
		manifest,
		blocks: blocks.size,
		carBytes: car.length
	};
}

/**
 * Where a chain of backups stands: the full backup it starts from, the last
 * increment, the heads each database had when last shipped and the receipt
 * files shipped so far (backup/chain.js keeps it in the sealed settings).
 *
 * @typedef {object} BackupChain
 * @property {string} base the full backup's CID
 * @property {number} sequence of the last increment; 0 right after the base
 * @property {string | null} previous the last increment's CID
 * @property {Record<string, string[]>} heads by database address
 * @property {string[]} files receipt files' root CIDs the chain has shipped whole, in the order shipped;
 *   not in the chain's record but one per backup of it (chain.js CHAIN_FILES_PREFIX, #558)
 * @property {ChainPoint} [kept] how far Aleph has confirmed it keeps the chain (chain.js);
 *   absent in a chain from before
 * @property {(ChainPoint & { cid: string })[]} [pending] increments shipped after `kept` that
 *   Aleph has not confirmed yet, oldest first
 */

/**
 * A point of a chain to go back to: what had been shipped up to an increment.
 *
 * @typedef {object} ChainPoint
 * @property {number} sequence
 * @property {string | null} previous that increment's CID; null at the full backup
 * @property {Record<string, string[]>} heads
 * @property {number} files how many of the chain's `files` had been shipped
 */

/**
 * What the chain has shipped of a database, by the heads it shipped last,
 * kept for the session (#558): walking a whole log costs one read per entry,
 * and a chain that backs up by itself would pay that for every increment.
 * Each increment adds its own entries under its new heads; a walk is needed
 * only for heads not seen here – the first run, or a chain gone back. By the
 * database object, so books closed take theirs along; two sets per database,
 * the heads before and after the last increment.
 *
 * @type {WeakMap<object, Map<string, Set<string>>>}
 */
const shippedSets = new WeakMap();

/** @param {string[]} heads */
const headsKey = (heads) => [...heads].sort().join(' ');

/** @param {any} database @param {string[]} heads @param {Set<string>} set */
function rememberShipped(database, heads, set) {
	const known = shippedSets.get(database) ?? new Map();
	known.delete(headsKey(heads));
	known.set(headsKey(heads), set);
	while (known.size > 2) known.delete(/** @type {string} */ (known.keys().next().value));
	shippedSets.set(database, known);
}

/**
 * Every log entry reachable from these heads, as known for the session or walked.
 *
 * @param {any} database @param {string[]} heads
 */
async function shippedOf(database, heads) {
	const known = shippedSets.get(database)?.get(headsKey(heads));
	if (known) return known;
	const set = await reachable(database, heads);
	rememberShipped(database, heads, set);
	return set;
}

/**
 * Every log entry reachable from these heads: what the chain has shipped.
 *
 * @param {any} database @param {string[]} heads
 */
async function reachable(database, heads) {
	/** @type {Set<string>} */
	const seen = new Set();
	const stack = [...heads];
	while (stack.length) {
		const hash = /** @type {string} */ (stack.pop());
		if (seen.has(hash)) continue;
		seen.add(hash);
		const entry = await database.log.get(hash).catch(() => null);
		if (entry?.next) stack.push(...entry.next);
	}
	return seen;
}

/**
 * Build and seal what is new since the chain's last backup: the increment.
 * `null` when nothing is – or only settings, which every backup writes itself.
 *
 * @param {object} params
 * @param {Record<string, any>} params.databases the opened OrbitDB databases, by collection
 * @param {any} params.blockstore Helia's blockstore
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {Uint8Array} params.key the backup key
 * @param {BackupChain} params.chain
 * @param {string} params.appVersion
 * @param {() => Date} [params.now]
 * @param {(progress: BackupProgress) => void} [params.onProgress]
 * @returns {Promise<null | { sealed: Uint8Array, manifest: any, heads: Record<string, string[]>,
 *   files: string[], entries: number, databases: { collection: string, entries: number }[],
 *   blocks: number, missing: number, carBytes: number }>}
 */
export async function buildIncrement({
	databases,
	blockstore,
	receipts,
	key: backupKey,
	chain,
	appVersion,
	now = () => new Date(),
	onProgress
}) {
	const { collectIncrement } = await import('@le-space/orbitdb-storage-bridge/live-backup');
	const { createCARFromBlocks } = await import('@le-space/orbitdb-storage-bridge/backup-car');
	// A chain begun before the lists went along ships them whole with its next increment.
	databases = withAccessLists(databases);

	/** @type {Map<string, { database: any, shipped: Set<string>, collection: string }>} */
	const watched = new Map();
	const names = Object.keys(databases);
	for (const [index, [collection, database]] of Object.entries(databases).entries()) {
		const address = String(database.address);
		const since = chain.heads[address] ?? [];
		// Only read from by the storage bridge: the session's set itself.
		const shipped = await shippedOf(database, since);
		// The storage bridge reads the heads it continues from off the set.
		/** @type {any} */ (shipped).heads = since;
		watched.set(address, { database, shipped, collection });
		onProgress?.({
			stage: 'database',
			index,
			total: names.length,
			name: collection,
			entries: shipped.size
		});
	}

	const had = new Set(chain.files);
	const wanted = (await receiptFiles(receipts)).filter((f) => !had.has(f));
	onProgress?.({ stage: 'files', done: 0, total: wanted.length });
	// A file whose blocks are not all here yet stays out, and is tried again
	// with the next increment (#558); only whole files count as shipped.
	const {
		blocks: own,
		missing,
		complete: files
	} = await fileBlocks(blockstore, wanted, (done) =>
		onProgress?.({ stage: 'files', done, total: wanted.length })
	);
	// Belege's word on it, beside the storage bridge's manifest.
	const info = dagCbor.encode({ kind: 'belege-increment', v: 1, appVersion, files, missing });
	const infoCid = CID.createV1(dagCbor.code, await sha256.digest(info));
	own.set(infoCid.toString(), { cid: infoCid, bytes: info });

	const increment = await collectIncrement(watched, {
		sequence: chain.sequence + 1,
		base: chain.base,
		previous: chain.previous,
		blocks: own,
		now
	});
	// Every backup writes the settings (its history, the chain): new settings
	// alone are no reason for an increment – they go with the next one.
	const changed = /** @type {any} */ (increment?.manifest.metadata)?.databases?.some(
		(/** @type {any} */ d) => d.collection !== 'settings' && d.entries > 0
	);
	if (!increment || (!changed && files.length === 0)) return null;

	/** @type {Record<string, string[]>} */
	const heads = { ...chain.heads };
	for (const [address, shipped] of increment.shipped) {
		heads[address] = shipped.heads;
		// What the chain will have shipped once this one is kept: the next run
		// starts from there without a walk.
		const before = watched.get(address);
		if (before) {
			const after = new Set(before.shipped);
			for (const hash of shipped.hashes) after.add(hash);
			rememberShipped(before.database, shipped.heads, after);
		}
	}
	const car = await createCARFromBlocks(
		rootFirst(increment.blocks, String(increment.root)),
		increment.root
	);
	onProgress?.({ stage: 'sealing', bytes: car.length });
	return {
		sealed: await seal(car, backupKey),
		manifest: increment.manifest,
		heads,
		files,
		entries: increment.entries,
		databases: /** @type {any} */ (increment.manifest.metadata).databases
			.map((/** @type {any} */ d) => ({
				collection: String(d.collection ?? d.name),
				entries: Number(d.entries ?? 0)
			}))
			// The access lists go along, but are not what the person backed up.
			.filter((/** @type {{ collection: string }} */ d) => !d.collection.startsWith(ACCESS_LIST)),
		blocks: increment.blocks.size,
		missing,
		carBytes: car.length
	};
}

/** A block's value when it is a backup's manifest – a full one's or an increment's. */
function manifestIn(/** @type {Uint8Array} */ bytes) {
	/** @type {any} */
	let value;
	try {
		value = dagCbor.decode(bytes);
	} catch {
		return null;
	}
	return value?.kind === 'belege-backup' || value?.kind === 'increment' ? value : null;
}

/**
 * Open a sealed backup whole – a full one or an increment, in frames or in
 * one piece: every block checked against its own CID, and the manifest found
 * among them (`kind` `belege-backup` or `increment`). All of it in memory:
 * for a backup read without OrbitDB (`readEarlierBackup`) and for tests. A
 * restore opens it as it arrives (`restoreBackup`).
 *
 * @param {Uint8Array} sealed
 * @param {Uint8Array} backupKey
 * @returns {Promise<{ manifest: BackupManifest, blocks: Map<string, { bytes: Uint8Array }> }>}
 */
export async function openBackup(sealed, backupKey) {
	/** @type {Uint8Array} */
	let car;
	if (startsWith(sealed, MAGIC_FRAMED)) {
		const { openFramed } = await import('@le-space/orbitdb-storage-bridge/backends/frames');
		car = await openFramed(sealed.subarray(MAGIC_FRAMED.length), {
			key: backupKey,
			context: MAGIC_FRAMED
		});
	} else if (startsWith(sealed, MAGIC)) {
		car = await (await sealer(backupKey)).open(sealed.subarray(MAGIC.length));
	} else {
		throw new Error('Not a belege backup.');
	}
	const { readBlocksFromCAR } = await import('@le-space/orbitdb-storage-bridge/restore-cid');
	const blocks = await readBlocksFromCAR(car, { verify: true });
	// The manifest is the one dag-cbor block that says so; the blocks are verified.
	for (const [name, { bytes }] of blocks) {
		if (CID.parse(name).code !== dagCbor.code) continue;
		const manifest = manifestIn(bytes);
		if (manifest) return { manifest, blocks };
	}
	throw new Error('Not a belege backup.');
}

/** Thrown when an increment is restored without the full backup it builds on. */
export class IncrementWithoutBaseError extends Error {
	constructor() {
		super('This is an increment: restore the full backup it builds on, with its increments.');
		this.name = 'IncrementWithoutBaseError';
	}
}

/** Thrown when increments of a chain are missing: their heads would join onto entries nobody has. */
export class ChainGapError extends Error {
	/** @param {number[]} missing sequence numbers */
	constructor(missing) {
		super(`Increments of this backup are missing: ${missing.join(', ')}.`);
		this.name = 'ChainGapError';
		this.missing = missing;
	}
}

/** Thrown when the backup cannot be opened with this passkey's key. */
export class WrongPasskeyError extends Error {
	constructor() {
		super('This backup cannot be opened with this passkey.');
		this.name = 'WrongPasskeyError';
	}
}

/**
 * What a restore is doing: `opened` and `stored` while a file arrives (frames
 * opened and their plaintext bytes in this file; blocks in the blockstore and
 * their bytes over all files), `joining` once every file is in, `database`
 * for each one joined. Bytes fetched are the source's to say.
 *
 * @typedef {{ stage: 'opening' }
 *   | { stage: 'opened', frames: number, bytes: number }
 *   | { stage: 'stored', blocks: number, bytes: number }
 *   | { stage: 'joining' }
 *   | { stage: 'database', index: number, total: number, name: string, joined: number }} RestoreProgress
 */

/**
 * A sealed file for a restore: its bytes, a stream of them, or a function
 * that starts one – which is what keeps a second file from being fetched
 * before the first is stored, and lets a file be asked for again.
 *
 * @typedef {Uint8Array | AsyncIterable<Uint8Array> | (() => AsyncIterable<Uint8Array> | Uint8Array)} SealedSource
 */

/** @param {SealedSource} source @returns {AsyncIterable<Uint8Array>} */
function streamOf(source) {
	const value = typeof source === 'function' ? source() : source;
	if (!(value instanceof Uint8Array)) return value;
	return (async function* () {
		yield value;
	})();
}

/** A sealed file whole, for the ways that need it so. @param {SealedSource} source */
export async function bytesOf(source) {
	const value = typeof source === 'function' ? source() : source;
	return value instanceof Uint8Array ? value : collect(value);
}

/** A wrong key, as either format says it: AES-GCM's refusal, or the frames' key check. */
const isWrongKey = (/** @type {unknown} */ error) =>
	error instanceof Error &&
	(error.name === 'OperationError' ||
		(error.name === 'FrameError' && /** @type {any} */ (error).reason === 'wrong-key'));

/** Thrown inside a file's reading to leave it: an increment of another chain. */
const NOT_OF_THIS_CHAIN = Symbol('not of this chain');

/**
 * One sealed file into the blockstore: opened as it arrives when it is in
 * frames – a frame, its blocks stored, the next frame – and whole when it is
 * in one piece, which cannot be opened otherwise. Either way its blocks are
 * checked against their CIDs, and only their names are kept (`into`).
 *
 * `onManifest` sees the file's manifest before any of its blocks is stored
 * (it is the first block of a file in frames) and may throw to refuse the
 * file; `NOT_OF_THIS_CHAIN` leaves it without an error.
 *
 * @param {object} params
 * @param {any} params.blockstore
 * @param {SealedSource} params.source
 * @param {Uint8Array} params.key
 * @param {any} params.into the storage bridge's `StoredBlocks`, or undefined for the first file
 * @param {(manifest: any) => void | Promise<void>} params.onManifest
 * @param {(progress: RestoreProgress) => void} [params.onProgress]
 * @returns {Promise<{ manifest: any, stored: any, framed: boolean } | null>} null for a file left
 */
async function storeSealed({ blockstore, source, key, into, onManifest, onProgress }) {
	const [{ ByteQueue, openFrames }, { storeBlocks, storeBlocksFromCAR }] = await Promise.all([
		import('@le-space/orbitdb-storage-bridge/backends/frames'),
		import('@le-space/orbitdb-storage-bridge/restore-cid')
	]);
	const chunks = streamOf(source)[Symbol.asyncIterator]();
	try {
		// Which format it is, is in its first eight bytes.
		const start = new ByteQueue();
		let ended = false;
		while (!ended && start.length < MAGIC.length) {
			const { done, value } = await chunks.next();
			if (done) ended = true;
			else start.push(value);
		}
		const first = start.take(start.length);
		const rest = (async function* () {
			if (first.length > MAGIC.length) yield first.subarray(MAGIC.length);
			if (!ended) yield* { [Symbol.asyncIterator]: () => chunks };
		})();

		/** @type {any} */
		let manifest = null;
		if (startsWith(first, MAGIC_FRAMED)) {
			const stored = await storeBlocksFromCAR(
				blockstore,
				openFrames(rest, { key, context: MAGIC_FRAMED, onProgress }),
				{
					into,
					onProgress,
					onBlock: async (
						/** @type {{ cid: CID, bytes: Uint8Array }} */ block,
						/** @type {{ roots: CID[] }} */ { roots }
					) => {
						if (manifest || !roots.some((root) => root.equals(block.cid))) return;
						const value = manifestIn(block.bytes);
						if (!value) return;
						await onManifest(value);
						manifest = value;
					}
				}
			);
			if (!manifest) throw new Error('Not a belege backup.');
			return { manifest, stored, framed: true };
		}
		if (!startsWith(first, MAGIC)) throw new Error('Not a belege backup.');
		// In one piece: all of it, then all of its plaintext, as before.
		const whole = [first];
		for await (const chunk of { [Symbol.asyncIterator]: () => chunks }) whole.push(chunk);
		const opened = await openBackup(whole.length === 1 ? first : await collect(whole), key);
		whole.length = 0;
		await onManifest(opened.manifest);
		const stored = await storeBlocks(
			blockstore,
			(function* () {
				for (const [name, { bytes }] of opened.blocks) yield { cid: CID.parse(name), bytes };
			})(),
			{ into, onProgress }
		);
		return { manifest: opened.manifest, stored, framed: false };
	} catch (error) {
		if (error === NOT_OF_THIS_CHAIN) return null;
		if (isWrongKey(error)) throw new WrongPasskeyError();
		throw error;
	} finally {
		// Left early or failed: let the download go.
		await chunks.return?.();
	}
}

/**
 * A full backup opened with `key`, its increments merged into it, all of it
 * in memory: the manifest, every block, and the databases' metadata. For a
 * backup read without OrbitDB (`readEarlierBackup`), and for one whose
 * metadata names no heads; a restore otherwise stores as it reads (`storeChain`).
 *
 * @param {{ sealed: SealedSource, increments?: SealedSource[], base?: string, key: Uint8Array }} params
 */
async function openChain({ sealed, increments = [], base, key }) {
	/** @param {SealedSource} source */
	const unseal = async (source) => {
		try {
			return await openBackup(await bytesOf(source), key);
		} catch (error) {
			// A foreign file is "Not a belege backup."
			if (isWrongKey(error)) throw new WrongPasskeyError();
			throw error;
		}
	};
	const opened = await unseal(sealed);
	if (/** @type {any} */ (opened.manifest).kind === 'increment')
		throw new IncrementWithoutBaseError();
	const manifest = opened.manifest;
	let blocks = opened.blocks;
	let metadata = /** @type {any} */ (manifest.metadata);
	if (increments.length) {
		const chain = [];
		for (const bytes of increments) {
			const inc = /** @type {any} */ (await unseal(bytes));
			if (inc.manifest.kind !== 'increment' || (base && inc.manifest.base !== base)) continue;
			chain.push(inc);
		}
		const { mergeIncrements } = await import('@le-space/orbitdb-storage-bridge/live-backup');
		const merged = /** @type {any} */ (
			mergeIncrements({ base: { metadata, blocks }, increments: chain })
		);
		assertNoGap(merged);
		blocks = merged.blocks;
		metadata = merged.metadata;
	}
	return { manifest, blocks, metadata };
}

/** The increments a chain lacks, by what `mergeIncrements` found. @param {any} merged */
function assertNoGap(merged) {
	const missing = [...merged.gaps];
	const first = merged.sequences[0];
	if (first !== undefined) for (let s = 1; s < first; s++) missing.push(s);
	if (missing.length) throw new ChainGapError(missing.sort((a, b) => a - b));
}

/**
 * A full backup and its increments into the blockstore, one file after the
 * other, each as it arrives (`storeSealed`): what `openChain` does, without
 * holding the blocks. What comes back is their names and the chain's
 * metadata; nothing is joined yet.
 *
 * The full backup's manifest is shown to `fits` before a block of it is
 * stored. An increment that is not this base's is left at its manifest; one
 * in one piece is read whole first, as it must be.
 *
 * @param {object} params
 * @param {any} params.blockstore
 * @param {SealedSource} params.sealed
 * @param {SealedSource[]} [params.increments]
 * @param {string} [params.base]
 * @param {Uint8Array} params.key
 * @param {(manifest: any) => void} params.fits
 * @param {(progress: RestoreProgress) => void} [params.onProgress]
 */
async function storeChain({ blockstore, sealed, increments = [], base, key, fits, onProgress }) {
	const full = await storeSealed({
		blockstore,
		source: sealed,
		key,
		into: undefined,
		onProgress,
		onManifest: (manifest) => {
			if (manifest.kind === 'increment') throw new IncrementWithoutBaseError();
			fits(manifest);
		}
	});
	if (!full) throw new Error('Not a belege backup.');
	const { manifest, stored } = full;
	let metadata = /** @type {any} */ (manifest.metadata);
	let streamed = full.framed;
	if (increments.length) {
		const chain = [];
		for (const source of increments) {
			const inc = await storeSealed({
				blockstore,
				source,
				key,
				into: stored,
				onProgress,
				onManifest: (m) => {
					if (m.kind !== 'increment' || (base && m.base !== base)) throw NOT_OF_THIS_CHAIN;
				}
			});
			if (!inc) continue;
			streamed &&= inc.framed;
			chain.push({ manifest: inc.manifest });
		}
		const { mergeIncrements } = await import('@le-space/orbitdb-storage-bridge/live-backup');
		// The metadata alone: the blocks are in the blockstore already.
		const merged = /** @type {any} */ (mergeIncrements({ base: { metadata }, increments: chain }));
		assertNoGap(merged);
		metadata = merged.metadata;
	}
	return { manifest, stored, metadata, streamed };
}

/**
 * The access lists of a backup into this browser, before the collections:
 * each opened (sealed like the books, store/books-access.js) and joined at
 * the heads the backup names. Their entries are already in the blockstore,
 * which the log reads through. The list's own controller lets only the books'
 * identity write to it, so a joined grant is the books' own word.
 *
 * @param {any} orbitdb
 * @param {any[]} lists the backup's metadata of the lists
 * @param {any} encryption the books' sealing
 * @param {(message: string) => void} warn
 */
async function joinAccessLists(orbitdb, lists, encryption, warn) {
	for (const list of lists) {
		const db = await orbitdb.open(String(list.address), {
			type: list.type ?? 'keyvalue',
			encryption
		});
		try {
			for (const head of Array.isArray(list.heads) ? list.heads : []) {
				const hash = String(head);
				// Sealed, its entry hides which database it is of: the log reads it
				// through the blockstore, where the backup's blocks already are.
				const entry = await db.log.get(hash).catch(() => undefined);
				if (!entry) {
					warn(`could not join head ${hash.slice(0, 12)}…: the access list's entry is missing`);
					continue;
				}
				await db.log
					.joinEntry(entry)
					.catch((/** @type {any} */ error) =>
						warn(`could not join head ${hash.slice(0, 12)}…: ${error.message}`)
					);
			}
		} finally {
			await db.close();
		}
	}
}

/**
 * A set of databases a backup may go back into. With `names` and `resolve`,
 * a set whose addresses depend on who wrote it (#555): the databases a
 * passkey wrote before the books' own identity (#496) carry that passkey's
 * DID in their access controller, and a backup of them may be restored under
 * a later passkey or the recovery words, whose DID is another. Such a set
 * fits a backup by its databases' names; its writer is then read from the
 * backup's own access controller, and `resolve` gives the addresses and
 * options for it – which must name every database the backup holds.
 *
 * @typedef {{ name: string, addresses: Record<string, string>, open: Record<string, any>,
 *   names?: Record<string, string>,
 *   resolve?: (writer: string) => Promise<{ addresses: Record<string, string>, open: Record<string, any> }> }} RestoreTarget
 */

/**
 * The writer a database's access controller names, from the backup's blocks
 * (#555): the database's manifest (its address), then its access controller's
 * (`/ipfs/<cid>`), whose `write` list names exactly one writer for the books'
 * databases. Null when the blocks do not say so plainly.
 *
 * @param {string} address `/orbitdb/<cid>`
 * @param {(cid: CID) => Promise<Uint8Array | undefined>} read
 * @returns {Promise<string | null>}
 */
export async function writerOf(address, read) {
	try {
		const manifestCid = CID.parse(String(address).replace(/^\/orbitdb\//, ''));
		const manifestBytes = await read(manifestCid);
		if (!manifestBytes) return null;
		const manifest = /** @type {any} */ (dagCbor.decode(manifestBytes));
		const ac = String(manifest?.accessController ?? '');
		if (!ac.startsWith('/ipfs/')) return null;
		const acBytes = await read(CID.parse(ac.slice('/ipfs/'.length)));
		if (!acBytes) return null;
		const write = /** @type {any} */ (dagCbor.decode(acBytes))?.write;
		return Array.isArray(write) && write.length === 1 && typeof write[0] === 'string' && write[0]
			? write[0]
			: null;
	} catch {
		return null;
	}
}

/**
 * Put a backup back into this browser's books.
 *
 * As it arrives (#512): each sealed file – the full backup, then its
 * increments – is opened frame by frame and its blocks go into the blockstore
 * as they are read (`storeChain`), the receipt files' with them. Then the
 * databases go back through the storage bridge's `restoreFromStoredBlocks`:
 * each reopened and its heads joined. Joining merges: books already here
 * stay, and what the backup holds is added – nothing is deleted.
 *
 * What is refused, and when:
 *   - a backup of another passkey (`WrongPasskeyError`) before a block is stored;
 *   - one whose databases are not these books', at its manifest, the first
 *     block of a backup in frames – before a block is stored;
 *   - a file that is damaged or cut short, at the frame (`FrameError`, with
 *     the frame's index): nothing was joined, the books are as they were.
 *     The blocks stored until then stay in the blockstore, sealed and pointed
 *     at by nothing;
 *   - a browser without room, at the block it refused (`BlocksNotStoredError`).
 *
 * The backup must be this passkey's: its key opens it, and every database it
 * names must be one of these books (same address). The books have two sets of
 * databases: the sealed ones, and those before the replication layer
 * (store/migrate.js), which a backup made earlier holds. `targets` names both;
 * the backup goes back into the set it was made of, with that set's `open`
 * options, and the result says which (`target`). The open databases are closed
 * by the storage bridge and reopened behind the store's back, so the caller
 * reloads the page afterwards.
 *
 * With `increments`, the full backup's increments go back with it: each one
 * this base's (`base`, its CID), the chain without a hole (`ChainGapError`).
 *
 * A backup sealed in one piece (made before #512) is read whole, as it must
 * be, and then goes the same way.
 *
 * @param {object} params
 * @param {any} params.orbitdb
 * @param {SealedSource} params.sealed the full backup: its bytes, a stream of them, or
 *   a function that starts one
 * @param {SealedSource[]} [params.increments] its increments, sealed, in any order; given as
 *   functions, each is asked for only when the one before is stored
 * @param {string} [params.base] the full backup's CID, which its increments name
 * @param {Uint8Array} params.key the backup key
 * @param {RestoreTarget[]} params.targets
 *   each set of databases: its addresses by collection, and what `orbitdb.open` needs for it
 * @param {((cid: string) => Promise<Uint8Array>)} [params.fetchBytes] where a head
 *   the backup does not carry may still be found – Aleph's gateway, as the card
 *   already uses it for the archive itself
 * @param {(progress: RestoreProgress) => void} [params.onProgress]
 * @param {any} [params.listEncryption] how the books' access lists are sealed
 *   (store/books-access.js); the target's sealing when not given
 * @param {() => Promise<void>} [params.beforeRestore] runs once the backup opened
 *   with this key, fits these books and is wholly in the blockstore – where the
 *   caller closes its databases. A backup that does not fit, or that the browser
 *   has no room for, throws before this and leaves them open
 * @returns {Promise<{ manifest: BackupManifest, target: string, writer?: string, increments: number, streamed: boolean,
 *   blocks: number, databases: { collection: string, joined: number, entries: number | null }[] }>}
 *   `streamed`: every file was in frames, so none was held whole; `writer`: the
 *   writer read from the backup, when the target fitted by its names (#555)
 */
export async function restoreBackup({
	orbitdb,
	sealed,
	increments = [],
	base,
	key,
	targets,
	onProgress,
	beforeRestore,
	listEncryption,
	fetchBytes
}) {
	onProgress?.({ stage: 'opening' });
	// The access lists go back first and on their own (withAccessLists); the
	// collections are what has to fit these books.
	const isList = (/** @type {any} */ d) => String(d.collection ?? '').startsWith(ACCESS_LIST);
	/** The set of databases a backup's metadata belongs to. @param {any} metadata */
	const targetOf = (metadata) => {
		const named = (metadata?.databases ?? []).filter((/** @type {any} */ d) => !isList(d));
		const target =
			targets.find((t) => {
				const ours = new Set(Object.values(t.addresses).map(String));
				return named.every((/** @type {any} */ d) => ours.has(String(d.address)));
			}) ??
			// Written by another passkey of these books (#555): the same names, the
			// writer read once the blocks are in (`resolve`, below).
			targets.find((t) => {
				if (!t.names || !t.resolve || !named.length) return false;
				const ours = new Set(Object.values(t.names).map(String));
				return named.every((/** @type {any} */ d) => ours.has(String(d.name)));
			});
		if (!target) throw new Error('This backup holds databases these books do not have.');
		return target;
	};

	/**
	 * A target that fitted by its names: its writer from the backup's blocks,
	 * and the addresses for that writer, which must be the backup's.
	 *
	 * @param {RestoreTarget} target
	 * @param {any[]} named the backup's databases, without the access lists
	 */
	const addressedTarget = async (target, named) => {
		const fits = (/** @type {Record<string, string>} */ addresses) => {
			const ours = new Set(Object.values(addresses).map(String));
			return named.every((d) => ours.has(String(d.address)));
		};
		if (fits(target.addresses) || !target.resolve) return target;
		const read = async (/** @type {CID} */ cid) =>
			blocks?.get(cid.toV1().toString())?.bytes ??
			blocks?.get(cid.toString())?.bytes ??
			(await collect(orbitdb.ipfs.blockstore.get(cid, { offline: true })).catch(() => undefined));
		const writer = named.length ? await writerOf(String(named[0].address), read) : null;
		const resolved = writer ? await target.resolve(writer) : null;
		if (!resolved || !fits(resolved.addresses)) {
			throw new Error('This backup holds databases these books do not have.');
		}
		return { ...target, ...resolved, writer };
	};

	let {
		manifest,
		stored,
		metadata: all,
		streamed
	} = await storeChain({
		blockstore: orbitdb.ipfs.blockstore,
		sealed,
		increments,
		base,
		key,
		onProgress,
		fits: (m) => void targetOf(m.metadata)
	});
	/** @type {Map<string, { bytes: Uint8Array }> | null} every block, only for a backup without heads */
	let blocks = null;
	// A backup from the first days names no heads: they are found among its
	// blocks, which then have to be in hand. Read again, whole.
	if (!all.databases.every((/** @type {any} */ d) => Array.isArray(d.heads))) {
		({ manifest, blocks, metadata: all } = await openChain({ sealed, increments, base, key }));
		streamed = false;
	}

	const lists = all.databases.filter(isList);
	const metadata = {
		...all,
		databases: all.databases.filter((/** @type {any} */ d) => !isList(d))
	};
	const target = targetOf(metadata);
	const { addresses, open, writer } = /** @type {RestoreTarget & { writer?: string }} */ (
		await addressedTarget(target, metadata.databases)
	);
	const byAddress = Object.fromEntries(
		Object.entries(addresses).map(([collection, address]) => [String(address), collection])
	);
	const { restoreFromBlocks, restoreFromStoredBlocks } = await import(
		'@le-space/orbitdb-storage-bridge/restore-cid'
	);
	// The package only warns when a head cannot be joined; here that is a failed restore.
	/** @type {string[]} */
	const warnings = [];
	const options = {
		open,
		// A head the backup does not carry: ask Aleph's gateway for it. The
		// package checks whatever comes back against the CID that asked for it,
		// so the gateway is a second source and never one to trust.
		fetchBytes,
		// And if it still cannot be had, refuse. These books are replaced by
		// what comes back; half of them is worse than none, and refusing here
		// leaves the ones on the device alone.
		requireHeads: true,
		// Closing the books comes late: the blocks are written first, and a
		// browser whose storage is spent refuses them. Closed before that, the
		// books would be shut for a restore that never starts – which is how an
		// out-of-space device ends up on its lock screen with nothing in it.
		// Then, before any collection is opened, the access lists: a member's
		// grant must be known before what the member wrote is joined.
		beforeJoin: async () => {
			await beforeRestore?.();
			const sealing = listEncryption ?? open.encryption;
			if (lists.length && sealing) {
				await joinAccessLists(orbitdb, lists, sealing, (m) => warnings.push(m));
			}
		},
		log: { info() {}, debug() {}, warn: (/** @type {string} */ m) => warnings.push(String(m)) },
		onProgress: (/** @type {any} */ p) =>
			onProgress?.({
				stage: 'database',
				index: p.index,
				total: p.total,
				name: byAddress[p.address] ?? p.address,
				joined: p.joined
			})
	};
	// Every file is in and authentic to its last frame: from here the books change.
	onProgress?.({ stage: 'joining' });
	const restored = blocks
		? await restoreFromBlocks(orbitdb, blocks, metadata, options)
		: await restoreFromStoredBlocks(orbitdb, stored, metadata, options);
	const failed = warnings.find((w) => /could not join head/.test(w));
	if (failed) throw new Error(`The backup could not be put back: ${failed.replace(/^\W+/, '')}`);
	return {
		manifest,
		target: target.name,
		...(writer ? { writer } : {}),
		increments: increments.length,
		streamed,
		blocks: restored.blocks,
		databases: restored.databases.map((/** @type {any} */ d) => ({
			collection: byAddress[d.address] ?? d.address,
			joined: d.joined,
			entries: d.entries
		}))
	};
}

/**
 * A backup made before the books got new keys (#628), read without OrbitDB:
 * opened with the backup key of that earlier root, each database's entries
 * walked from its heads and opened with that root's keys, the newest version
 * of each record kept, as the books showed it then; and the receipt files it
 * holds, opened with that root's file key. What comes back is plain records
 * and file bytes, for the books of today to take in (session.svelte.js).
 *
 * @param {object} params
 * @param {SealedSource} params.sealed the full backup; read whole, in either format
 * @param {SealedSource[]} [params.increments]
 * @param {string} [params.base]
 * @param {Uint8Array} params.key the earlier root's backup key
 * @param {Uint8Array} params.dataKey the earlier root's database key
 * @param {Uint8Array} params.replicationKey the earlier root's replication key
 * @param {Uint8Array} params.blobKey the earlier root's file key
 * @param {(entry: any, identity: any) => Promise<boolean>} [params.accept] whether an
 *   entry counts, given its writer's identity as the backup carries it; one that
 *   does not is passed over (its links still followed)
 * @returns {Promise<{ manifest: BackupManifest, records: Record<string, Record<string, any>[]>, files: Map<string, Uint8Array> }>}
 */
export async function readEarlierBackup({
	sealed,
	increments = [],
	base,
	key,
	dataKey,
	replicationKey,
	blobKey,
	accept
}) {
	const { manifest, blocks, metadata } = await openChain({ sealed, increments, base, key });
	const [{ Entry }, { decodeIdentity }, { sealedEncryption }, { createBlobStore }] =
		await Promise.all([
			import('@orbitdb/core'),
			// Not exported at the package's root; the package has no exports map.
			import('@orbitdb/core/src/identities/identity.js'),
			import('../entry-encryption.js'),
			import('../receipts/blob-store.js')
		]);
	const encryption = await sealedEncryption(dataKey, replicationKey);
	/** @type {Map<string, Uint8Array>} every block, by its CID however written */
	const byCid = new Map();
	for (const [name, { bytes }] of /** @type {any} */ (blocks)) {
		byCid.set(CID.parse(String(name)).toString(), bytes);
	}
	/** @param {string} hash */
	const bytesOf = (hash) => byCid.get(CID.parse(String(hash)).toString());

	/** @type {Record<string, Record<string, any>[]>} */
	const records = {};
	for (const d of metadata.databases) {
		const collection = String(d.collection ?? d.name);
		/** @type {Map<string, any>} */
		const entries = new Map();
		/** @type {Set<string>} */
		const walked = new Set();
		const stack = [...(d.heads ?? [])].map(String);
		while (stack.length) {
			const hash = /** @type {string} */ (stack.pop());
			if (walked.has(hash)) continue;
			walked.add(hash);
			const bytes = bytesOf(hash);
			// An entry the backup does not carry: older than what it shipped.
			if (!bytes) continue;
			const entry = await Entry.decode(
				bytes,
				encryption.replication.decrypt,
				encryption.data.decrypt
			);
			stack.push(...(entry.next ?? []).map(String), ...(entry.refs ?? []).map(String));
			if (accept) {
				const identityBytes = bytesOf(String(entry.identity));
				const identity = identityBytes
					? await decodeIdentity(identityBytes).catch(() => null)
					: null;
				if (!identity || !(await accept(entry, identity).catch(() => false))) continue;
			}
			entries.set(hash, entry);
		}
		// Newest first, as OrbitDB orders a log: by clock, then by writer.
		const newestFirst = [...entries.values()].sort(
			(a, b) => b.clock.time - a.clock.time || (String(b.clock.id) > String(a.clock.id) ? 1 : -1)
		);
		/** @type {Set<string>} */
		const seen = new Set();
		/** @type {Record<string, any>[]} */
		const kept = [];
		for (const entry of newestFirst) {
			const { op, key: id, value } = entry.payload ?? {};
			if (seen.has(id)) continue;
			seen.add(id);
			if (op === 'PUT' && value && typeof value === 'object') kept.push(value);
		}
		records[collection] = kept;
	}
	// The receipt files, read from the backup's own blocks.
	const blockstore = {
		/** @param {any} cid */
		get: async (cid) => {
			const bytes = bytesOf(cid.toString());
			if (!bytes) throw new Error('A receipt file is not in this backup.');
			return bytes;
		}
	};
	const blobs = await createBlobStore({ blockstore, key: blobKey });
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	for (const r of records.receipts ?? []) {
		for (const cid of [r.fileCid, r.emlCid, r.xmlCid]) {
			if (typeof cid !== 'string' || !cid || files.has(cid)) continue;
			// A file the backup counted as missing stays missing.
			const bytes = await blobs.get(cid).catch(() => null);
			if (bytes) files.set(cid, bytes);
		}
	}
	return { manifest, records, files };
}
