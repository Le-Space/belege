// Company credit cards (issue #382): each card an account of its own, its
// statement's lines its bookings (card-csv.js). The matching links them to
// their receipts like any payment – paid by the company, in the euros the
// card charged – and the card's ledger account is set under Einstellungen
// like a bank account's. The monthly debit on the bank account settles the
// card, an own transfer.
//
// The account is known by a name and the card number's last four digits
// (the issuer prints them on the statement and the bank on the debit);
// nothing more of the card is kept.

import { recordEvent } from '../activity/events.js';
import { importTransactions, upsertAccount } from './import.js';

export const CARD_SOURCE = 'card';

/** @param {Record<string, any> | null | undefined} account */
export const isCardAccount = (account) => account?.kind === 'card' && !account?.deleted;

/**
 * A card as it is kept: a name and four digits.
 *
 * @param {{ name?: unknown, last4?: unknown }} input
 * @returns {{ name: string, last4: string }}
 */
export function cleanCard(input) {
	const name = String(input.name ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);
	const last4 = String(input.last4 ?? '').replace(/\s+/g, '');
	if (!name) throw Object.assign(new Error('A card needs a name.'), { code: 'name' });
	if (!/^\d{4}$/.test(last4))
		throw Object.assign(new Error('The last four digits of the card.'), { code: 'last4' });
	return { name, last4 };
}

/**
 * Add a card, or find the one with the same digits and name.
 *
 * @param {import('../store/repository.js').Collection} accounts
 * @param {{ name?: unknown, last4?: unknown }} input
 */
export async function addCard(accounts, input) {
	const { name, last4 } = cleanCard(input);
	return upsertAccount(accounts, {
		source: CARD_SOURCE,
		sourceAccountId: `${last4}:${name.toLowerCase()}`,
		ibanLast4: last4,
		name,
		currency: 'EUR',
		kind: 'card'
	});
}

/**
 * Import a statement's lines into a card's account; a line already there is
 * not added again. The column mapping and the sign are kept on the account,
 * for the next statement of the same issuer.
 *
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} store
 * @param {Record<string, any>} account the card's
 * @param {import('./import.js').IncomingTransaction[]} lines card-csv.js cardLines
 * @param {{ header: string[], mapping: import('./card-csv.js').Mapping, invert: boolean }} format
 */
export async function importCardLines(store, account, lines, format) {
	if (!isCardAccount(account)) throw new Error('Not a card account.');
	const counts = await importTransactions({
		transactions: store.transactions,
		events: store.events,
		account: {
			id: String(account.id),
			source: CARD_SOURCE,
			fingerprintAccount: `${CARD_SOURCE}:${account.sourceAccountId}`
		},
		incoming: lines
	});
	const fresh = await store.accounts.get(String(account.id));
	await store.accounts.put({
		...(fresh ?? account),
		csvFormat: { header: format.header, mapping: format.mapping, invert: format.invert },
		lastSyncedOn: new Date().toISOString().slice(0, 10)
	});
	if (store.events)
		await recordEvent(store.events, 'bank-sync', {
			source: CARD_SOURCE,
			accounts: 1,
			accountIds: [String(account.id)],
			...counts
		});
	return counts;
}
