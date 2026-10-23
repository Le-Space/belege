// What a folder check brought, read as the switch says (#475, folder-watch.js
// `readNewFiles`): with "gleich auslesen" off nothing goes to the model; a
// sender to confirm waits; an image is handed to the extraction, which marks
// it without a request. Everything here is made up.
import { describe, expect, it } from 'vitest';

import { readNewFiles } from './folder-watch.js';

const pdf = (/** @type {string} */ id) => /** @type {any} */ ({ id, mime: 'application/pdf' });
const image = (/** @type {string} */ id) => /** @type {any} */ ({ id, mime: 'image/jpeg' });
const created = [pdf('a'), pdf('b'), image('c'), { ...pdf('d'), sender: 'unknown' }];
const needsConfirmation = (/** @type {any} */ r) => r.sender === 'unknown';

describe('new folder files and the model', () => {
	it('"gleich auslesen" off: nothing is read, all of them wait', async () => {
		/** @type {string[]} */ const read = [];
		const r = await readNewFiles({
			created,
			readAfter: false,
			canRead: true,
			needsConfirmation,
			read: async (rec) => read.push(rec.id)
		});
		expect(read).toEqual([]);
		expect(r).toEqual({ read: 0, waiting: 4, images: 0 });
	});

	it('on: PDFs read, the image counted apart, a sender to confirm waits', async () => {
		/** @type {string[]} */ const read = [];
		const r = await readNewFiles({
			created,
			readAfter: true,
			canRead: true,
			needsConfirmation,
			read: async (rec) => read.push(rec.id)
		});
		expect(read).toEqual(['a', 'b', 'c']);
		expect(r).toEqual({ read: 2, waiting: 1, images: 1 });
	});

	it('no bridge paired: nothing read; a failed read waits too', async () => {
		expect(
			await readNewFiles({
				created,
				readAfter: true,
				canRead: false,
				needsConfirmation,
				read: async () => {}
			})
		).toEqual({ read: 0, waiting: 4, images: 0 });
		const r = await readNewFiles({
			created: [pdf('x')],
			readAfter: true,
			canRead: true,
			needsConfirmation,
			read: async () => {
				throw new Error('the bridge did not answer');
			}
		});
		expect(r).toEqual({ read: 0, waiting: 1, images: 0 });
	});
});
