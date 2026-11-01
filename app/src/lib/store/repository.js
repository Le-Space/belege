// The data layer: one sealed OrbitDB documents database per collection.
//
// Every record carries
//   id         a ULID, so ids sort by creation time
//   createdAt  ISO 8601, set once
//   updatedAt  ISO 8601, set on every write
//   deleted    soft delete; bookkeeping records are never removed, and an
//              append-only log could not remove them anyway
//   author     the DID of the identity that wrote this version
// and keeps money in integer cents: any field whose name ends in `Cents`
// must be a safe integer.
//
// The databases are opened with both of OrbitDB's encryption layers: the
// payload sealed (`data`) and the whole entry sealed again (`replication`,
// entry-encryption.js `sealedEncryption`). There is no code path that opens
// one in plaintext. The databases before the replication layer are opened
// only to move them (store/migrate.js), without sync.

import { IPFSAccessController } from '@orbitdb/core';
import { payloadEncryption, sealedEncryption } from '../entry-encryption.js';
import { deriveDatabaseName, deriveSealedDatabaseName } from '../database-keys.js';
import { moveLog } from './migrate.js';
import { ulid, isUlid } from './ids.js';
import SealedDocuments from './sealed-documents.js';

export const COLLECTIONS = /** @type {const} */ ([
	'transactions',
	'receipts',
	'partners',
	'accounts',
	'settings',
	'matches',
	'questions',
	'events',
	'travel'
]);

/**
 * The collections there were before the replication layer: only these have
 * old databases to move or to restore from (`travel` came later, #213).
 */
export const OLD_COLLECTIONS = /** @type {const} */ ([
	'transactions',
	'receipts',
	'partners',
	'accounts',
	'settings',
	'matches',
	'questions',
	'events'
]);

/** @typedef {typeof COLLECTIONS[number]} CollectionName */

/**
 * @typedef {{ id: string, createdAt: string, updatedAt: string, deleted: boolean, author: string } & Record<string, any>} StoredRecord
 */

/**
 * @typedef {object} Collection
 * @property {CollectionName} name
 * @property {string} address the OrbitDB address
 * @property {(record: Record<string, any>) => Promise<StoredRecord>} put create, or update when `id` exists
 * @property {(id: string) => Promise<StoredRecord | null>} get
 * @property {(filter?: { includeDeleted?: boolean, where?: (record: StoredRecord) => boolean }) => Promise<StoredRecord[]>} list newest first
 * @property {(id: string) => Promise<StoredRecord>} softDelete
 * @property {(record: StoredRecord) => Promise<StoredRecord>} restore a record from other books, as it
 *   was there – id, createdAt, updatedAt and deleted kept; written by this identity (#328)
 * @property {(listener: (event: { collection: CollectionName }) => void) => () => void} onChange returns an unsubscribe
 * @property {(listener: (entry: { hash: string, payload: { op: string, key: string, value: any } }) => void) => () => void} onEntry
 *   every entry the log takes – written here or come by sync – opened; returns an unsubscribe
 * @property {(hash: string) => boolean} wroteHere whether this session wrote that entry (the sync log, sync/sync-log.js)
 * @property {() => Promise<{ entries: number, bytes: number }>} stats what its log takes: every version written, and about how many bytes
 */

/** @param {Record<string, any>} record */
function assertCents(record) {
	for (const [field, value] of Object.entries(record)) {
		if (field.endsWith('Cents') && value !== null && value !== undefined) {
			if (!Number.isSafeInteger(value)) {
				throw new Error(`${field} must be an integer amount of cents, got ${value}`);
			}
		}
	}
}

/**
 * @param {any} db an opened SealedDocuments database, indexed by `id`
 * @param {CollectionName} name
 * @param {{ author: string, now?: () => Date }} context
 * @returns {Collection}
 */
