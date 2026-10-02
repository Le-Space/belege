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
