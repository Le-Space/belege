// The context classification needs, built from the store's records: our
// company names and rules (settings key `matching`), and our own accounts.
//
// Our accounts' full IBANs are not kept (step 2): a CAMT account is keyed by a
// hash of its IBAN, a Hibiscus account by its last four digits. So a
// counterparty IBAN is hashed and looked up among the CAMT keys, and four
// digits count only together with the counter-booking on that account.

import { ibanKey } from '../bank/fingerprint.js';
import { refundIndex } from './refunds.js';
import { isVendorPayment, isVendorReceipt } from './vendor-account.js';
import { cleanMatchingSettings } from './classify.js';
import { compactIban, dayNumber } from './normalize.js';
import { learnedVendors } from './partners.js';
import { cosmosChainOf, normalizeAddress, walletChain } from '../wallets/chains.js';
import { sameKey } from '../wallets/cross-swap.js';
import { mutualTwin } from './twins.js';
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

/** How long a swap across chains may take to arrive (issue #170). */
export const CROSS_SWAP_MINUTES = 30;

/**
 * @typedef {object} CrossSwapSide one side of a swap across chains
 * @property {'send' | 'arrival'} role
 * @property {string} chain the other side's chain
 * @property {string} receiver the swap's receiver on the target chain
 * @property {boolean} targetMissing the receiver is ours (same key) but not in the books
 * @property {number} candidates arrivals that fit (a send); 1 for an arrival
 * @property {Record<string, any>} [other] the other side, when exactly one fits
 */

