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
// own CID; `restoreFromBlocks` puts the databases back. The whole CAR is
// sealed once more with the backup key (database-keys.js `deriveBackupKey`):
// a storage service sees one opaque file – not how many records there are,
// nor which are receipts.
//
//   sealed backup = MAGIC ‖ nonce ‖ AES-GCM(CAR)
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

/** What a sealed belege backup starts with; the number is the format. */
export const MAGIC = new TextEncoder().encode('belegeB1');
const FORMAT = 2;

/**
 * @typedef {object} BackupManifest
 * @property {'belege-backup'} kind
 * @property {number} v
 * @property {string} createdAt ISO
 * @property {string} appVersion
 * @property {any} metadata the storage bridge's: `databases` [{ name, address, type, manifestCID, entryCount, heads }]
 * @property {string[]} files receipt files' root CIDs
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
 * The receipt files' blocks, from this browser only.
 *
 * @param {any} blockstore Helia's blockstore
 * @param {string[]} files root CIDs
 * @param {(done: number) => void} [onFile]
 */
export async function fileBlocks(blockstore, files, onFile) {
	/** @type {Map<string, { cid: CID, bytes: Uint8Array }>} */
	const blocks = new Map();
	let missing = 0;
	/** @param {CID} cid */
	const take = async (cid) => {
		const name = cid.toV1().toString();
		if (blocks.has(name)) return blocks.get(name)?.bytes;
		const bytes = await collect(blockstore.get(cid, { offline: true })).catch(() => undefined);
		if (!bytes) {
			missing++;
			return undefined;
		}
		blocks.set(name, { cid, bytes });
		return bytes;
	};
	for (const [i, file] of files.entries()) {
		const root = await take(CID.parse(file));
		if (root) {
			/** @type {any} */
			const value = dagCbor.decode(root);
			for (const chunk of Array.isArray(value?.chunks) ? value.chunks : []) {
				await take(CID.asCID(chunk) ?? CID.parse(String(chunk)));
			}
		}
		onFile?.(i + 1);
	}
	return { blocks, missing };
}

