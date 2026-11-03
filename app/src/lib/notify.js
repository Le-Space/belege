// A system notification when a long run ends while Belege is in the
// background ("Alle Wallets synchronisieren"): asked for once, on a click, never at
// load; shown only when the page is hidden – in front, the page says it
// itself. It names counts only: a notification may show on a locked screen,
// so no amounts, names or addresses go into it.

/** @returns {any} */
const notificationApi = () =>
	typeof globalThis.Notification === 'function' ? globalThis.Notification : null;

/** Whether this browser can show one at all (an iPhone only for Belege installed as an app). */
export const canNotify = () => notificationApi() !== null;

/**
 * Ask for permission, from a click: once 'default', the browser's own prompt;
 * afterwards the answer stays.
 *
 * @returns {Promise<boolean>} granted
 */
export async function askToNotify() {
	const N = notificationApi();
	if (!N) return false;
	if (N.permission === 'default') {
		try {
			await N.requestPermission();
		} catch {
			// Refused or not asked: no notification.
		}
	}
	return N.permission === 'granted';
}

/**
 * Show a notification when allowed and the page is hidden. Chrome on Android
 * shows one only through the service worker; elsewhere directly.
 *
 * @param {{ title: string, body: string, tag: string, url?: string }} note
 * @param {{ document?: { visibilityState: string }, serviceWorker?: any }} [env]
 * @returns {Promise<boolean>} shown
 */
export async function notifyInBackground(
	{ title, body, tag, url = '/' },
	{ document: doc = globalThis.document, serviceWorker = globalThis.navigator?.serviceWorker } = {}
) {
	const N = notificationApi();
	if (!N || N.permission !== 'granted') return false;
	if (doc?.visibilityState === 'visible') return false;
	const options = { body, tag, icon: '/icons/icon-192.png', data: { url } };
	try {
		const registration = await serviceWorker?.getRegistration?.();
		if (registration?.showNotification) {
			await registration.showNotification(title, options);
			return true;
		}
	} catch {
		// No worker: directly below.
	}
	try {
		new N(title, options);
		return true;
	} catch {
		return false;
	}
}
