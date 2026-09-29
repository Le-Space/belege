// What a payment is called, and who sent and received it (issues #103, #108).
// Pure; the pages pass in the accounts and partners they already have.
//
// A payment's name, the first that is not empty:
//   1. for a wallet booking, the other side: an own wallet by its name, a
//      partner who is known by the address, a module the reader names
//      (staking, IBC, a fee collector), else the short address;
//   2. the counterparty the bank gives;
//   3. the merchant from the purpose: card payments and some statements put
//      it there only ("Kartenzahlung WOLKENSPEICHER BERLIN");
//   4. the booking type ("Lastschrift");
//   5. "Unbekannte Gegenpartei" – never a bare dash.
//
// A crypto booking also says which way: `Von … → An …`, both sides labelled,
// the own one from the booking's account, the other from its address.

import { displayPurpose } from './format.js';
import { txAlias } from '../matching/partners.js';
import { cosmosChainOf, normalizeAddress, walletChain } from '../wallets/chains.js';

/** @typedef {Record<string, any>} Rec */

/** `0x1234ab…90cdef`: long enough to tell apart, short enough to read. @param {string} address */
export const shortAddress = (address) => {
	const a = String(address ?? '');
	return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
};

/** Whether a text is an address rather than a name. @param {unknown} text */
export const looksLikeAddress = (text) =>
	/^0x[0-9a-fA-F]{40}$/.test(String(text ?? '')) ||
	/^[a-z]{1,20}1[02-9ac-hj-np-z]{38,58}$/.test(String(text ?? '')) ||
	/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(String(text ?? ''));

// Words a card or direct-debit line starts with that are not the merchant.
const NOISE =
	/^(?:kartenzahlung|kartenumsatz|kartenzahlungen|karte|card|visa|mastercard|debitkarte|debit|girocard|maestro|v\s?pay|apple\s?pay|google\s?pay|lastschrift|basislastschrift|sepa|zahlung|umsatz|vom|am|bei|an|payment|purchase|pos|ec|nr\.?|\d[\d.:/\s-]*|eur|usd|[\d.,]+|x+\d+|\*+\d+)$/i;

/**
 * The merchant from a purpose line, or ''. Leading payment words, dates,
 * amounts and masked card numbers go; the first words that are left, up to
 * the next separator, are the merchant.
 *
 * @param {unknown} purpose
 */
export function merchantFromPurpose(purpose) {
	const text = displayPurpose(String(purpose ?? ''))
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '';
	const head = text.split(/\s*(?:\/\/|\||;|,\s)\s*/)[0] ?? '';
	const words = head.split(' ');
	while (words.length && NOISE.test(words[0])) words.shift();
	const name = words
		.filter((w) => !/^\d{2}[.\-/]\d{2}([.\-/]\d{2,4})?$/.test(w))
		.join(' ')
		.trim();
	return /[a-zäöüß]/i.test(name) ? name.slice(0, 60) : '';
}

/**
 * Own wallets and known partners by address, for the labels.
 *
 * @param {{ accounts?: Rec[], partners?: Rec[] }} books
 */
export function addressBook({ accounts = [], partners = [] }) {
	/** @type {Map<string, Rec>} `<chain>:<address>` → the own wallet account */
	const own = new Map();
	for (const a of accounts) {
		const chain = walletChain(a.source);
		if (!chain || a.deleted || typeof a.walletAddress !== 'string' || !a.walletAddress) continue;
		const key = `${chain.id}:${normalizeAddress(chain, a.walletAddress)}`;
		if (!own.has(key)) own.set(key, a);
	}
	/** @type {Map<string, string>} partner alias (`addr:evm:0x…`) → name */
	const known = new Map();
	for (const p of partners) {
		if (p.deleted || !p.name) continue;
		for (const alias of p.aliases ?? [])
			if (String(alias).startsWith('addr:')) known.set(alias, p.name);
	}
	return { own, known };
}

