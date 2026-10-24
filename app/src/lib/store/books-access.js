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

/**
 * OrbitDBAccessController, its list database sealed with the books' keys.
 *
 * @param {{ write?: string[] }} [params]
 */
const SealedOrbitDBAccessController = ({ write } = {}) => {
	const inner = OrbitDBAccessController({ write });
	/** @param {{ orbitdb: any, identities: any, address?: string, name?: string }} params */
	return async (params) => {
		if (!sealing) throw new Error('The books are not open: no access list is opened unsealed.');
		const encryption = sealing;
		return inner({
			...params,
			orbitdb: {
				...params.orbitdb,
				open: (/** @type {string} */ address, /** @type {any} */ options = {}) =>
					params.orbitdb.open(address, { ...options, encryption })
			}
		});
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
