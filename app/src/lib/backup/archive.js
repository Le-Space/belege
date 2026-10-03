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
//     still names them): the dag-cbor root and its 1 MiB chunks, already
//     sealed with the blob key. Mail receipts are receipt files like any other.
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

	const files = [
		...new Set(
			(await receipts.list({ includeDeleted: true }))
				.map((r) => r.fileCid)
				.filter((c) => typeof c === 'string' && c)
		)
	];
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
	const sealed = await (await sealer(backupKey)).seal(car);
	const out = new Uint8Array(MAGIC.length + sealed.length);
	out.set(MAGIC, 0);
	out.set(sealed, MAGIC.length);
	return { sealed: out, manifest, blocks: blocks.size, carBytes: car.length };
}

/**
 * Open a sealed backup: every block checked against its own CID, and the
 * manifest found among them.
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
		if (value?.kind === 'belege-backup') return { manifest: value, blocks };
	}
	throw new Error('Not a belege backup.');
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
 * (same address). The open databases are closed by `restoreFromBlocks` and
 * reopened behind the store's back, so the caller reloads the page afterwards.
 *
 * @param {object} params
 * @param {any} params.orbitdb
 * @param {Uint8Array} params.sealed
 * @param {Uint8Array} params.key the backup key
 * @param {Record<string, string>} params.addresses this session's database addresses, by collection
 * @param {Record<string, any>} params.open what `orbitdb.open` needs for these books
 * @param {(progress: RestoreProgress) => void} [params.onProgress]
 * @returns {Promise<{ manifest: BackupManifest, databases: { collection: string, joined: number, entries: number | null }[] }>}
 */
export async function restoreBackup({ orbitdb, sealed, key, addresses, open, onProgress }) {
	onProgress?.({ stage: 'opening' });
	let opened;
	try {
		opened = await openBackup(sealed, key);
	} catch (error) {
		// AES-GCM refuses a wrong key as an OperationError; a foreign file is "Not a belege backup."
		if (error instanceof Error && error.name === 'OperationError') throw new WrongPasskeyError();
		throw error;
	}
	const { manifest, blocks } = opened;
	const metadata = /** @type {any} */ (manifest.metadata);
	const ours = new Set(Object.values(addresses).map(String));
	for (const d of metadata.databases) {
		if (!ours.has(String(d.address))) {
			throw new Error('This backup holds databases these books do not have.');
		}
	}
	const byAddress = Object.fromEntries(
		Object.entries(addresses).map(([collection, address]) => [String(address), collection])
	);
	const { restoreFromBlocks } = await import('@le-space/orbitdb-storage-bridge/restore-cid');
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
		databases: restored.databases.map((d) => ({
			collection: byAddress[d.address] ?? d.address,
			joined: d.joined,
			entries: d.entries
		}))
	};
}
