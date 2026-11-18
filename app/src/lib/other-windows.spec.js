// Whether another window of Belege answers (#803), with a channel made here.
import { describe, expect, it } from 'vitest';
import { otherWindowOpen } from './other-windows.js';

/** A BroadcastChannel whose other side answers "here", or stays silent. @param {boolean} answers */
function fakeChannel(answers) {
	/** @type {{ posted: any[], closed: number }} */
	const seen = { posted: [], closed: 0 };
	class Channel {
		/** @type {((event: { data: any }) => void) | null} */
		onmessage = null;
		/** @param {any} message */
		postMessage(message) {
			seen.posted.push(message);
			if (answers) queueMicrotask(() => this.onmessage?.({ data: { kind: 'here' } }));
		}
		close() {
			seen.closed++;
		}
	}
	return { Channel: /** @type {any} */ (Channel), seen };
}

describe('otherWindowOpen', () => {
	it('is true when another window answers, and sends nothing but the question', async () => {
		const { Channel, seen } = fakeChannel(true);
		expect(await otherWindowOpen({ Channel, waitMs: 50 })).toBe(true);
		expect(seen.posted).toEqual([{ kind: 'who', from: expect.stringMatching(/^[a-z0-9]+$/) }]);
		expect(seen.closed).toBe(1);
	});

	it('is false when none answers in time, or the browser has no such channel', async () => {
		const { Channel, seen } = fakeChannel(false);
		expect(await otherWindowOpen({ Channel, waitMs: 10 })).toBe(false);
		expect(seen.closed).toBe(1);
		expect(await otherWindowOpen({ Channel: /** @type {any} */ (undefined) })).toBe(false);
	});
});
