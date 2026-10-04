// Moving the books into databases whose entries carry the replication seal.
//
// Before, each collection's log sealed only the payload (`data`): an entry's
// writer, clock and links were readable by whoever got the block. The new
// databases seal the whole entry as well (`replication`, entry-encryption.js
// `sealedEncryption`), and that cannot be switched on for a log that exists:
// its entries would no longer decode. So each collection moves once, into a
// database of its own (database-keys.js `deriveSealedDatabaseName`).
//
// Not by writing the records again. Two devices that each moved their own
// copy would then hold the same records as different entries with new
// clocks, and a device that moved later, from an older state, could win over
// an edit made after the move. Instead every entry of the old log is sealed
// anew with its own clock, and its links point to the entries it linked to
// before: the new log orders exactly as the old one did. What a second device
// moves are entries with the same clocks and the same records – duplicates
// that change nothing – and everything written after the move has a later
// clock than anything moved.
//
// An entry already moved (same clock, same operation) is not moved again, so
// moving twice – a second unlock, a restored backup of the old books – adds
// only what is new.

import { Entry } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';

/** @param {any} payload @returns {string} */
const operationKey = (payload) =>
	Array.from(dagCbor.encode(payload), (b) => b.toString(16).padStart(2, '0')).join('');

/** @param {any} entry */
const moveKey = (entry) => `${entry.clock.time}|${operationKey(entry.payload)}`;

/** @param {any} log @returns {Promise<any[]>} */
async function entriesOf(log) {
	const all = [];
	for await (const entry of log.iterator()) all.push(entry);
	return all;
}

/**
 * Seal every entry of `from` anew into `to`, with its clock and links.
 *
 * @param {object} p
 * @param {any} p.from the old database, opened with `data` encryption and without sync
 * @param {any} p.to the new database, opened with both layers
 * @param {any} p.identity the writer (orbitdb.identity), the same as the old entries'
 * @param {(moved: number, total: number) => void} [p.onProgress]
 * @returns {Promise<{ total: number, moved: number }>}
 */
export async function moveLog({ from, to, identity, onProgress }) {
	const old = await entriesOf(from.log);
	// Oldest first: an entry's clock is later than every entry it links to.
	old.sort((a, b) => a.clock.time - b.clock.time || (a.hash < b.hash ? -1 : 1));

	/** What the new log has, by clock and operation: its hash. */
	/** @type {Map<string, string>} */
	const there = new Map();
	for (const entry of await entriesOf(to.log)) there.set(moveKey(entry), entry.hash);

	const encryption = to.log.encryption;
	/** Old hash → new hash, for the links. */
	/** @type {Map<string, string>} */
	const moved = new Map();
	let added = 0;
	for (const [index, entry] of old.entries()) {
		const key = moveKey(entry);
		const existing = there.get(key);
		if (existing) {
			moved.set(entry.hash, existing);
		} else {
			const link = (/** @type {string[]} */ hashes) =>
				(hashes ?? []).map((h) => moved.get(h)).filter((h) => typeof h === 'string');
			const fresh = await Entry.create(
				identity,
				to.log.id,
				entry.payload,
				encryption?.data?.encrypt,
				{ id: entry.clock.id, time: entry.clock.time },
				link(entry.next),
				link(entry.refs)
			);
			const { hash } = await Entry.encode(
				fresh,
				encryption?.replication?.encrypt,
				encryption?.data?.encrypt
			);
			await to.log.joinEntry({ ...fresh, hash });
			moved.set(entry.hash, hash);
			there.set(key, hash);
			added += 1;
		}
		onProgress?.(index + 1, old.length);
	}
	// As replication does: a database whose index is built already reads the
	// log again (sealed-documents.js) and sees what moved.
	if (added > 0) to.events.emit('update', await to.log.get(moved.get(old[old.length - 1].hash)));
	return { total: old.length, moved: added };
}
