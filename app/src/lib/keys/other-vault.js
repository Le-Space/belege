// The other books of this passkey (#524). A passkey with a slot in a vault
// kept on Aleph can open Belege on a new device without "Restore": the device
// founds books of its own, and from then on nothing asked the index again – a
// backup of the real books was refused as another vault's, with no way on.
//
// Here: when the index is asked, and what is said of what it names. Asking
// and switching are the session's (session.svelte.js `lookForOtherBooks`,
// `openOtherBooks`); whether a vault from the index is one of other books
// that this passkey opens is the vault's (books-vault.js `otherBooks`).

/** Set for the unlock that follows the person's yes; gone once read. Nothing secret. */
export const OTHER_BOOKS_KEY = 'belege.vault.other';

/**
 * Whether an unlock asks the index by itself: only the owner's own books, only
 * when they look empty, and only on a device whose network the person has
 * switched on – device sync, not paused, in a mode that meets over the public
 * relays, for which this unlock has asked Aleph already (sync/network-mode.js
 * `relaysFor`). In the own network or by code alone, Aleph is not asked
 * unasked. Anything else waits for the person: a restore that failed, or the
 * question under Settings → Keys.
 *
 * @param {{ paused: boolean, online: boolean, mode: string, member: boolean, empty: boolean }} state
 */
export const asksAtUnlock = ({ paused, online, mode, member, empty }) =>
	!paused && online && (mode === 'public' || mode === 'both') && !member && empty;

/**
 * Whether what the index named is offered. After a refused backup, and when
 * the person asked: always. At an unlock, unasked: only when that vault has
 * more slots than the one here – the books made elsewhere, not a leftover.
 *
 * @param {'restore' | 'asked' | 'unlock'} why
 * @param {{ vault: { slots: unknown[] } }} here
 * @param {{ vault: { slots: unknown[] } }} there
 */
export const worthOffering = (why, here, there) =>
	why !== 'unlock' || there.vault.slots.length > here.vault.slots.length;

/**
 * What the offer says of that vault: how many passkeys open it, whether it
 * has recovery words, and since when – the earliest date a slot there names.
 * Dates come from outside: one that is no date is passed over.
 *
 * @param {import('../books-vault.js').VaultRecord} record
 * @param {string} wordsKid the id of the words' slot
 * @returns {{ passkeys: number, words: boolean, since: string }}
 */
export function describeOther(record, wordsKid) {
	const kids = record.vault.slots.map((/** @type {{ kid: string }} */ s) => s.kid);
	const dates = record.slots
		.map((s) => s.addedAt)
		.filter((d) => typeof d === 'string' && d && !Number.isNaN(Date.parse(d)))
		.sort((a, b) => Date.parse(a) - Date.parse(b));
	return {
		passkeys: kids.filter((/** @type {string} */ k) => k !== wordsKid).length,
		words: kids.includes(wordsKid),
		since: dates[0] ?? ''
	};
}
