// "Neue Schlüssel für die Bücher" (#627): the books under a new root, in the
// same browser. After a member was taken out (#614) their writes are refused,
// but they still hold the keys to read; new keys end that for everything the
// books hold from then on.
//
//   1. The owner's device makes a new root and a new vault for it, with a slot
//      for every passkey that answered and the old roots kept inside
//      (books-vault.js `newBooksVault`).
//   2. It packs the books as a move does (book-move.js), sealed to a key from
//      the new root, and keeps the file in this browser's IndexedDB – sealed,
//      as everything at rest. The file keeps what a move leaves out but these
//      books still need (the Aleph account, the browser's backup key, the
//      history, the network mode); members' records stay behind (they join
//      again), and so do the devices, the bridge pairing and the backup chain.
//   3. It writes the new vault into the old books (`books/successor`), with
//      its new peer id, and reloads. The vault holds nothing secret in the
//      clear; only a passkey with a slot opens it.
//   4. Every device of the owner – this one too – finds it at its next
//      unlock, takes the new vault when its passkey has a slot, and opens the
//      new books. This one takes the file over into them; another dials the
//      peer id it was given and syncs.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** The setting in the old books that names their successor. */
export const SUCCESSOR_SETTING = 'books/successor';

/** Settings a move leaves out that new keys in the same browser keep. */
// Not the browser's Aleph key: every member had it to back up; the new books
// make one of their own, which the account then lets in.
export const KEPT = Object.freeze(['backup/owner', 'backups', 'network-mode', 'lan-relay']);
/** Left out besides: members join again; the backup chain names the old databases. */
export const DROPPED = Object.freeze(['member:', 'backup/chain', SUCCESSOR_SETTING]);

const KEY_INFO = new TextEncoder().encode('belege/rekey/v1');

/**
 * The key the books are packed to: x25519 from the new root, so only the
 * books opened under it take the file over.
 *
 * @param {Uint8Array} root the new root
 */
export function rekeyMoveKey(root) {
	const secretKey = hkdf(sha256, root, new Uint8Array(0), KEY_INFO, 32);
	return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

const DB = 'belege-rekey';
const STORE = 'files';
const KEY = 'books';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * @param {'readonly' | 'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 */
async function withStore(mode, fn) {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const request = fn(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

/** Keep the packed books until the new books took them over. @param {Uint8Array} file */
export const keepRekeyFile = (file) => withStore('readwrite', (s) => s.put(file, KEY));

/** The packed books waiting here, or null. @returns {Promise<Uint8Array | null>} */
export async function rekeyFile() {
	const file = await withStore('readonly', (s) => s.get(KEY));
	return file instanceof Uint8Array ? file : null;
}

/** Taken over: the file goes. */
export const dropRekeyFile = () => withStore('readwrite', (s) => s.delete(KEY));

/** Where another device learns whom to dial in the new books, until it has. */
export const DIAL_STORAGE_KEY = 'belege.rekey.dial';

/**
 * A setting's newest value as the books' own identity wrote it (#627): the
 * settings log walked newest first, entries by any other writer – a member –
 * passed over. Null when the books never wrote it.
 *
 * @param {any} db the settings database
 * @param {string} key the setting
 * @param {string} writer the books' identity id
 */
export async function successorWrittenBy(db, key, writer) {
	for await (const entry of db.log.iterator()) {
		const record = entry.payload?.value;
		if (entry.payload?.op !== 'PUT' || record?.key !== key) continue;
		if ((await db.access.writerOf(entry)) !== writer) continue;
		return record.deleted ? null : (record.value ?? null);
	}
	return null;
}
