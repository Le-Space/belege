// Keep the screen on while something long runs (#512): a backup, a restore,
// the move of the books after an update. A phone that darkens its screen
// throttles the tab, and after a few minutes Chrome may throw it away – the
// restore then ends in a silent reload. The Screen Wake Lock API asks the
// browser not to darken the screen while the page is visible; the browser
// drops the lock when the tab goes to the background, so it is taken again
// when the tab comes back. Where the API does not exist (Firefox, older
// Safari), nothing happens, and the card says to keep the screen on.

/** @type {any} */
let sentinel = null;
/** @type {Promise<void> | null} a request under way: two holders share it */
let acquiring = null;
/** How many long runs want the screen on. */
let holders = 0;
let listening = false;

/** Whether this browser can hold the screen on. */
export const canKeepAwake = () =>
	typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean(navigator.wakeLock);

function acquire() {
	if (!canKeepAwake() || sentinel || acquiring || holders === 0) return Promise.resolve();
	if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
		return Promise.resolve();
	}
	acquiring = (async () => {
		try {
			const got = await /** @type {any} */ (navigator).wakeLock.request('screen');
			// Released by the browser (the tab went away) or by the last holder meanwhile.
			if (holders === 0) {
				got.release?.().catch?.(() => {});
				return;
			}
			sentinel = got;
			got.addEventListener?.('release', () => {
				if (sentinel === got) sentinel = null;
			});
		} catch {
			// Refused (low battery, a policy): the hint on the card stays.
			sentinel = null;
		} finally {
			acquiring = null;
		}
	})();
	return acquiring;
}

function onVisible() {
	if (document.visibilityState === 'visible') acquire();
}

/**
 * Hold the screen on until the returned function is called. Several holders
 * share one lock; it is released with the last of them.
 *
 * @returns {() => void}
 */
export function keepAwake() {
	holders += 1;
	if (!listening && typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisible);
		listening = true;
	}
	acquire();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holders = Math.max(0, holders - 1);
		if (holders === 0) {
			if (listening && typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onVisible);
				listening = false;
			}
			const held = sentinel;
			sentinel = null;
			held?.release?.().catch?.(() => {});
		}
	};
}

/** For tests: how many holders there are. */
export const awakeHolders = () => holders;