/**
 * @typedef {object} Party
 * @property {string} address the full address, '' when none
 * @property {string} label a name, else the short address
 * @property {boolean} own one of our wallets
 */

/**
 * The other side of a wallet booking: own wallet, partner, module, or an address.
 *
 * @param {Rec} tx
 * @param {ReturnType<typeof addressBook>} book
 * @returns {Party | null} null for a booking that is not a wallet's
 */
function otherParty(tx, book) {
	const chain = walletChain(tx.source);
	if (!chain) return null;
	const address = String(tx.counterpartyAddress ?? '');
	const name = String(tx.counterparty ?? '');
	if (!address) {
		return { address: '', label: name || '', own: false };
	}
	// An IBC receiver lives on another chain: looked up there.
	const onChain = (chain.kind === 'cosmos' && cosmosChainOf(address)) || chain;
	const ownAccount =
		book.own.get(`${onChain.id}:${normalizeAddress(onChain, address)}`) ??
		(chain.kind === 'evm'
			? [...book.own.entries()].find(
					([k]) =>
						k.endsWith(`:${address.toLowerCase()}`) && walletChain(k.split(':')[0])?.kind === 'evm'
				)?.[1]
			: undefined);
	if (ownAccount) {
		return { address, label: String(ownAccount.name ?? shortAddress(address)), own: true };
	}
	const partner = book.known.get(txAlias(tx));
	if (partner) return { address, label: partner, own: false };
	// A module or label the reader gave (staking, IBC, fee collector): not an address.
	if (name && !looksLikeAddress(name)) return { address, label: name, own: false };
	return { address, label: shortAddress(address), own: false };
}

/**
 * What a payment is called in lists and titles.
 *
 * @param {Rec} tx
 * @param {ReturnType<typeof addressBook>} [book]
 * @returns {{ name: string, from: 'wallet' | 'counterparty' | 'purpose' | 'type' | 'unknown' }}
 */
export function payeeName(tx, book = { own: new Map(), known: new Map() }) {
	if (tx.movement === 'fee' && walletChain(tx.source))
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		return { name: 'Netzwerkgebühr', from: 'type' };
	const other = otherParty(tx, book);
	if (other?.label) return { name: other.label, from: 'wallet' };
	const counterparty = String(tx.counterparty ?? '').trim();
	if (counterparty) {
		return {
			name: looksLikeAddress(counterparty) ? shortAddress(counterparty) : counterparty,
			from: 'counterparty'
		};
	}
	const merchant = merchantFromPurpose(tx.purpose);
	if (merchant) return { name: merchant, from: 'purpose' };
	const type = String(tx.bookingType ?? '').trim();
	if (type) return { name: type, from: 'type' };
	return { name: 'Unbekannte Gegenpartei', from: 'unknown' };
}

/**
 * Who sent and who received a crypto booking, in that order; null for a bank booking.
 *
 * @param {Rec} tx
 * @param {Rec | undefined} account the booking's own account
 * @param {ReturnType<typeof addressBook>} book
 * @returns {{ from: Party, to: Party, fee: boolean } | null}
 */
export function walletParties(tx, account, book) {
	if (!walletChain(tx.source)) return null;
	const address = String(account?.walletAddress ?? '');
	/** @type {Party} */
	const mine = {
		address,
		label: String(account?.name ?? (address ? shortAddress(address) : 'eigene Wallet')),
		own: true
	};
	if (tx.movement === 'fee') {
		// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
		return { from: mine, to: { address: '', label: 'Netzwerk (Gebühr)', own: false }, fee: true };
	}
	const other = otherParty(tx, book) ?? { address: '', label: '', own: false };
	if (!other.label) other.label = 'unbekannt';
	const cents = Number(tx.amountCents ?? 0);
	const q = /^-?\d+$/.test(String(tx.quantity ?? '')) ? BigInt(tx.quantity) : 0n;
	const out = cents ? cents < 0 : q < 0n;
	return out ? { from: mine, to: other, fee: false } : { from: other, to: mine, fee: false };
}
