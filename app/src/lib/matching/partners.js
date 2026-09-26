// What the app learns from a person's own links: that a counterparty on the
// bank statement ("Anthropic* Claude Sub", "PAYPAL *HETZNER 1234") is a vendor
// on the receipts ("Anthropic, PBC"), and which mail domains that vendor's
// receipts come from. Only a confirmed or hand-made link teaches, never an
// automatic match: the engine does not learn from itself.
//
// Kept in `partners` (one record per vendor), sealed like every record. Used
// by the scoring (score.js: "vendor-learned") and by the private-mailbox
// search (the vendor's name and mail domains as search terms).

import { sameVendor, vendorWords } from './normalize.js';
import { normalizeAddress, walletChain } from '../wallets/chains.js';

/** @typedef {Record<string, any>} Rec */

/**
 * A counterparty as a key: lower case, no accents, no digits (card and
 * PayPal lines carry changing numbers), words of two letters or more.
 *
 * @param {unknown} s
 */
export function counterpartyKey(s) {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z]+/g, ' ')
		.split(' ')
		.filter((w) => w.length >= 2)
		.join(' ')
		.slice(0, 80);
}

/**
 * What a booking's other side is known by: for an own wallet's booking the
 * other address (`addr:evm:0x…`, `addr:nyx:n1…`; an EVM address is the same
 * on every EVM chain), else the counterparty as a key. An address has no
 * words to learn from, so it is the address itself that is remembered.
 *
 * @param {Rec} tx
 */
export function txAlias(tx) {
	const chain = walletChain(tx.source);
	if (chain && typeof tx.counterpartyAddress === 'string' && tx.counterpartyAddress.trim()) {
		const family = chain.kind === 'evm' ? 'evm' : chain.id;
		return `addr:${family}:${normalizeAddress(chain, tx.counterpartyAddress)}`;
	}
	return counterpartyKey(tx.counterparty);
}

/** Whether an alias is an address (txAlias). @param {string} alias */
export const isAddressAlias = (alias) => alias.startsWith('addr:');

/** An alias as shown: an address shortened, a counterparty key as it is. @param {string} alias */
export function aliasLabel(alias) {
	if (!isAddressAlias(alias)) return alias;
	const address = alias.split(':').slice(2).join(':');
	return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

/** Whether an alias names someone: an address, or a key with a word beyond a legal form. @param {string} alias */
const namesSomeone = (alias) =>
	Boolean(alias) && (isAddressAlias(alias) || vendorWords(alias).length > 0);

/**
 * The domain of a mail address, from "Name <a@b.c>" or "a@b.c".
 *
 * @param {unknown} from
 * @returns {string | null}
 */
export function mailDomain(from) {
	const m = /@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i.exec(String(from ?? '').trim());
	return m ? m[1].toLowerCase() : null;
}

/** @param {Rec} r */
const vendorOf = (r) => String(r.vendor ?? r.extraction?.vendor ?? '').trim();

/**
 * The partner a vendor name belongs to, among the stored ones.
 *
 * @param {Rec[]} partners
 * @param {string} vendor
 */
export function findPartner(partners, vendor) {
	const key = counterpartyKey(vendor);
	return partners.find((p) => !p.deleted && counterpartyKey(p.name) === key) ?? null;
}

/**
 * Learn from a link a person made or confirmed. Nothing is learned for our
 * own invoices, a receipt without a vendor or a booking without a
 * counterparty that names someone (more than a legal form). The sender's
 * domain only counts from a mail whose sender check passed.
 *
 * @param {import('../store/repository.js').Collection} partners
 * @param {Rec} receipt
 * @param {Rec} tx
 * @param {{ companyNames?: string[] }} [ctx]
 * @returns {Promise<Rec | null>} the partner record, or null when nothing was learned
 */
export async function learnFromLink(partners, receipt, tx, { companyNames = [] } = {}) {
	const vendor = vendorOf(receipt);
	const alias = txAlias(tx);
	// "GmbH" alone, or only digits and short words, names nobody.
	if (!vendor || !namesSomeone(alias)) return null;
	if (companyNames.some((name) => sameVendor(vendor, name))) return null;
	const domain =
		receipt.source === 'mail' && receipt.authVerdict === 'pass' ? mailDomain(receipt.from) : null;

	const existing = findPartner(await partners.list(), vendor);
	const aliases = [...new Set([...(existing?.aliases ?? []), alias])].slice(-20);
	const senderDomains = [
		...new Set([...(existing?.senderDomains ?? []), ...(domain ? [domain] : [])])
	].slice(-10);
	if (
		existing &&
		aliases.length === (existing.aliases ?? []).length &&
		senderDomains.length === (existing.senderDomains ?? []).length
	) {
		return existing;
	}
	return partners.put({
		...(existing ?? {}),
		name: existing?.name ?? vendor,
		aliases,
		senderDomains,
		learnedFrom: 'link'
	});
}

/**
 * Learn the account a person confirmed for a booking (booking/actions.js):
 * stored on the vendor's partner record as `account` and `taxKey`, so the
 * next booking of that vendor – by the receipt's vendor or the counterparty
 * on the statement – gets it as a suggestion ("gelernt"). The partner is
 * created or merged like `learnFromLink` does. Nothing is learned without a
 * receipt that names a vendor, or for our own invoices.
 *
 * @param {import('../store/repository.js').Collection} partners
 * @param {Rec} receipt
 * @param {Rec} tx
 * @param {{ account: string, taxKey: string }} booking
 * @param {{ companyNames?: string[] }} [ctx]
 * @returns {Promise<Rec | null>}
 */
export async function learnAccount(partners, receipt, tx, booking, { companyNames = [] } = {}) {
	const vendor = vendorOf(receipt);
	if (!vendor) return null;
	if (companyNames.some((name) => sameVendor(vendor, name))) return null;
	const alias = txAlias(tx);
	const existing = findPartner(await partners.list(), vendor);
	const aliases = [
		...new Set([...(existing?.aliases ?? []), ...(namesSomeone(alias) ? [alias] : [])])
	].slice(-20);
	if (
		existing &&
		existing.account === booking.account &&
		(existing.taxKey ?? '') === booking.taxKey &&
		aliases.length === (existing.aliases ?? []).length
	) {
		return existing;
	}
	return partners.put({
		...(existing ?? {}),
		name: existing?.name ?? vendor,
		aliases,
		senderDomains: existing?.senderDomains ?? [],
		learnedFrom: existing?.learnedFrom ?? 'booking',
		account: booking.account,
		taxKey: booking.taxKey
	});
}

/**
 * Counterparty key → the vendor names people linked it to.
 *
 * @param {Rec[]} partners
 * @returns {Map<string, string[]>}
 */
export function learnedVendors(partners) {
	/** @type {Map<string, string[]>} */
	const map = new Map();
	for (const p of partners) {
		if (p.deleted || !p.name) continue;
		for (const alias of p.aliases ?? []) {
			map.set(alias, [...new Set([...(map.get(alias) ?? []), String(p.name)])]);
		}
	}
	return map;
}

/**
 * The learned partner of a booking's counterparty, for the mailbox search.
 *
 * @param {Rec[]} partners
 * @param {Rec} tx
 * @returns {Rec | null}
 */
export function partnerOfTx(partners, tx) {
	const key = txAlias(tx);
	if (!key) return null;
	return partners.find((p) => !p.deleted && (p.aliases ?? []).includes(key)) ?? null;
}
