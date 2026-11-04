// Who may write to the books (#496): the books' own identity, the root of an
// OrbitDBAccessController – the same for every passkey that opens the books,
// and able to grant others later.
//
// Before, every collection was opened with OrbitDB's default access
// controller, whose write list – the DID of the passkey that made the books –
// is part of each database's address. A second passkey or a recovery phrase
// could never write there (#406).
//
// The OrbitDBAccessController keeps its list in a database of its own
// (`@orbitdb/core` access-controllers/orbitdb.js), and OrbitDB opens that one
// itself, through an `orbitdb` object it builds – plaintext, unless told
// otherwise. A database is sealed in Belege or not opened (AGENTS.md), so the
// controller is wrapped where it opens its database, and registered under its
// own type: a collection opened by address (a restore, a sync) looks the
// controller up by that type, never through an option. Without the session's
// sealing in place, it refuses rather than open a plaintext database.

import { OrbitDBAccessController, useAccessController } from '@orbitdb/core';

/** @type {{ data: any, replication: any } | null} the open books' sealing */
let sealing = null;

/**
 * The sealing the controller's own database is opened with, for as long as
 * the books are open (node.js); null when they close.
 *
 * @param {{ data: any, replication: any } | null} encryption from `sealedEncryption`
 */
export function sealAccessLists(encryption) {
	sealing = encryption;
}

/** A member taken out (#614): `removed:<write identity>` → the hashes of what they wrote before. */
const REMOVED = 'removed:';

/**
 * OrbitDBAccessController, its list database sealed with the books' keys –
 * and aware of members taken out (#614).
 *
 * OrbitDB checks every entry it joins against the list as it is now, old
 * entries too. Revoking a member's write access would make their earlier
 * entries – and every later one that links to them – unacceptable on a device
 * that has not got them yet. So the grant stays, and taking a member out
 * writes `removed:<their DID>` into the list instead: the hashes of every
 * entry they had written by then. From then on an entry of theirs is
 * accepted only when it is one of those – by hash, so nothing can be
 * backdated. Only the books' identity writes to the list.
 *
 * @param {{ write?: string[] }} [params]
 */
const SealedOrbitDBAccessController = ({ write } = {}) => {
	const inner = OrbitDBAccessController({ write });
	/** @param {{ orbitdb: any, identities: any, address?: string, name?: string }} params */
	return async (params) => {
		if (!sealing) throw new Error('The books are not open: no access list is opened unsealed.');
		const encryption = sealing;
		/** @type {any} the list's own database, as the controller opened it */
		let list = null;
		const controller = await inner({
			...params,
			orbitdb: {
				...params.orbitdb,
				open: async (/** @type {string} */ address, /** @type {any} */ options = {}) =>
					(list = await params.orbitdb.open(address, { ...options, encryption }))
			}
		});

		/** @type {Map<string, Set<string>> | null} taken out → what still counts; null: to read */
		let removed = null;
		controller.events?.on?.('update', () => (removed = null));
		const removedNow = async () => {
			if (removed) return removed;
			/** @type {Map<string, Set<string>>} */
			const found = new Map();
			for await (const { key, value } of list.iterator()) {
				if (String(key).startsWith(REMOVED) && Array.isArray(value)) {
					found.set(String(key).slice(REMOVED.length), new Set(value.map(String)));
				}
			}
			return (removed = found);
		};
		/** @type {Map<string, string>} an entry's identity hash → the writer's id */
		const writers = new Map();
		/** @param {{ identity: string }} entry */
		const writerOf = async (entry) => {
			if (!writers.has(entry.identity)) {
				const identity = await params.identities.getIdentity(entry.identity);
				writers.set(entry.identity, String(identity?.id ?? ''));
			}
			return /** @type {string} */ (writers.get(entry.identity));
		};

		/**
		 * Whether an entry counts: not by a member taken out, or written by them
		 * before.
		 *
		 * @param {{ identity: string, hash?: string }} entry
		 */
		const admits = async (entry) => {
			const out = await removedNow();
			if (!out.size) return true;
			const before = out.get(await writerOf(entry));
			return !before || (typeof entry.hash === 'string' && before.has(entry.hash));
		};

		return {
			...controller,
			canAppend: async (/** @type {any} */ entry) =>
				(await admits(entry)) && controller.canAppend(entry),
			admits,
			writerOf,
			/**
			 * Take a writer out: what they wrote by now still counts, nothing after.
			 *
			 * @param {string} writer their write identity
			 * @param {Iterable<string>} hashes every entry of theirs in the database now
			 */
			async removeWriter(writer, hashes) {
				await list.put(`${REMOVED}${writer}`, [...new Set(hashes)]);
				removed = null;
			},
			/** The writers taken out. */
			removedWriters: async () => [...(await removedNow()).keys()]
		};
	};
};
SealedOrbitDBAccessController.type = OrbitDBAccessController.type;

// In place of OrbitDB's own, for every database of type `orbitdb` this page opens.
useAccessController(SealedOrbitDBAccessController);

/**
 * The access controller every collection is opened with: the books' identity
 * as the root writer.
 *
 * @param {string} booksDid
 */
export const booksAccessController = (booksDid) => {
	if (typeof booksDid !== 'string' || !booksDid) throw new Error('The books’ DID is required.');
	return SealedOrbitDBAccessController({ write: [booksDid] });
};