/** A booking's moment in ms: its time, else the start of its day. @param {Record<string, any>} t */
function timeOf(t) {
	const at = Date.parse(String(t.bookedAt ?? ''));
	if (Number.isFinite(at)) return at;
	const day = Date.parse(`${t.bookedOn ?? ''}T00:00:00Z`);
	return Number.isFinite(day) ? day : null;
}

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
			// Known by their IBAN key: a statement file's, and Enable Banking's (#224).
			.filter(
				(a) =>
					(a.source === 'camt' || a.source === 'enablebanking') &&
					typeof a.sourceAccountId === 'string'
			)
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

	// Own transfers by IBAN (issue #176): which of our accounts an IBAN names –
	// a CAMT account by its key, a Hibiscus account by its last four – and on
	// it the booking that is the other side: the same amount the other way
	// within days, a pair only when each side picks the other (twins.js).
	/** @type {Map<string, string[]>} IBAN → our accounts it names */
	const accountsOfIban = new Map();
	for (const iban of ownIbans) {
		const key = await ibanKey(iban);
		const ids = accounts
			.filter(
				(a) =>
					!a.deleted &&
					(((a.source === 'camt' || a.source === 'enablebanking') && a.sourceAccountId === key) ||
						(a.source === 'hibiscus' && String(a.ibanLast4 ?? '').toUpperCase() === iban.slice(-4)))
			)
			.map((a) => String(a.id));
		if (ids.length) accountsOfIban.set(iban, ids);
	}
	/** @param {Record<string, any>} t */
	const targetsOf = (t) =>
		(accountsOfIban.get(compactIban(t.counterpartyIban)) ?? []).filter(
			(id) => id !== String(t.accountId)
		);
	const liveTx = transactions.filter((t) => !t.deleted && t.amountCents);
	/** @param {Record<string, any>} a @param {Record<string, any>} b */
	const near = (a, b) => {
		const x = dayNumber(a.bookedOn);
		const y = dayNumber(b.bookedOn);
		return x !== null && y !== null && Math.abs(x - y) <= MIRROR_DAYS;
	};
	/** @param {Record<string, any>} t the booking that names the IBAN */
	const ibanForward = (t) => {
		const targets = targetsOf(t);
		return liveTx.filter(
			(o) =>
				targets.includes(String(o.accountId)) &&
				o.amountCents === -t.amountCents &&
				(o.currency ?? 'EUR') === (t.currency ?? 'EUR') &&
				near(t, o)
		);
	};
	/** @param {Record<string, any>} o a booking on the named account */
	const ibanBackward = (o) =>
		liveTx.filter(
			(t) =>
				targetsOf(t).includes(String(o.accountId)) &&
				t.amountCents === -o.amountCents &&
				(t.currency ?? 'EUR') === (o.currency ?? 'EUR') &&
				near(t, o)
		);
	/** @type {Map<string, Record<string, any>>} */
	const ibanPairs = new Map();
	/** @type {Set<string>} */
	const ibanMissing = new Set();
	for (const t of liveTx) {
		if (!targetsOf(t).length) continue;
		const forward = ibanForward(t);
		if (!forward.length) {
			ibanMissing.add(String(t.id));
			continue;
		}
		const o = mutualTwin(t, forward, ibanBackward);
		if (o) {
			ibanPairs.set(String(t.id), o);
			ibanPairs.set(String(o.id), t);
		}
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

	// Swaps across chains (issue #170): an IBC transfer whose memo sends the
	// swap's result to an own wallet, and the arrival there – the only incoming
	// booking on that wallet within CROSS_SWAP_MINUTES, of at least the least
	// amount the swap had to give.
	const accountById = new Map(accounts.map((a) => [String(a.id), a]));
	/** @type {Map<string, CrossSwapSide>} */
	const crossSides = new Map();
	/** @type {Map<string, string[]>} arrival id → the sends that would take it */
	const claims = new Map();
	for (const t of transactions) {
		const plan = t.crossSwap;
		if (t.deleted || !plan || typeof plan.receiver !== 'string') continue;
		const target = cosmosChainOf(plan.receiver);
		const key = target ? `${target.id}:${normalizeAddress(target, plan.receiver)}` : '';
		const targetAccounts = new Set(ownAddresses.get(key)?.values() ?? []);
		const from = accountById.get(String(t.accountId));
		const ownKey = Boolean(
			from?.walletAddress && sameKey(String(from.walletAddress), plan.receiver)
		);
		if (!targetAccounts.size) {
			// Not in the books; the same key as the sending wallet says it is ours all the same.
			if (ownKey) {
				crossSides.set(String(t.id), {
					role: 'send',
					chain: target?.id ?? '',
					receiver: plan.receiver,
					targetMissing: true,
					candidates: 0
				});
			}
			continue;
		}
		const sentAt = timeOf(t);
		const least = /^\d+$/.test(String(plan.minAmount)) ? BigInt(plan.minAmount) : 0n;
		const arrivals = transactions.filter((o) => {
			if (o.deleted || o.id === t.id || !targetAccounts.has(String(o.accountId))) return false;
			if (Number(o.amountCents ?? 0) <= 0 || o.movement === 'fee' || o.movement === 'reward') {
				return false;
			}
			const q = /^-?\d+$/.test(String(o.quantity ?? '')) ? BigInt(o.quantity) : 0n;
			if (q < least || (least > 0n && q > least * 2n)) return false;
			const at = timeOf(o);
			if (sentAt === null || at === null) return false;
			return at >= sentAt && at - sentAt <= CROSS_SWAP_MINUTES * 60_000;
		});
		crossSides.set(String(t.id), {
			role: 'send',
			chain: target?.id ?? '',
			receiver: plan.receiver,
			targetMissing: false,
			candidates: arrivals.length,
			...(arrivals.length === 1 ? { other: arrivals[0] } : {})
		});
		for (const o of arrivals)
			claims.set(String(o.id), [...(claims.get(String(o.id)) ?? []), String(t.id)]);
	}
	// An arrival two swaps would take belongs to neither.
	for (const [id, side] of [...crossSides]) {
		if (side.role !== 'send' || !side.other) continue;
		if ((claims.get(String(side.other.id)) ?? []).length > 1) {
			crossSides.set(id, { ...side, other: undefined, candidates: 2 });
			continue;
		}
		const send = transactions.find((t) => String(t.id) === id);
		if (send) {
			crossSides.set(String(side.other.id), {
				role: 'arrival',
				chain: String(send.source ?? ''),
				receiver: side.receiver,
				targetMissing: false,
				candidates: 1,
				other: send
			});
		}
	}

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
	// A burn and its replacement token, linked by a person (issue #162).
	/** @type {Map<string, string>} */
	const migratedWith = new Map();
	for (const key of clean.migrations) {
		const [a, b] = key.split('|');
		if (!a || !b || a === b || !liveById.has(a) || !liveById.has(b)) continue;
		migratedWith.set(a, b);
		migratedWith.set(b, a);
	}
	// Swaps a person linked by hand ("Als Tausch verknüpfen", issue #170).
	/** @type {Map<string, string>} */
	const swappedWith = new Map();
	for (const key of clean.ownSwaps) {
		const [a, b] = key.split('|');
		if (!a || !b || a === b || !liveById.has(a) || !liveById.has(b)) continue;
		swappedWith.set(a, b);
		swappedWith.set(b, a);
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
		prepaidVendorOf(tx) {
			return clean.prepaidVendors.find((v) => isVendorPayment(v.name, tx))?.name ?? null;
		},
		prepaidReceipt(r) {
			return clean.prepaidVendors.some((v) => isVendorReceipt(v.name, r));
		},
		ibanCounterpart(tx) {
			return ibanPairs.get(String(tx.id)) ?? null;
		},
		ibanCounterpartMissing(tx) {
			return ibanMissing.has(String(tx.id));
		},
		linkedTransfer(tx) {
			const other = linkedTo.get(String(tx.id));
			return other ? (liveById.get(other) ?? null) : null;
		},
		linkedMigration(tx) {
			const other = migratedWith.get(String(tx.id));
			return other ? (liveById.get(other) ?? null) : null;
		},
		linkedSwap(tx) {
			const other = swappedWith.get(String(tx.id));
			return other ? (liveById.get(other) ?? null) : null;
		},
		crossSwapOf(tx) {
			return crossSides.get(String(tx.id)) ?? null;
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
