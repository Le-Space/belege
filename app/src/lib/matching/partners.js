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
import { chainNamed, chainOfHash } from '../assets/hash-chain.js';

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
 * An exchange's withdrawal names the address it went to (`chainAddress`): the
 * same alias a wallet's booking to that address has, where the chain is clear
 * – from the hash, the network the exchange named, or the asset.
 *
 * @param {Rec} tx
 */
export function txAlias(tx) {
	const chain = walletChain(tx.source);
	if (chain && typeof tx.counterpartyAddress === 'string' && tx.counterpartyAddress.trim()) {
		const family = chain.kind === 'evm' ? 'evm' : chain.id;
		return `addr:${family}:${normalizeAddress(chain, tx.counterpartyAddress)}`;
	}
	return exchangeAddressAlias(tx) ?? counterpartyKey(tx.counterparty);
}

/**
 * The alias of the address an exchange's withdrawal went to, or null: no
 * address, or a chain that is not clear.
 *
 * @param {Rec} tx
 * @returns {string | null}
 */
export function exchangeAddressAlias(tx) {
	if (walletChain(tx.source) || typeof tx.chainAddress !== 'string' || !tx.chainAddress.trim()) {
		return null;
	}
	const asset = String(tx.asset ?? '');
	const method = String(tx.chainMethod ?? '');
	const byHash = tx.chainTxRef ? chainOfHash({ hash: tx.chainTxRef, asset, method }).chains : [];
	const ids = (byHash.length ? byHash : [chainNamed({ method, asset })])
		.filter((c) => c !== null)
		.map((c) => c.id);
	if (!ids.length) return null;
	const known = ids.map((id) => walletChain(id));
	const evm = known.length > 0 && known.every((c) => c?.kind === 'evm');
	// Several candidates are only ever the EVM chains: one address on all of them.
	if (ids.length > 1 && !evm) return null;
	const address = tx.chainAddress.trim();
	const one = known[0];
	return evm
		? `addr:evm:${address.toLowerCase()}`
		: `addr:${ids[0]}:${one ? normalizeAddress(one, address) : address}`;
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
 * A receipt the books made themselves (an Eigenbeleg, a statement of Aleph or
 * Akash credits): its `vendor` is a label of the document, not someone paid.
 *
 * @param {Rec} r
 */
const isSelfReceipt = (r) => r.source === 'eigenbeleg';

/** The labels such receipts carry as `vendor` (receipts/self-receipt.js, aleph/, akash/). */
const SELF_RECEIPT_LABEL = /^(.+ \()?eigenbeleg\)?$/i;

/**
 * Take back what links to self-made receipts taught before they were left
 * out: a partner called "Eigenbeleg" (or "… (Eigenbeleg)") that claimed the
 * counterparties and addresses of the bookings such a receipt was made for,
 * so every booking with them was called "Eigenbeleg" and treated as a vendor's.
 * Its learned aliases, account and tax key go; an address a person said is
 * private or a custodian's stays as said. Changes nothing a second time.
 *
 * @param {import('../store/repository.js').Collection} partners
 * @returns {Promise<number>} how many partner records were repaired
 */
export async function forgetSelfReceiptPartners(partners) {
	let repaired = 0;
	for (const p of await partners.list()) {
		if (p.deleted || !SELF_RECEIPT_LABEL.test(String(p.name ?? '').trim())) continue;
		const kinds = p.addressKinds ?? {};
		const aliases = (p.aliases ?? []).filter((/** @type {string} */ a) => kinds[a]);
		if (aliases.length === (p.aliases ?? []).length && !p.account && !p.taxKey) continue;
		/** @type {Rec} */
		const rest = { ...p, aliases };
		delete rest.account;
		delete rest.taxKey;
		await partners.put(rest);
		repaired++;
	}
	return repaired;
}

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
	// A receipt the books made themselves names no vendor: "Eigenbeleg" is nobody.
	if (isSelfReceipt(receipt)) return null;
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
 * "Adresse benennen" (issue #254): a wallet booking's other address gets a
 * name a person chose – a partner's, or a new one. Stored as the partner's
 * address alias, so every booking with that address is called so (bank/payee.js
 * `addressBook`), now and after the next sync.
 *
 * @param {import('../store/repository.js').Collection} partners
 * @param {Rec} tx a wallet booking with `counterpartyAddress`
 * @param {string} name
 * @param {string} [kind] what the address is (ADDRESS_KINDS); a vendor unless said
 * @returns {Promise<Rec | null>} null when there is no address or no name
 */
export async function nameAddress(partners, tx, name, kind = 'vendor') {
	const alias = txAlias(tx);
	const label = String(name ?? '')
		.trim()
		.slice(0, 80);
	if (!isAddressAlias(alias) || !label || !ADDRESS_KINDS.includes(kind)) return null;
	const all = await partners.list();
	const existing = findPartner(all, label);
	// An address is one thing: decided anew, it leaves whoever had it before.
	for (const p of all) {
		if (p.id !== existing?.id && !p.deleted && (p.aliases ?? []).includes(alias)) {
			await partners.put(withoutAddress(p, alias));
		}
	}
	/** @type {Record<string, string>} */
	const kinds = { ...(existing?.addressKinds ?? {}) };
	if (kind === 'vendor') delete kinds[alias];
	else kinds[alias] = kind;
	return partners.put({
		...(existing ?? {}),
		name: existing?.name ?? label,
		aliases: [...new Set([...(existing?.aliases ?? []), alias])].slice(-20),
		addressKinds: kinds,
		learnedFrom: existing?.learnedFrom ?? 'address'
	});
}

/**
 * What an address is to the books, as a person said (issue: "Was war das?"):
 *   vendor     someone paid or paying – a booking with it needs its receipt
 *   private    the person's own private address – a withdrawal or a deposit,
 *              no receipt
 *   custodian  own money at an exchange or custodian Belege does not read –
 *              an own transfer whose other side is not in the books
 * An own wallet is not here: it is added as a wallet and read.
 */
export const ADDRESS_KINDS = /** @type {readonly string[]} */ (['vendor', 'private', 'custodian']);

/** @param {Rec} p @param {string} alias */
function withoutAddress(p, alias) {
	const kinds = { ...(p.addressKinds ?? {}) };
	delete kinds[alias];
	return {
		...p,
		aliases: (p.aliases ?? []).filter((/** @type {string} */ a) => a !== alias),
		addressKinds: kinds
	};
}

/**
 * Take a booking's address back out of the partners: it is no one's again.
 *
 * @param {import('../store/repository.js').Collection} partners
 * @param {Rec} tx
 */
export async function forgetAddress(partners, tx) {
	const alias = txAlias(tx);
	if (!isAddressAlias(alias)) return;
	for (const p of await partners.list()) {
		if (!p.deleted && (p.aliases ?? []).includes(alias)) {
			await partners.put(withoutAddress(p, alias));
		}
	}
}

/**
 * What a booking's address was said to be, and by which name; null when no
 * one named it.
 *
 * @param {Rec[]} partners
 * @param {Rec} tx
 * @returns {{ kind: 'vendor' | 'private' | 'custodian', name: string, alias: string } | null}
 */
export function addressKindOf(partners, tx) {
	const alias = txAlias(tx);
	if (!isAddressAlias(alias)) return null;
	const p = partners.find((x) => !x.deleted && (x.aliases ?? []).includes(alias));
	if (!p) return null;
	const kind = p.addressKinds?.[alias];
	return {
		kind: kind === 'private' || kind === 'custodian' ? kind : 'vendor',
		name: String(p.name ?? ''),
		alias
	};
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
	if (!vendor || isSelfReceipt(receipt)) return null;
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
