// Test helper: the real `createCollection` over a database kept in a Map, so
// import logic is tested with the store's own put/list semantics, fast.
import { createCollection } from '../store/repository.js';

/** @param {import('../store/repository.js').CollectionName} name */
export function memoryCollection(name) {
	/** @type {Map<string, any>} */
	const docs = new Map();
	let tick = 0;
	const db = {
		/** @param {string} id */
		get: async (id) => (docs.has(id) ? { value: structuredClone(docs.get(id)) } : undefined),
		/** @param {any} doc */
		put: async (doc) => void docs.set(doc.id, structuredClone(doc)),
		all: async () => [...docs.values()].map((value) => ({ value: structuredClone(value) })),
		events: { on() {}, off() {} }
	};
	// Distinct, increasing timestamps: ULIDs then sort in write order.
	const now = () => new Date(Date.UTC(2026, 8, 24) + tick++);
	return { collection: createCollection(db, name, { author: 'did:key:test', now }), docs };
}
