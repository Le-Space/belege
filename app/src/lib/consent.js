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
// 4: where AI is used.
// 5: own wallets: the bridge asks public blockchain nodes about their addresses.
// 6: Bitcoin: every derived address is asked of an Esplora API from one IP.
// 7: own EVM wallets may be read through Alchemy, with the person's own key.
// 8: the invoicing app over UCEP: a relay sees the IP, once paired.
// 9: own devices may sync the books over a relay, once switched on.
// 10: an Akash wallet's older history is read from the Akash Console indexer.
// 11: own Ethereum addresses may be asked at Aleph for credits (issue #113).
// 12: a desktop may serve its bridge to own devices over UCEP (issue #142).
// 13: the relays are looked up on Aleph, and only the Le-Space wallets count;
//     what a relay, Aleph and the STUN servers see, said in one place.
// 14: own devices prove the passkey before they get the books; everything a
//     paired invoicing app is sent for an Eigenbeleg, listed.
// 15: Belege reads the paired invoicing app's issued invoices and tells it
//     which were paid, when and how much (issue #8).
// 16: a token CoinGecko does not price may be priced by its Uniswap pool at
//     the booking's block, asked of Alchemy (issue #163).
// 17: what a relay sees, said in full: also the protocols the node speaks;
//     no longer the databases' addresses nor the browser's user agent (#209).
export const CONSENT_VERSION = '17';

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
