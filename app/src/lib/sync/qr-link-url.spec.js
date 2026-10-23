// The invite as a link (qr-link-url.js): built, read back from a scan or a
// paste, taken out of the address and kept for the tab ten minutes; and iOS
// Safari outside the home-screen app told apart.
import { describe, expect, it } from 'vitest';

import {
	PENDING_KEY,
	codeFrom,
	inviteLink,
	iosOutsideApp,
	pendingInvite,
	takeLinkedInvite
} from './qr-link-url.js';

const CODE = 'bQRoffer.Ab+c/d=e';

/** A Storage in memory. @returns {Storage} */
function memoryStorage() {
	const map = new Map();
	return /** @type {any} */ ({
		getItem: (/** @type {string} */ k) => map.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => map.delete(k)
	});
}

describe('the QR invite as a link', () => {
	it('puts the code in the fragment, and reads it back – or a bare code as it is', () => {
		const link = inviteLink(CODE, 'https://belege.example/');
		expect(link).toBe(`https://belege.example/#qr=${encodeURIComponent(CODE)}`);
		expect(codeFrom(link)).toBe(CODE);
		expect(codeFrom(`  ${CODE}\n`)).toBe(CODE);
		// A link without the key is not an invite: passed on as it is, and refused later.
		expect(codeFrom('https://belege.example/#other=1')).toBe('https://belege.example/#other=1');
	});

	it('takes it out of the address, keeps it for the tab, ten minutes long', () => {
		const storage = memoryStorage();
		/** @type {string[]} */
		const replaced = [];
		let now = 1_000;
		const code = takeLinkedInvite({
			location: { hash: `#qr=${encodeURIComponent(CODE)}`, pathname: '/', search: '' },
			storage,
			replace: (url) => replaced.push(url),
			now: () => now
		});
		expect(code).toBe(CODE);
		expect(replaced).toEqual(['/']);
		expect(pendingInvite(storage, () => now + 60_000)).toBe(CODE);
		expect(pendingInvite(storage, () => now + 11 * 60_000)).toBeNull();
		expect(storage.getItem(PENDING_KEY)).toBeNull();
		// An address without one leaves everything as it is.
		now = 2_000;
		expect(
			takeLinkedInvite({
				location: { hash: '#x=1', pathname: '/zahlungen', search: '?a=1' },
				storage,
				replace: (url) => replaced.push(url)
			})
		).toBeNull();
		expect(replaced).toEqual(['/']);
	});

	it('knows iOS Safari outside the home-screen app', () => {
		const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
		expect(iosOutsideApp(iphone, false)).toBe(true);
		expect(iosOutsideApp(iphone, true)).toBe(false);
		expect(iosOutsideApp({ ...iphone, standalone: true }, false)).toBe(false);
		// An iPad says Macintosh, with touch.
		expect(iosOutsideApp({ userAgent: 'Macintosh', maxTouchPoints: 5 }, false)).toBe(true);
		expect(iosOutsideApp({ userAgent: 'Macintosh', maxTouchPoints: 0 }, false)).toBe(false);
		expect(iosOutsideApp({ userAgent: 'Linux; Android 15' }, false)).toBe(false);
	});
});
