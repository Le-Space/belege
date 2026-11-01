// Keep the page alive through an app switch on a phone (#525): a backup, a
// restore, the move of the books after an update.
//
// The screen wake lock (wake-lock.js, #512) holds the screen, and the browser
// drops it the moment the page is hidden. Switch to a messenger for a few
// minutes and Chromium freezes the tab, then discards it under memory
// pressure: the download's reader stops, the gateway gives up, or the tab
// comes back with a reload and the restore starts over. Chromium does not
// freeze a page that is audibly playing. `createKeepAlive()` from
// `@le-space/libp2p-webrtc-qr` loops a track through an AudioContext and
// labels the platform's media notification, which doubles as a way back into
// the app. Three rules from its docs apply unchanged:
//
//   - Audible, not silent: a stream the browser judges inaudible stops
//     counting as playback. The track is keep-alive-track.js, a soft note
//     every two seconds.
//   - Started inside the gesture: the AudioContext resumes only after the
//     person interacted with the page. Chromium remembers a click for the
//     page's life (sticky activation); Safari is stricter, so the holders
//     start it as close to the click as they can.
//   - Not a wake lock: both are held, each for its half.
//
// Offered only where leaving suspends the page (`leavingSuspendsUs()`: phones
// and tablets), never on a desktop, where a background tab keeps running and a
// tone would be noise. On by default, off per browser (localStorage); the
// books are closed while a restore runs, so the choice cannot live in the
// settings. Several holders share one keep-alive, stopped with the last of
// them – like the wake lock.
//
// Whether this survives a real app switch on Android is the open measurement
// in #525; the package verified the audio graph only.

import { createKeepAlive, leavingSuspendsUs } from '@le-space/libp2p-webrtc-qr';
import { keepAliveTrackUrl } from './keep-alive-track.js';

/** Where this browser keeps the choice; only `off` is ever written. */
export const KEEP_ALIVE_KEY = 'belege.keep-alive';

/** Quiet enough for a meeting, audible in a pocket. */
const VOLUME = 0.25;

/** Whether a tone would help here: a phone or tablet, where leaving suspends the page. */
export const keepAliveOffered = () => leavingSuspendsUs();

/**
 * Whether this browser wants the tone: yes unless it said `off`.
 *
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage
 */
export function keepAliveWanted(storage) {
	return storage?.getItem(KEEP_ALIVE_KEY) !== 'off';
}

/**
 * Keep the choice; the default leaves nothing behind.
 *
 * @param {Pick<Storage, 'setItem' | 'removeItem'> | null | undefined} storage
 * @param {boolean} wanted
 */
export function setKeepAlive(storage, wanted) {
	if (wanted) storage?.removeItem(KEEP_ALIVE_KEY);
	else storage?.setItem(KEEP_ALIVE_KEY, 'off');
}

/** @type {ReturnType<typeof createKeepAlive> | null} the one playing, while anyone holds it */
let playing = null;
let holders = 0;

/**
 * @typedef {object} HoldOptions
 * @property {string} title what the media notification says: "Belege stellt wieder her …"
 * @property {Pick<Storage, 'getItem'> | null} [storage] where the choice is kept; `localStorage` unless given
 * @property {boolean} [offered] for tests: whether leaving suspends this page
 */

/**
 * Play until the returned function is called. Call it from the click, before
 * the first `await`. Nothing plays on a desktop, or when this browser said
 * `off`; the release is then a no-op.
 *
 * @param {HoldOptions} options
 * @returns {() => void}
 */
export function holdAlive({ title, storage, offered }) {
	const where = storage === undefined ? globalThis.localStorage : storage;
	if (!(offered ?? keepAliveOffered()) || !keepAliveWanted(where)) return () => {};
	holders += 1;
	if (!playing) {
		playing = createKeepAlive({
			track: keepAliveTrackUrl(),
			volume: VOLUME,
			metadata: { title, artist: 'Le Space Belege' }
		});
		// Not awaited: the AudioContext is made and resumed before `start()`
		// first yields, which is what the gesture has to cover. Whether it
		// then plays is not this caller's problem; the restore runs either way.
		playing.start().catch(() => {});
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holders = Math.max(0, holders - 1);
		if (holders === 0) {
			const done = playing;
			playing = null;
			done?.stop().catch(() => {});
		}
	};
}

/** For tests: how many hold the tone. */
export const aliveHolders = () => holders;
