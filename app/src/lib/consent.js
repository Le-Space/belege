import { writable } from 'svelte/store';

/**
 * Whether the consent screen has been read, and whether it is on screen.
 *
 * The screen opens by itself until somebody presses "Verstanden", and stays
 * reachable afterwards from the footer and from the header's "Nur dieses
 * Gerät". What is remembered is a flag with a version, nothing else: when what
 * the screen says changes in a way people must read again, bump
 * `CONSENT_VERSION` and it opens once more.
 *
 * The order follows Le-Space/simple-todo apps/escrow01: first what the app
 * does with your data, then the identity. There the passkey choice sits inside
 * the dialog; here onboarding stays its own screen behind it, because its
 * buttons call WebAuthn directly from their own click.
 */
export const CONSENT_STORAGE_KEY = 'belege.consent';
// 2: receipts from the mailbox, and DeepSeek reading them (phase 1, step 3).
// 3: customer portals (Vodafone) through a browser the bridge starts.
export const CONSENT_VERSION = '4';

/** @typedef {Pick<Storage, 'getItem' | 'setItem'>} FlagStorage */

/** @returns {FlagStorage | null} */
function browserStorage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * @param {{ storage?: () => FlagStorage | null, key?: string, version?: string }} [options]
 */
export function createConsent({
	storage = browserStorage,
	key = CONSENT_STORAGE_KEY,
	version = CONSENT_VERSION
} = {}) {
	function read() {
		try {
			return storage()?.getItem(key) === version;
		} catch {
			// Unreadable storage: show it. Read twice beats never read.
			return false;
		}
	}

	const accepted = writable(read());
	const open = writable(!read());

	return {
		accepted: { subscribe: accepted.subscribe },
		open: { subscribe: open.subscribe },
		/** "Verstanden": remember it, and close. */
		accept() {
			try {
				storage()?.setItem(key, version);
			} catch {
				// Blocked or full: accepted for this page load, asked again next time.
			}
			accepted.set(true);
			open.set(false);
		},
		/** From the footer or the header, after it was accepted. */
		reopen() {
			open.set(true);
		},
		/** Close without a decision; only once it has been accepted. */
		close() {
			if (read() || current(accepted)) open.set(false);
		}
	};
}

/**
 * @template T
 * @param {{ subscribe: (run: (value: T) => void) => () => void }} store
 * @returns {T}
 */
function current(store) {
	/** @type {T} */
	let value = /** @type {T} */ (undefined);
	store.subscribe((v) => (value = v))();
	return value;
}

export const consent = createConsent();
