// Ported from orbitdb/orbitdb @orbitdb/core 4.0.0 (src/databases/documents.js), MIT.
// Changed: forwards `encryption` (and `onUpdate`) to `Database`, drops the
// JSDoc examples, and keeps an index of the newest version of every key.
//
// The index (docs/performance.md): upstream's `get` walks the log back from
// the heads until the key turns up, and `all` walks the whole log, every
// superseded version included – each entry an IndexedDB read, a decrypt and
// a CBOR decode. Here the log is walked once, on the first read, into a Map
// of key → newest { hash, key, value }; the database's own writes update the
// Map as they happen. An entry that arrives from elsewhere (replication) makes
// the next read walk the log again. Reads hand out copies, so no caller can
// change the index by changing a record.
//
// Why this copy exists: in @orbitdb/core 4.0.0 the Documents factory
// destructures its options as `{ …, onUpdate, encrypt }` while `orbitdb.open()`
// passes `encryption`, and `Database` reads `encryption` too. So
//
//   orbitdb.open(name, { type: 'documents', encryption })
//
// silently writes every document in plaintext — no error, no warning. KeyValue
// and Events are not affected. `store.spec.js` reads the raw blocks back to
// prove the payloads here are sealed; drop this file once upstream is fixed
// and that test still passes with the stock `Documents`.

import { Database } from '@orbitdb/core';

const type = 'documents';

/**
 * A deep copy of plain data: objects, arrays, bytes and primitives – what a
 * record holds. Unlike structuredClone it takes a Svelte `$state` proxy (the
 * pages pass those in), reading it as the plain object it stands for.
 *
 * @param {any} v
 * @returns {any}
 */
function plain(v) {
	if (v === null || typeof v !== 'object') return v;
	if (v instanceof Uint8Array) return v.slice();
	if (v instanceof Date) return new Date(v.getTime());
	if (Array.isArray(v)) return v.map(plain);
	/** @type {Record<string, any>} */
	const out = {};
	for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = plain(x);
	return out;
}

/** About what an entry takes beside its sealed payload: an estimate for the identity hash, the key, the clock, the links and the signature. */
export const ENVELOPE_BYTES = 350;

/**
 * A documents database that honours the `encryption` option.
 *
 * @param {{ indexBy?: string }} [options]
 */
const SealedDocuments =
	({ indexBy = '_id' } = {}) =>
	async (/** @type {any} */ options) => {
		const database = await Database(options);

		const { addOperation, log, events } = database;

		/** @type {Map<string, { hash: string, key: string, value: any }> | null} key → newest PUT; null: to build */
		let index = null;
		/** @type {Promise<Map<string, { hash: string, key: string, value: any }>> | null} */
		let building = null;
		/** Hashes the database reported that no own write has claimed yet: from elsewhere. */
		const unclaimed = new Set();
		events.on('update', (/** @type {any} */ entry) => unclaimed.add(entry.hash));

		/** Walk the log once: newest first, the first sight of a key wins. */
		async function build() {
			/** @type {{ hash: string, key: string, value: any }[]} */
			const newestFirst = [];
			/** @type {Set<string>} */
			const seen = new Set();
			for await (const entry of log.iterator()) {
				const { op, key, value } = entry.payload;
				if (seen.has(key)) continue;
				seen.add(key);
				if (op === 'PUT') newestFirst.push({ hash: entry.hash, key, value });
			}
			// Oldest write first, as upstream's `all` returns them.
			return new Map(newestFirst.reverse().map((doc) => [doc.key, doc]));
		}

		/** The index, walked again when something arrived from elsewhere. */
		async function current() {
			if (unclaimed.size) {
				unclaimed.clear();
				index = null;
			}
			if (index) return index;
			building ??= build().finally(() => {
				building = null;
			});
			index = await building;
			return index;
		}

		/** @param {{ hash: string, key: string, value: any }} doc */
		const copy = (doc) => ({ hash: doc.hash, key: doc.key, value: plain(doc.value) });

		/** @param {Record<string, any>} doc */
		const put = async (doc) => {
			const key = doc[indexBy];
			if (!key) throw new Error(`The provided document doesn't contain field '${indexBy}'`);
			const value = plain(doc);
			const hash = await addOperation({ op: 'PUT', key, value });
			// While the index is being built, the walk may or may not have seen
			// this entry: left unclaimed, the next read builds it again.
			if (!building) unclaimed.delete(hash);
			if (index) {
				// Moved to the end: the newest write last, as a rebuild would order it.
				index.delete(key);
				index.set(key, { hash, key, value });
			}
			return hash;
		};

		/** @param {string} key */
		const del = async (key) => {
			if (!(await get(key))) throw new Error(`No document with key '${key}' in the database`);
			const hash = await addOperation({ op: 'DEL', key, value: null });
			if (!building) unclaimed.delete(hash);
			index?.delete(key);
			return hash;
		};

		/** @param {string} key */
		const get = async (key) => {
			const doc = (await current()).get(key);
			return doc ? copy(doc) : undefined;
		};

		/** @param {(doc: any) => boolean} findFn */
		const query = async (findFn) => {
			const results = [];
			for (const doc of (await current()).values()) {
				if (findFn(doc.value)) results.push(plain(doc.value));
			}
			return results;
		};

		/** Newest write first, as upstream's iterator. @param {{ amount?: number }} [filters] */
		const iterator = async function* ({ amount = -1 } = {}) {
			const docs = [...(await current()).values()].reverse();
			const end = amount > -1 ? amount : docs.length;
			for (const doc of docs.slice(0, end)) yield copy(doc);
		};

		const all = async () => [...(await current()).values()].map(copy);

		/**
		 * What the log takes (issue #212): every entry ever written – an
		 * append-only log keeps each version of a record – and the bytes of their
		 * sealed payloads, plus about ENVELOPE_BYTES per entry for what wraps it
		 * (identity, key, clock, links, signature). A walk over the whole log.
		 */
		const stats = async () => {
			let entries = 0;
			let bytes = 0;
			for await (const entry of log.iterator()) {
				entries++;
				bytes += (entry._payload?.byteLength ?? 0) + ENVELOPE_BYTES;
			}
			return { entries, bytes };
		};

		return { ...database, type, put, del, get, iterator, query, indexBy, all, stats };
	};

SealedDocuments.type = type;

export default SealedDocuments;