export function createCollection(db, name, { author, now = () => new Date() }) {
	/**
	 * The entries this session wrote, newest last: every device writes with the
	 * same identity (the passkey's), so an entry does not say where it was made.
	 * @type {Set<string>}
	 */
	const written = new Set();
	/** @param {unknown} hash */
	const remember = (hash) => {
		if (typeof hash !== 'string') return;
		written.add(hash);
		if (written.size > 1000) written.delete(/** @type {string} */ (written.values().next().value));
	};

	/** @param {string} id */
	async function get(id) {
		const found = await db.get(id);
		return found ? /** @type {StoredRecord} */ (found.value) : null;
	}

	/** @param {Record<string, any>} input */
	async function put(input) {
		if (!input || typeof input !== 'object') throw new Error('A record must be an object.');
		assertCents(input);

		const at = now().toISOString();
		const existing = input.id ? await get(input.id) : null;
		if (input.id && !existing && !isUlid(input.id)) {
			throw new Error(`Not a record id: ${input.id}`);
		}

		/** @type {StoredRecord} */
		const record = {
			...existing,
			...input,
			id: existing?.id ?? input.id ?? ulid(now().getTime()),
			createdAt: existing?.createdAt ?? at,
			updatedAt: at,
			deleted: input.deleted ?? existing?.deleted ?? false,
			author
		};
		remember(await db.put(record));
		return record;
	}

	/** @type {Collection['list']} */
	async function list({ includeDeleted = false, where } = {}) {
		const all = await db.all();
		return all
			.map((/** @type {{ value: StoredRecord }} */ entry) => entry.value)
			.filter((/** @type {StoredRecord} */ record) => includeDeleted || !record.deleted)
			.filter((/** @type {StoredRecord} */ record) => !where || where(record))
			.sort((/** @type {StoredRecord} */ a, /** @type {StoredRecord} */ b) =>
				a.id < b.id ? 1 : a.id > b.id ? -1 : 0
			);
	}

	/** @param {string} id */
	async function softDelete(id) {
		const existing = await get(id);
		if (!existing) throw new Error(`No ${name} record with id ${id}`);
		return put({ ...existing, deleted: true });
	}

	/** @type {Collection['restore']} */
	async function restore(input) {
		if (!input || !isUlid(String(input.id ?? '')))
			throw new Error('A record to restore needs its id.');
		assertCents(input);
		const at = now().toISOString();
		/** @type {StoredRecord} */
		const record = {
			...input,
			createdAt: typeof input.createdAt === 'string' ? input.createdAt : at,
			updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : at,
			deleted: input.deleted === true,
			author
		};
		remember(await db.put(record));
		return record;
	}

	/** @type {Collection['onChange']} */
	function onChange(listener) {
		const handler = () => listener({ collection: name });
		db.events.on('update', handler);
		return () => db.events.off('update', handler);
	}

	/** @type {Collection['onEntry']} */
	function onEntry(listener) {
		db.events.on('update', listener);
		return () => db.events.off('update', listener);
	}

	/** @type {Collection['stats']} */
	const stats = async () => (await db.stats?.()) ?? { entries: 0, bytes: 0 };

	return {
		name,
		address: db.address?.toString?.() ?? '',
		put,
		get,
		list,
		softDelete,
		restore,
		onChange,
		onEntry,
		wroteHere: (hash) => written.has(hash),
		stats
	};
}

/**
 * The access controller a passkey's databases were made with before the
 * books had their own identity (#496): OrbitDB's default, its write list that
 * passkey's DID. Spelled out, so another identity opening them by name finds
 * the same address.
 *
 * @param {string} writer the passkey's DID
 */
export const passkeyAccessController = (writer) => {
	if (typeof writer !== 'string' || !writer)
		throw new Error('The former writer’s DID is required.');
	return IPFSAccessController({ write: [writer] });
};

