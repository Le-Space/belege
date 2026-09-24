// Test helper: the real `createCollection` over a database kept in a Map, so
// import logic is tested with the store's own put/list semantics, fast.
// Like dag-cbor under OrbitDB, it refuses `undefined` anywhere in a record.
import { createCollection } from '../store/repository.js';

/** @param {unknown} value @param {string} path */
function assertEncodable(value, path) {
	if (value === undefined) {
		throw new Error(`\`undefined\` is not supported by the IPLD Data Model (${path})`);
	}
	if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
		for (const [k, v] of Object.entries(value)) assertEncodable(v, `${path}.${k}`);
	}
}

/** @param {import('../store/repository.js').CollectionName} name */
export function memoryCollection(name) {
	/** @type {Map<string, any>} */
	const docs = new Map();
	let tick = 0;
	const db = {
		/** @param {string} id */
		get: async (id) => (docs.has(id) ? { value: structuredClone(docs.get(id)) } : undefined),
		/** @param {any} doc */
		put: async (doc) => {
			assertEncodable(doc, name);
			docs.set(doc.id, structuredClone(doc));
		},
		all: async () => [...docs.values()].map((value) => ({ value: structuredClone(value) })),
		events: { on() {}, off() {} }
	};
	// Distinct, increasing timestamps: ULIDs then sort in write order.
	const now = () => new Date(Date.UTC(2026, 8, 24) + tick++);
	return { collection: createCollection(db, name, { author: 'did:key:test', now }), docs };
}
