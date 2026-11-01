// The bank's answer to an Enable Banking link (issue #224, step 2).
//
// After the consent the bank sends the browser to
// /integrationen/bank/verbunden?code=…&state=… (or ?error=…&state=…). The
// page loads afresh, and the books are locked: the code would sit in the
// address bar and the history all through the passkey prompt. So the layout
// calls `captureReturn` at once, before anything else: the answer moves to
// sessionStorage (this tab only) and leaves the address. The page takes it
// after unlocking (`takeReturn`) and hands it to the bridge.
//
// `rememberStart` keeps the state of the link this tab started. A returned
// state that is not that one is no answer to us; the bridge checks the same
// with its own list.
//
// The code is single-use, short-lived and worthless without the application's
// private key, which only the bridge has.

const RETURN_KEY = 'belege.enablebanking.return';
const START_KEY = 'belege.enablebanking.started';
export const RETURN_PATH = '/integrationen/bank/verbunden';

/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} TabStorage */

/**
 * @typedef {object} BankReturn
 * @property {string | null} code
 * @property {string | null} state
 * @property {string | null} error e.g. `access_denied`
 * @property {string | null} errorDescription the bank's words
 */

/**
 * Read an answer from an address: the one the browser arrived with, or one
 * pasted by hand. Null when it carries none.
 *
 * @param {string | URL} address
 * @returns {BankReturn | null}
 */
export function parseReturn(address) {
	let url;
	try {
		url = new URL(String(address).trim());
	} catch {
		return null;
	}
	const p = url.searchParams;
	const pick = (/** @type {string} */ k, /** @type {number} */ max) => {
		const v = p.get(k);
		return v && v.length <= max ? v : null;
	};
	const answer = {
		code: pick('code', 512),
		state: pick('state', 64),
		error: pick('error', 100),
		errorDescription: pick('error_description', 300)
	};
	return answer.code || answer.error ? answer : null;
}

/**
 * At page load: take the answer out of the address into this tab's storage.
 *
 * @param {{ location: Pick<Location, 'pathname' | 'href'>, replace: (path: string) => void, storage: TabStorage }} env
 *   `replace` changes the address without a navigation (SvelteKit's replaceState)
 * @returns {boolean} whether there was one
 */
export function captureReturn({ location, replace, storage }) {
	if (location.pathname.replace(/\/+$/, '') !== RETURN_PATH) return false;
	const answer = parseReturn(location.href);
	if (!answer) return false;
	try {
		storage.setItem(RETURN_KEY, JSON.stringify(answer));
	} catch {
		// No storage: the page will say the answer is missing; nothing is kept.
	}
	replace(RETURN_PATH);
	return true;
}

/**
 * The captured answer, once: taken out of storage as it is read.
 *
 * @param {TabStorage} storage
 * @returns {BankReturn | null}
 */
export function takeReturn(storage) {
	try {
		const raw = storage.getItem(RETURN_KEY);
		storage.removeItem(RETURN_KEY);
		return raw ? /** @type {BankReturn} */ (JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

/**
 * Before going to the bank: the link this tab started.
 *
 * @param {TabStorage} storage
 * @param {{ state: string, bank: string }} start
 */
export function rememberStart(storage, start) {
	try {
		storage.setItem(START_KEY, JSON.stringify({ ...start, at: Date.now() }));
	} catch {
		// The bridge's own check still holds.
	}
}

/**
 * The link this tab started, once.
 *
 * @param {TabStorage} storage
 * @returns {{ state: string, bank: string, at: number } | null}
 */
export function takeStart(storage) {
	try {
		const raw = storage.getItem(START_KEY);
		storage.removeItem(START_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}
