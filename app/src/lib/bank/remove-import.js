// Take a file import back: an account that came from a file (a CAMT.053
// statement, a card statement) with every booking on it. For the wrong file,
// or a test file, imported into real books.
//
// Only accounts from a file: an account a sync fills (Hibiscus, Enable
// Banking, an exchange, a wallet) would be made again by the next sync, with
// its bookings staying out – that is switched off where the sync is set up.
//
// Removing is a soft delete, as everywhere in these books (store/repository.js):
// out of every list, kept in the append-only log. The matches and questions
// that point at one of the bookings go with them; a receipt that was matched
// stays and is open again after the next matching run. The Verlauf gets an
// entry. The same file can be imported again afterwards: it makes a new
// account with new bookings.

import { recordEvent } from '../activity/events.js';
import { isActive } from '../matching/engine.js';
import { CARD_SOURCE } from './card-import.js';
import { accountLabel } from './format.js';

/** @typedef {Record<string, any>} Rec */

/** The sources an account from a file has. */
const FILE_SOURCES = new Set(['camt', CARD_SOURCE]);

/** @param {Rec | null | undefined} account */
export const isFileAccount = (account) =>
	Boolean(account) && !account?.deleted && FILE_SOURCES.has(String(account?.source));

/** @param {string} accountId */
const onAccount = (accountId) => (/** @type {Rec} */ t) => t.accountId === accountId;

/**
 * What taking an account's import back would remove: said before it is done.
 *
 * @param {{ transactions: any }} store
 * @param {string} accountId
 * @returns {Promise<{ bookings: number, withReceipt: number, confirmed: number }>}
 */
export async function fileImportContents(store, accountId) {
	const bookings = await store.transactions.list({ where: onAccount(accountId) });
	return {
		bookings: bookings.length,
		withReceipt: bookings.filter((/** @type {Rec} */ t) => Boolean(t.receiptId)).length,
		confirmed: bookings.filter((/** @type {Rec} */ t) => Boolean(t.booking?.confirmedAt)).length
	};
}

/**
 * Take the account out, with its bookings and what points at them.
 *
 * @param {{ accounts: any, transactions: any, matches: any, questions: any, events?: any }} store
 * @param {string} accountId
 * @returns {Promise<{ bookings: number, matches: number }>}
 */
export async function removeFileImport(store, accountId) {
	const account = await store.accounts.get(accountId);
	if (!isFileAccount(account)) throw new Error('Not an account from a file import.');

	/** @type {Set<string>} */
	const ids = new Set();
	for (const t of await store.transactions.list({ where: onAccount(accountId) })) {
		ids.add(String(t.id));
		await store.transactions.softDelete(t.id);
	}
	const points = (/** @type {Rec} */ r) => ids.has(String(r.transactionId ?? ''));
	let matches = 0;
	for (const m of await store.matches.list({ where: points })) {
		if (isActive(m)) {
			await store.matches.put({ ...m, state: 'rejected' });
			matches++;
		}
		await store.matches.softDelete(m.id);
	}
	for (const q of await store.questions.list({ where: points })) {
		await store.questions.softDelete(q.id);
	}
	await store.accounts.softDelete(accountId);
	await recordEvent(store.events, 'import-removed', {
		accountId,
		account: accountLabel(account),
		source: account.source,
		bookings: ids.size,
		matches
	});
	return { bookings: ids.size, matches };
}
