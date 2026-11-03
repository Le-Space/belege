// Which books an unlock opens (#612), when this browser keeps memberships: the
// passkey's own, or the books of someone it is a member of. Chosen on the
// unlock screen before the touch, from what the member vaults say openly
// beside their ciphertext (the books' name), and kept in this browser.

import { loadMemberships } from './member-vault.js';

export const OPEN_BOOKS_KEY = 'belege.open-books';

/** @returns {Storage | null} */
function storage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * The memberships this browser keeps, to choose from: id and name.
 *
 * @returns {{ id: string, label: string }[]}
 */
export function membershipChoices() {
	const s = storage();
	if (!s) return [];
	try {
		return loadMemberships(s).map((r) => ({
			id: String(r.vault.id),
			label: String(r.books?.label || '–')
		}));
	} catch {
		return [];
	}
}

/** The membership chosen for the next unlock; '' for the passkey's own books. */
export function chosenBooks() {
	const id = storage()?.getItem(OPEN_BOOKS_KEY) ?? '';
	return membershipChoices().some((c) => c.id === id) ? id : '';
}

/** @param {string} id a membership's id, or '' for the own books */
export function chooseBooks(id) {
	try {
		if (id) storage()?.setItem(OPEN_BOOKS_KEY, id);
		else storage()?.removeItem(OPEN_BOOKS_KEY);
	} catch {
		// Not kept: the own books next time.
	}
}
