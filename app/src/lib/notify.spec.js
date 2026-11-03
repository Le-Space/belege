// The notification at the end of a run (notify.js): asked on a click, shown
// only when the page is hidden and allowed, through the service worker when
// there is one. A fake Notification; nothing is shown.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { askToNotify, canNotify, notifyInBackground } from './notify.js';

/** @param {'default' | 'granted' | 'denied'} permission @param {'granted' | 'denied'} [answer] */
function fakeNotification(permission, answer = 'granted') {
	/** @type {any[]} */
	const shown = [];
	const N = /** @type {any} */ (
		function (/** @type {string} */ title, /** @type {any} */ options) {
			shown.push({ title, ...options });
		}
	);
	N.permission = permission;
	N.requestPermission = vi.fn(async () => (N.permission = answer));
	vi.stubGlobal('Notification', N);
	return { N, shown };
}

const note = { title: 'Belege: Wallets synchronisiert', body: '2 neue Buchungen.', tag: 't' };

afterEach(() => vi.unstubAllGlobals());

describe('notify', () => {
	it('without the API: nothing to ask, nothing shown', async () => {
		vi.stubGlobal('Notification', undefined);
		expect(canNotify()).toBe(false);
		expect(await askToNotify()).toBe(false);
		expect(await notifyInBackground(note)).toBe(false);
	});

	it('asks once, and keeps the answer', async () => {
		const { N } = fakeNotification('default');
		expect(await askToNotify()).toBe(true);
		expect(await askToNotify()).toBe(true);
		expect(N.requestPermission).toHaveBeenCalledTimes(1);
		const refused = fakeNotification('denied');
		expect(await askToNotify()).toBe(false);
		expect(refused.N.requestPermission).not.toHaveBeenCalled();
	});

	it('shows nothing while the page is in front, or without permission', async () => {
		const { shown } = fakeNotification('granted');
		const visible = { visibilityState: 'visible' };
		expect(await notifyInBackground(note, { document: visible, serviceWorker: null })).toBe(false);
		fakeNotification('denied');
		const hidden = { visibilityState: 'hidden' };
		expect(await notifyInBackground(note, { document: hidden, serviceWorker: null })).toBe(false);
		expect(shown).toHaveLength(0);
	});

	it('in the background: through the service worker, else directly', async () => {
		const { shown } = fakeNotification('granted');
		const hidden = { visibilityState: 'hidden' };
		/** @type {any[]} */
		const byWorker = [];
		const worker = {
			getRegistration: async () => ({
				showNotification: async (/** @type {string} */ title, /** @type {any} */ o) =>
					byWorker.push({ title, ...o })
			})
		};
		expect(
			await notifyInBackground(
				{ ...note, url: '/zahlungen' },
				{ document: hidden, serviceWorker: worker }
			)
		).toBe(true);
		expect(byWorker[0]).toMatchObject({
			title: note.title,
			body: note.body,
			data: { url: '/zahlungen' }
		});
		expect(shown).toHaveLength(0);
		expect(await notifyInBackground(note, { document: hidden, serviceWorker: null })).toBe(true);
		expect(shown[0]).toMatchObject({ title: note.title, body: note.body });
	});
});