/**
 * How the databases before the replication layer are opened: payload sealed,
 * entries not, and never synced. For moving them, and for restoring a backup
 * made of them. They were written by the passkey (`formerWriter`).
 *
 * @param {Uint8Array} encryptionKey
 * @param {string} [formerWriter] the passkey's DID; OrbitDB's identity when absent
 */
export async function oldBooksOpenOptions(encryptionKey, formerWriter) {
	return {
		type: SealedDocuments.type,
		Database: SealedDocuments({ indexBy: 'id' }),
		encryption: await payloadEncryption(encryptionKey),
		sync: false,
		...(formerWriter ? { AccessController: passkeyAccessController(formerWriter) } : {})
	};
}

/**
 * How the sealed databases the passkey wrote before the books' own identity
 * (#496) are opened: both layers sealed, the passkey's access controller,
 * never synced. For moving them, and for restoring a backup made of them.
 *
 * @param {Uint8Array} encryptionKey
 * @param {Uint8Array} replicationKey
 * @param {string} formerWriter the passkey's DID
 */
export async function passkeyBooksOpenOptions(encryptionKey, replicationKey, formerWriter) {
	return {
		type: SealedDocuments.type,
		Database: SealedDocuments({ indexBy: 'id' }),
		encryption: await sealedEncryption(encryptionKey, replicationKey),
		sync: false,
		AccessController: passkeyAccessController(formerWriter)
	};
}

/**
 * The names of the databases before the replication layer, by collection.
 *
 * @param {Uint8Array} prfOutput
 */
export async function oldBooksNames(prfOutput) {
	/** @type {Record<string, string>} */
	const names = {};
	for (const name of OLD_COLLECTIONS) names[name] = await deriveDatabaseName(prfOutput, name);
	return names;
}

/**
 * Open every collection, sealed with one key.
 *
 * With `move`, the books before the replication layer are moved into the
 * sealed databases first (store/migrate.js): entry by entry, with their
 * clocks, adding only what is not there yet. With `moveFromPasskey`, so are
 * the sealed databases the passkey (`formerWriter`) wrote before the books
 * had their own identity (#496).
 *
 * @param {object} params
 * @param {any} params.orbitdb a started OrbitDB instance
 * @param {Uint8Array} params.encryptionKey 32 bytes from `deriveDatabaseKey`
 * @param {Uint8Array} params.replicationKey 32 bytes from `deriveReplicationKey`
 * @param {Uint8Array} params.prfOutput names the databases, see `deriveSealedDatabaseName`
 * @param {boolean} [params.move] move the books before the replication layer in
 * @param {(progress: { collection: string, moved: number, total: number }) => void} [params.onMove]
 * @param {(name: string) => void} [params.onOpen] before each collection is opened (its index is
 *   built from the log then – on large books what takes the time on every unlock)
 * @param {Record<string, any>} [params.openOptions] extra `orbitdb.open` options (tests pass memory storages)
 * @param {any} [params.accessController] who may write: `booksAccessController` (books-access.js);
 *   OrbitDB's default when absent
 * @param {string} [params.author] who a record says wrote it: the passkey's DID, not the books' (#496);
 *   OrbitDB's identity when absent
 * @param {string} [params.formerWriter] the passkey's DID the earlier databases were written by
 * @param {boolean} [params.moveFromPasskey] move the passkey's sealed databases in (needs `formerWriter`)
 * @returns {Promise<{ transactions: Collection, receipts: Collection, partners: Collection, accounts: Collection, settings: Collection, matches: Collection, questions: Collection, events: Collection, travel: Collection, moved: Record<string, { total: number, moved: number }>, movedFromPasskey: Record<string, { total: number, moved: number }>, databases: () => Record<string, any>, resync: () => Promise<void>, close: () => Promise<void> }>}
 */
