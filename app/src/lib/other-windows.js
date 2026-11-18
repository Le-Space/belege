// Whether Belege is open in another tab, window or as the installed app of
// this browser: asked when an unlock waits for the browser's storage (#803),
// because another window of the same site is the first thing to close then.
//
// A BroadcastChannel of this origin: a question, and "here" from every other
// window that listens. Nothing of the books is in a message: its kind, and a
// random mark of the asking page.
// A window of a build before this one does not answer; "none" is then wrong,
// so the screen never says that no other window is open.

const CHANNEL = 'belege-presence';
// This window, so that it does not answer its own question: a channel hears
// every other channel of the origin, those of its own window too. Random, of
// this page load only, and it says nothing about the books.
const SELF = Math.random().toString(36).slice(2);

/** @type {BroadcastChannel | null} */
let listening = null;

/** Answer other windows' question from now on. Safe to call more than once. */
export function answerOtherWindows() {
	if (listening || typeof BroadcastChannel === 'undefined') return;
	try {
		listening = new BroadcastChannel(CHANNEL);
		listening.onmessage = (event) => {
			if (event.data?.kind === 'who' && event.data.from !== SELF) {
				listening?.postMessage({ kind: 'here' });
			}
		};
	} catch {
		listening = null;
	}
}

/**
 * @param {{ waitMs?: number, Channel?: typeof BroadcastChannel }} [options]
 * @returns {Promise<boolean>} true when another window answered within `waitMs`
 */
export function otherWindowOpen({ waitMs = 500, Channel = globalThis.BroadcastChannel } = {}) {
	if (typeof Channel === 'undefined') return Promise.resolve(false);
	return new Promise((resolve) => {
		/** @type {BroadcastChannel} */
		let channel;
		try {
			channel = new Channel(CHANNEL);
		} catch {
			resolve(false);
			return;
		}
		const done = (/** @type {boolean} */ answer) => {
			clearTimeout(timer);
			channel.close();
			resolve(answer);
		};
		const timer = setTimeout(() => done(false), waitMs);
		channel.onmessage = (event) => {
			if (event.data?.kind === 'here') done(true);
		};
		channel.postMessage({ kind: 'who', from: SELF });
	});
}
