// The context classification needs, built from the store's records: our
// company names and rules (settings key `matching`), and our own accounts.
//
// Our accounts' full IBANs are not kept (step 2): a CAMT account is keyed by a
// hash of its IBAN, a Hibiscus account by its last four digits. So a
// counterparty IBAN is hashed and looked up among the CAMT keys, and four
// digits count only together with the counter-booking on that account.

import { ibanKey } from '../bank/fingerprint.js';
import { refundIndex } from './refunds.js';
import { cleanMatchingSettings } from './classify.js';
import { compactIban, dayNumber } from './normalize.js';
import { learnedVendors } from './partners.js';
import { normalizeAddress, walletChain } from '../wallets/chains.js';
import { LOOKALIKE_CHARS, addressBody, isDust, looksAlike } from './dust.js';

/** A transfer between our accounts lands within this many days on the other side. */
export const MIRROR_DAYS = 4;
/** A bridge delivers within this many days of the sending (an L2 → L1 withdrawal takes 7). */
export const BRIDGE_DAYS = 8;
/** What a bridge may keep as its fee: the received quantity is at least 97 % of the sent. */
export const BRIDGE_KEEPS_PERCENT = 3;

/**
 * A reference as compared: case does not matter, a leading `0x` neither
 * (`0xAB…` from one explorer is `ab…` from another).
 *
 * @param {unknown} ref
 */
export const normalizeTxRef = (ref) =>
	String(ref ?? '')
		.trim()
		.toLowerCase()
		.replace(/^0x/, '');

/**
 * What a booking can be paired by: its reference (an exchange's refid, a
 * wallet's transaction hash) and, for an exchange's deposit or withdrawal,
 * the on-chain hash. Too short to be unique is no reference.
 *
 * @param {Record<string, any>} tx
 */
export function txRefsOf(tx) {
	return [tx.txRef, tx.chainTxRef].map(normalizeTxRef).filter((r) => r.length >= 4);
}

/**
 * Where addresses are compared: every EVM chain shares its addresses, a
 * bech32 chain has its own prefix.
 *
 * @param {import('../wallets/chains.js').WalletChain} chain
 */
const addressFamily = (chain) => (chain.kind === 'evm' ? 'evm' : chain.id);

/**
 * @param {object} params
 * @param {Record<string, any>[]} params.accounts
 * @param {Record<string, any>[]} params.transactions
 * @param {any} params.settings the stored `matching` value, or null
 * @param {Record<string, any>[]} [params.partners] what people's links taught (partners.js)
 * @returns {Promise<import('./classify.js').ClassifyContext & { learnedVendors: Map<string, string[]> }>}
 */