/** MAGIC ‖ nonce ‖ AES-GCM(CAR). @param {Uint8Array} car @param {Uint8Array} backupKey */
async function seal(car, backupKey) {
	const sealed = await (await sealer(backupKey)).seal(car);
	const out = new Uint8Array(MAGIC.length + sealed.length);
	out.set(MAGIC, 0);
	out.set(sealed, MAGIC.length);
	return out;
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

	const files = await receiptFiles(receipts);
	onProgress?.({ stage: 'files', done: 0, total: files.length });
	const { blocks: own, missing } = await fileBlocks(blockstore, files, (done) =>
		onProgress?.({ stage: 'files', done, total: files.length })
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

	const car = await createCARFromBlocks(blocks, rootCid.toString());
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
 * @property {string[]} files receipt files' root CIDs in the chain
 */

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

	/** @type {Map<string, { database: any, shipped: Set<string>, collection: string }>} */
	const watched = new Map();
	const names = Object.keys(databases);
	for (const [index, [collection, database]] of Object.entries(databases).entries()) {
		const address = String(database.address);
		const since = chain.heads[address] ?? [];
		const shipped = await reachable(database, since);
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
	const files = (await receiptFiles(receipts)).filter((f) => !had.has(f));
	onProgress?.({ stage: 'files', done: 0, total: files.length });
	const { blocks: own, missing } = await fileBlocks(blockstore, files, (done) =>
		onProgress?.({ stage: 'files', done, total: files.length })
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
	for (const [address, shipped] of increment.shipped) heads[address] = shipped.heads;
	const car = await createCARFromBlocks(increment.blocks, increment.root);
	onProgress?.({ stage: 'sealing', bytes: car.length });
	return {
		sealed: await seal(car, backupKey),
		manifest: increment.manifest,
		heads,
		files,
		entries: increment.entries,
		databases: /** @type {any} */ (increment.manifest.metadata).databases.map(
			(/** @type {any} */ d) => ({
				collection: String(d.collection ?? d.name),
				entries: Number(d.entries ?? 0)
			})
		),
		blocks: increment.blocks.size,
		missing,
		carBytes: car.length
	};
}

/**
 * Open a sealed backup – a full one or an increment: every block checked
 * against its own CID, and the manifest found among them (`kind`
 * `belege-backup` or `increment`).
 *
 * @param {Uint8Array} sealed
 * @param {Uint8Array} backupKey
 * @returns {Promise<{ manifest: BackupManifest, blocks: Map<string, { bytes: Uint8Array }> }>}
 */
export async function openBackup(sealed, backupKey) {
	const head = sealed.subarray(0, MAGIC.length);
	if (!head.every((b, i) => b === MAGIC[i])) throw new Error('Not a belege backup.');
	const car = await (await sealer(backupKey)).open(sealed.subarray(MAGIC.length));
	const { readBlocksFromCAR } = await import('@le-space/orbitdb-storage-bridge/restore-cid');
	const blocks = await readBlocksFromCAR(car, { verify: true });
	// The manifest is the one dag-cbor block that says so; the blocks are verified.
	for (const [name, { bytes }] of blocks) {
		if (CID.parse(name).code !== dagCbor.code) continue;
		/** @type {any} */
		let value;
		try {
			value = dagCbor.decode(bytes);
		} catch {
			continue;
		}
		if (value?.kind === 'belege-backup' || value?.kind === 'increment') {
			return { manifest: value, blocks };
		}
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
 * @typedef {{ stage: 'opening' }
 *   | { stage: 'database', index: number, total: number, name: string, joined: number }} RestoreProgress
 */

/**
 * Put a backup back into this browser's books.
 *
 * The databases go back through the storage bridge's `restoreFromBlocks`: every
 * block into the blockstore (the receipt files' with them), each database
 * reopened and its heads joined. Joining merges: books already here stay,
 * and what the backup holds is added – nothing is deleted.
 *
 * The backup must be this passkey's: its key opens it (else
 * `WrongPasskeyError`), and every database it names must be one of these books
 * (same address). The books have two sets of databases: the sealed ones, and
 * those before the replication layer (store/migrate.js), which a backup made
 * earlier holds. `targets` names both; the backup goes back into the set it
 * was made of, with that set's `open` options, and the result says which
 * (`target`). The open databases are closed by `restoreFromBlocks` and
 * reopened behind the store's back, so the caller reloads the page afterwards.
 *
 * With `increments`, the full backup's increments go back with it: all of
 * them opened first, each one this base's (`base`, its CID), the chain without
 * a hole (`ChainGapError`), then the blocks of all as one.
 *
 * @param {object} params
 * @param {any} params.orbitdb
 * @param {Uint8Array} params.sealed the full backup
 * @param {Uint8Array[]} [params.increments] its increments, sealed, in any order
 * @param {string} [params.base] the full backup's CID, which its increments name
 * @param {Uint8Array} params.key the backup key
 * @param {{ name: string, addresses: Record<string, string>, open: Record<string, any> }[]} params.targets
 *   each set of databases: its addresses by collection, and what `orbitdb.open` needs for it
 * @param {(progress: RestoreProgress) => void} [params.onProgress]
 * @param {() => Promise<void>} [params.beforeRestore] runs once the backup opened
 *   with this key and fits these books, right before anything is written – where
 *   the caller closes its databases, so a backup that does not fit leaves them open
 * @returns {Promise<{ manifest: BackupManifest, target: string, increments: number, databases: { collection: string, joined: number, entries: number | null }[] }>}
 */
export async function restoreBackup({
	orbitdb,
	sealed,
	increments = [],
	base,
	key,
	targets,
	onProgress,
	beforeRestore
}) {
	onProgress?.({ stage: 'opening' });
	/** @param {Uint8Array} bytes */
	const unseal = async (bytes) => {
		try {
			return await openBackup(bytes, key);
		} catch (error) {
			// AES-GCM refuses a wrong key as an OperationError; a foreign file is "Not a belege backup."
			if (error instanceof Error && error.name === 'OperationError') throw new WrongPasskeyError();
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
		const missing = [...merged.gaps];
		const first = merged.sequences[0];
		if (first !== undefined) for (let s = 1; s < first; s++) missing.push(s);
		if (missing.length) throw new ChainGapError(missing.sort((a, b) => a - b));
		blocks = merged.blocks;
		metadata = merged.metadata;
	}
	const target = targets.find((t) => {
		const ours = new Set(Object.values(t.addresses).map(String));
		return metadata.databases.every((/** @type {any} */ d) => ours.has(String(d.address)));
	});
	if (!target) throw new Error('This backup holds databases these books do not have.');
	const { addresses, open } = target;
	const byAddress = Object.fromEntries(
		Object.entries(addresses).map(([collection, address]) => [String(address), collection])
	);
	const { restoreFromBlocks } = await import('@le-space/orbitdb-storage-bridge/restore-cid');
	await beforeRestore?.();
	// The package only warns when a head cannot be joined; here that is a failed restore.
	/** @type {string[]} */
	const warnings = [];
	const restored = await restoreFromBlocks(orbitdb, blocks, metadata, {
		open,
		log: { info() {}, debug() {}, warn: (/** @type {string} */ m) => warnings.push(String(m)) },
		onProgress: (p) =>
			onProgress?.({
				stage: 'database',
				index: p.index,
				total: p.total,
				name: byAddress[p.address] ?? p.address,
				joined: p.joined
			})
	});
	const failed = warnings.find((w) => /could not join head/.test(w));
	if (failed) throw new Error(`The backup could not be put back: ${failed.replace(/^\W+/, '')}`);
	return {
		manifest,
		target: target.name,
		increments: increments.length,
		databases: restored.databases.map((d) => ({
			collection: byAddress[d.address] ?? d.address,
			joined: d.joined,
			entries: d.entries
		}))
	};
}