export async function openStore({
	orbitdb,
	encryptionKey,
	replicationKey,
	prfOutput,
	move = false,
	onOpen,
	onMove,
	openOptions = {},
	accessController,
	author: writtenBy,
	formerWriter,
	moveFromPasskey = false
}) {
	if (!(encryptionKey instanceof Uint8Array) || encryptionKey.length !== 32) {
		throw new Error('The store cannot be opened without its 32-byte encryption key.');
	}
	if (!(replicationKey instanceof Uint8Array) || replicationKey.length !== 32) {
		throw new Error('The store cannot be opened without its 32-byte replication key.');
	}
	if (moveFromPasskey && !formerWriter) {
		throw new Error('Moving the passkey’s databases needs the DID they were written by.');
	}
	const author = writtenBy ?? orbitdb.identity.id;
	const encryption = await sealedEncryption(encryptionKey, replicationKey);
	/** @param {string} name */
	const extra = async (name) =>
		typeof openOptions === 'function' ? await openOptions(name) : openOptions;

	/** @type {Record<string, any>} */
	const dbs = {};
	/** @type {Record<string, Collection>} */
	const collections = {};
	for (const name of COLLECTIONS) {
		onOpen?.(name);
		dbs[name] = await orbitdb.open(await deriveSealedDatabaseName(prfOutput, name), {
			type: SealedDocuments.type,
			Database: SealedDocuments({ indexBy: 'id' }),
			encryption,
			...(accessController ? { AccessController: accessController } : {}),
			...(await extra(name))
		});
		collections[name] = createCollection(dbs[name], name, { author });
	}

	/** @type {Record<string, { total: number, moved: number }>} */
	const moved = {};
	if (move) {
		const names = await oldBooksNames(prfOutput);
		const options = await oldBooksOpenOptions(encryptionKey, formerWriter);
		for (const name of OLD_COLLECTIONS) {
			const from = await orbitdb.open(names[name], { ...options, ...(await extra(name)) });
			try {
				moved[name] = await moveLog({
					from,
					to: dbs[name],
					identity: orbitdb.identity,
					onProgress: (done, total) => onMove?.({ collection: name, moved: done, total })
				});
			} finally {
				await from.close();
			}
		}
	}

	/** What `moveFromPasskey` moved, by collection (#496). */
	/** @type {Record<string, { total: number, moved: number }>} */
	const movedFromPasskey = {};
	if (moveFromPasskey && formerWriter) {
		const options = await passkeyBooksOpenOptions(encryptionKey, replicationKey, formerWriter);
		for (const name of COLLECTIONS) {
			const from = await orbitdb.open(await deriveSealedDatabaseName(prfOutput, name), {
				...options,
				...(await extra(name))
			});
			try {
				// The same database (an identity that is the passkey's): nothing to move.
				if (String(from.address) === String(dbs[name].address)) continue;
				movedFromPasskey[name] = await moveLog({
					from,
					to: dbs[name],
					identity: orbitdb.identity,
					onProgress: (done, total) => onMove?.({ collection: name, moved: done, total })
				});
			} finally {
				if (String(from.address) !== String(dbs[name].address)) await from.close();
			}
		}
	}

	return {
		transactions: collections.transactions,
		receipts: collections.receipts,
		partners: collections.partners,
		accounts: collections.accounts,
		settings: collections.settings,
		matches: collections.matches,
		questions: collections.questions,
		events: collections.events,
		travel: collections.travel,
		/** What `move` moved, by collection: entries in the old log, and how many were new. */
		moved,
		movedFromPasskey,
		/** The opened OrbitDB databases, by collection: what a backup reads (backup/archive.js). */
		databases: () => ({ ...dbs }),
		/**
		 * Every database's sync once more: another device connected directly,
		 * and OrbitDB 4.0.0 exchanges heads only on subscribe (sync/device-sync.js).
		 */
		async resync() {
			for (const db of Object.values(dbs)) {
				await db.sync.stop();
				await db.sync.start();
			}
		},
		async close() {
			await Promise.allSettled(Object.values(dbs).map((db) => db.close()));
		}
	};
}
