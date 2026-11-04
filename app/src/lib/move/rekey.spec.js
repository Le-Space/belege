// The successor of the books (#627) counts only as the books themselves wrote
// it: a member, who may write to the settings, cannot name one. Made-up log
// entries; the newest comes first, as OrbitDB's iterator gives them.
import { describe, expect, it } from 'vitest';

import { SUCCESSOR_SETTING, successorWrittenBy } from './rekey.js';

const BOOKS = 'did:key:z6MkBooks';
const MEMBER = 'did:key:z6MkMember';

/** @param {{ writer: string, key: string, value?: any, deleted?: boolean }[]} entries newest first */
const settings = (entries) => ({
	log: {
		async *iterator() {
			for (const e of entries) {
				yield {
					writer: e.writer,
					payload: { op: 'PUT', value: { key: e.key, value: e.value, deleted: e.deleted } }
				};
			}
		}
	},
	access: { writerOf: async (/** @type {any} */ entry) => entry.writer }
});

describe('the successor of the books', () => {
	it('is the books’ own entry; a member’s newer one is passed over', async () => {
		const db = settings([
			{ writer: MEMBER, key: SUCCESSOR_SETTING, value: { vault: {} } },
			{ writer: BOOKS, key: 'other', value: 1 },
			{ writer: BOOKS, key: SUCCESSOR_SETTING, value: { vault: { slots: [] }, peers: ['p'] } }
		]);
		expect(await successorWrittenBy(db, SUCCESSOR_SETTING, BOOKS)).toEqual({
			vault: { slots: [] },
			peers: ['p']
		});
	});

	it('is none when only a member wrote one', async () => {
		const db = settings([{ writer: MEMBER, key: SUCCESSOR_SETTING, value: { vault: {} } }]);
		expect(await successorWrittenBy(db, SUCCESSOR_SETTING, BOOKS)).toBeNull();
	});

	it('is none when the books took it back', async () => {
		const db = settings([
			{ writer: BOOKS, key: SUCCESSOR_SETTING, value: { vault: {} }, deleted: true },
			{ writer: BOOKS, key: SUCCESSOR_SETTING, value: { vault: { slots: [] } } }
		]);
		expect(await successorWrittenBy(db, SUCCESSOR_SETTING, BOOKS)).toBeNull();
	});
});