export async function buildMatchingContext({ accounts, transactions, settings, partners = [] }) {
	const clean = cleanMatchingSettings(settings);
	const ownIbans = new Set(clean.ownIbans);

	const camtKeys = new Set(
		accounts
			.filter((a) => a.source === 'camt' && typeof a.sourceAccountId === 'string')
			.map((a) => a.sourceAccountId)
	);
	if (camtKeys.size) {
		const seen = new Set();
		for (const tx of transactions) {
			const iban = compactIban(tx.counterpartyIban);
			if (!iban || seen.has(iban)) continue;
			seen.add(iban);
			if (camtKeys.has(await ibanKey(iban))) ownIbans.add(iban);
		}
	}

	// Our own wallets' addresses (wallets/wallet-sync.js keeps them on the accounts).
	/**
	 * `<chain>:<address>` → its accounts by asset (one account per wallet and
	 * asset, wallet-sync.js); '' holds the first one, for an asset the wallet
	 * has no account of yet.
	 *
	 * @type {Map<string, Map<string, string>>}
	 */
	const ownAddresses = new Map();
	for (const a of accounts) {
		const chain = walletChain(a.source);
		if (!chain || a.deleted || typeof a.walletAddress !== 'string' || !a.walletAddress) continue;
		const key = `${chain.id}:${normalizeAddress(chain, a.walletAddress)}`;
		const byAsset = ownAddresses.get(key) ?? new Map();
		if (!byAsset.has('')) byAsset.set('', a.id);
		if (a.asset && !byAsset.has(String(a.asset))) byAsset.set(String(a.asset), a.id);
		ownAddresses.set(key, byAsset);
	}

	// Addresses the person really deals with, by their ends, to spot a lookalike:
	// own wallets, and the other side of every wallet booking that is not dust.
	/** @type {Map<string, Set<string>>} `<family>:<first>…<last>` → addresses */
	const knownByEnds = new Map();
	const n = LOOKALIKE_CHARS;
	/** @param {import('../wallets/chains.js').WalletChain} chain @param {string} address */
	const know = (chain, address) => {
		const a = normalizeAddress(chain, address);
		const body = addressBody(a);
		if (body.length <= 2 * n) return;
		const key = `${addressFamily(chain)}:${body.slice(0, n)}…${body.slice(-n)}`;
		knownByEnds.set(key, (knownByEnds.get(key) ?? new Set()).add(a));
	};
	for (const a of accounts) {
		const chain = walletChain(a.source);
		if (chain && !a.deleted && typeof a.walletAddress === 'string' && a.walletAddress) {
			know(chain, a.walletAddress);
		}
	}
	for (const tx of transactions) {
		const chain = walletChain(tx.source);
		if (chain && !tx.deleted && tx.counterpartyAddress && !isDust(tx)) {
			know(chain, String(tx.counterpartyAddress));
		}
	}

	/** @type {Map<string, string[]>} */
	const ownLast4 = new Map();
	for (const a of accounts) {
		if (a.source !== 'hibiscus' || !/^[A-Z0-9]{4}$/i.test(String(a.ibanLast4 ?? ''))) continue;
		const key = String(a.ibanLast4).toUpperCase();
		ownLast4.set(key, [...(ownLast4.get(key) ?? []), a.id]);
	}

	/** @type {Map<string, Record<string, any>[]>} */
	const byAccount = new Map();
	for (const tx of transactions) {
		const list = byAccount.get(tx.accountId) ?? [];
		list.push(tx);
		byAccount.set(tx.accountId, list);
	}

	// Bookings by amount and currency, to find a transfer's other side.
	/** @type {Map<string, Record<string, any>[]>} */
	const byAmount = new Map();
	for (const tx of transactions) {
		if (tx.deleted) continue;
		const key = `${tx.amountCents}|${tx.currency ?? 'EUR'}`;
		byAmount.set(key, [...(byAmount.get(key) ?? []), tx]);
	}

	// Bookings by reference, to find the other side of a trade or a transfer.
	/** @type {Map<string, Record<string, any>[]>} */
	const byRef = new Map();
	for (const tx of transactions) {
		if (tx.deleted) continue;
		for (const ref of txRefsOf(tx)) byRef.set(ref, [...(byRef.get(ref) ?? []), tx]);
	}

	// Bridges (issue #98): coins sent from one own wallet arrive on another
	// chain as an internal transfer from the bridge contract – another hash,
	// another sender, a euro value that differs. Paired by what is the same:
	// the asset, the quantity less the bridge's fee, and a few days.
	const walletMoves = transactions.filter(
		(t) =>
			!t.deleted &&
			walletChain(t.source) &&
			t.movement === 'transfer' &&
			t.asset &&
			typeof t.quantity === 'string' &&
			/^-?\d+$/.test(t.quantity) &&
			t.quantity !== '0' &&
			t.quantity !== '-0'
	);
	const walletMoveIds = new Set(walletMoves.map((t) => String(t.id)));
	/** @param {Record<string, any>} t */
	const isInternal = (t) => String(t.sourceId ?? '').includes(':internal:');
	/** @param {Record<string, any>} t @returns {Record<string, any>[]} */
	const bridgeSides = (t) => {
		if (!walletMoveIds.has(String(t.id))) return [];
		const q = BigInt(t.quantity);
		const incoming = q > 0n;
		if (incoming && !isInternal(t)) return [];
		const day = dayNumber(t.bookedOn);
		if (day === null) return [];
		return walletMoves.filter((o) => {
			if (o.source === t.source || o.asset !== t.asset || o.accountId === t.accountId) return false;
			const oq = BigInt(o.quantity);
			if (incoming ? oq >= 0n : oq <= 0n || !isInternal(o)) return false;
			const sent = incoming ? -oq : -q;
			const received = incoming ? q : oq;
			const d = dayNumber(o.bookedOn);
			if (d === null) return false;
			const late = incoming ? day - d : d - day;
			return (
				late >= 0 &&
				late <= BRIDGE_DAYS &&
				received <= sent &&
				received * 100n >= sent * BigInt(100 - BRIDGE_KEEPS_PERCENT)
			);
		});
	};

	// Pairs a person linked by hand: each booking to its other side, while both live.
	const liveById = new Map(transactions.filter((t) => !t.deleted).map((t) => [String(t.id), t]));
	/** @type {Map<string, string>} */
	const linkedTo = new Map();
	for (const key of clean.ownTransfers) {
		const [a, b] = key.split('|');
		if (!a || !b || a === b || !liveById.has(a) || !liveById.has(b)) continue;
		linkedTo.set(a, b);
		linkedTo.set(b, a);
	}

	return {
		/**
		 * The other side of a bridge transfer on another own wallet: each side
		 * has only the other, or none is taken.
		 *
		 * @param {Record<string, any>} tx
		 */
		bridgeCounterparts(tx) {
			return bridgeSides(tx).filter((o) => {
				const back = bridgeSides(o);
				return back.length === 1 && back[0].id === tx.id;
			});
		},
		companyNames: clean.companyNames,
		sameReference(tx) {
			if (tx.movement === 'fee' || !tx.amountCents) return [];
			/** @type {Map<string, Record<string, any>>} */
			const found = new Map();
			for (const ref of txRefsOf(tx)) {
				for (const o of byRef.get(ref) ?? []) {
					if (
						o.id !== tx.id &&
						o.accountId !== tx.accountId &&
						o.movement !== 'fee' &&
						Math.sign(Number(o.amountCents)) === -Math.sign(Number(tx.amountCents))
					) {
						found.set(o.id, o);
					}
				}
			}
			return [...found.values()];
		},
		notTransfers: new Set(clean.notTransfers),
		refundOf: refundIndex(transactions, clean).refundOf,
		linkedTransfer(tx) {
			const other = linkedTo.get(String(tx.id));
			return other ? (liveById.get(other) ?? null) : null;
		},
		counterBookings(tx) {
			const day = dayNumber(tx.bookedOn);
			if (day === null || !tx.amountCents) return [];
			return (byAmount.get(`${-tx.amountCents}|${tx.currency ?? 'EUR'}`) ?? []).filter((o) => {
				const d = dayNumber(o.bookedOn);
				return (
					o.id !== tx.id &&
					o.accountId !== tx.accountId &&
					d !== null &&
					Math.abs(d - day) <= MIRROR_DAYS
				);
			});
		},
		ownIbans,
		ownLast4,
		ownAddresses,
		lookalikeOf(tx) {
			const chain = walletChain(tx.source);
			if (!chain || !tx.counterpartyAddress) return null;
			const a = normalizeAddress(chain, String(tx.counterpartyAddress));
			const body = addressBody(a);
			const key = `${addressFamily(chain)}:${body.slice(0, n)}…${body.slice(-n)}`;
			for (const known of knownByEnds.get(key) ?? []) if (looksAlike(a, known)) return known;
			return null;
		},
		rules: clean.rules,
		graceDays: clean.graceDays,
		feeKeys: new Set(clean.feeKeys),
		learnedVendors: learnedVendors(partners),
		mirrored(tx, accountIds) {
			const day = dayNumber(tx.bookedOn);
			if (day === null) return false;
			return accountIds.some(
				(id) =>
					id !== tx.accountId &&
					(byAccount.get(id) ?? []).some((other) => {
						const d = dayNumber(other.bookedOn);
						return (
							other.amountCents === -tx.amountCents &&
							d !== null &&
							Math.abs(d - day) <= MIRROR_DAYS
						);
					})
			);
		}
	};
}
