// "Kraken synchronisieren": the ledger of one Kraken account, through the
// bridge, into the sealed store (docs/crypto.md).
//
// One Belege account per asset and wallet: Kraken EUR, Kraken BTC, Kraken BTC
// (Earn), … Every ledger entry becomes one booking on its account; a fee
// charged on an entry becomes a second booking (movement `fee`), so the fee
// is booked on its own account (4970) and not hidden in the amount.
//
// How a booking gets its euro amount:
//   - EUR: the amount itself
//   - a trade against EUR (two legs, one of them EUR): the crypto leg is worth
//     exactly what was paid or received in euros; its rate is the trade's
//     price (source `trade`), so buying and selling carry their true cost
//   - a trade between two crypto assets: the leg that goes out is valued at
//     the day's rate, the leg that comes in at the same euro amount
//   - everything else (deposits, withdrawals, staking, earn, transfers
//     between spot and earn): the day's rate, Kraken's own EUR price first,
//     CoinGecko as the fallback (bridge/src/rates.js, prefer=kraken)
// Both legs of a trade and of a spot/earn transfer thus carry the same euro
// amount the other way and the same reference (`txRef` = Kraken's refid):
// matching books them as an own transfer.
//
// A group of entries whose rate cannot be found is left out whole and named
// in the result; the next sync starts before it and tries again.

import { recordEvent } from '../activity/events.js';
import { importTransactions, upsertAccount } from '../bank/import.js';
import { toUnits, valueCents } from '../assets/quantity.js';
import { tradeRate, valuedFields } from '../assets/valuation.js';

/** A sync starts this many days before the last one, for late entries. */
export const OVERLAP_DAYS = 7;

const TRADE_TYPES = new Set(['trade', 'spend', 'receive']);

/** @typedef {import('../bridge/client.js').KrakenLedgerEntry} Entry */
/** @typedef {import('../bank/import.js').IncomingTransaction} Incoming */

/** `BTC`, `BTC.earn`: the account key of an asset in a wallet. @param {string} asset @param {'spot' | 'earn'} wallet */
export const accountKey = (asset, wallet) => (wallet === 'earn' ? `${asset}.earn` : asset);

/** `Kraken BTC`, `Kraken BTC (Earn)` @param {string} asset @param {'spot' | 'earn'} wallet */
export const accountName = (asset, wallet) =>
	`Kraken ${asset}${wallet === 'earn' ? ' (Earn)' : ''}`;

/** Transfers between Kraken's own wallets, by subtype. */
const SPOT_EARN = new Set(['spottostaking', 'stakingfromspot', 'spotfromstaking', 'stakingtospot']);
const SPOT_FUTURES = new Set(['spottofutures', 'spotfromfutures']);
/** Moves inside Kraken Earn that are no reward. */
const EARN_MOVES = new Set(['allocation', 'deallocation', 'autoallocation', 'migration']);

/**
 * What an entry is, for people and for matching. Labelled by type and
 * subtype; a subtype this does not know is shown as Kraken writes it, never
 * guessed – a `transfer` is not spot ↔ earn unless its subtype says so.
 *
 * @param {Entry} e
 * @returns {{ label: string, movement: 'transfer' | 'trade' | 'reward' }}
 */
export function describeEntry(e) {
	switch (e.type) {
		case 'trade':
			return { label: 'Handel', movement: 'trade' };
		case 'spend':
		case 'receive':
			return { label: 'Kauf', movement: 'trade' };
		case 'deposit':
			return { label: 'Einzahlung', movement: 'transfer' };
		case 'withdrawal':
			return { label: 'Auszahlung', movement: 'transfer' };
		case 'staking':
			return { label: 'Staking-Ertrag', movement: 'reward' };
		case 'earn':
			if (e.subtype === 'reward') return { label: 'Earn-Ertrag', movement: 'reward' };
			return {
				label: EARN_MOVES.has(e.subtype) ? 'Umbuchung Spot/Earn' : raw(e),
				movement: 'transfer'
			};
		case 'transfer':
			if (SPOT_EARN.has(e.subtype)) return { label: 'Umbuchung Spot/Earn', movement: 'transfer' };
			if (SPOT_FUTURES.has(e.subtype)) {
				return { label: 'Umbuchung Spot/Futures', movement: 'transfer' };
			}
			return { label: raw(e), movement: 'transfer' };
		default:
			return { label: raw(e), movement: 'transfer' };
	}
}

/** `Kraken: transfer`, `Kraken: transfer/airdrop` – as Kraken writes it. @param {Entry} e */
function raw(e) {
	return `Kraken: ${e.type || 'Buchung'}${e.subtype ? `/${e.subtype}` : ''}`;
}

/** @param {Entry} e @param {string} amount */
const unitsOf = (e, amount) => toUnits(amount, e.decimals);
/** @param {Entry} e @param {string} units */
const euroCents = (e, units) => valueCents(units, e.decimals, '1');

/**
 * A crypto leg worth `cents`, at the trade's own price.
 *
 * @param {Entry} e
 * @param {string} units
 * @param {number} cents
 */
function atTradePrice(e, units, cents) {
	return valuedFields({
		asset: e.asset,
		units,
		decimals: e.decimals,
		rate: { rate: tradeRate(cents, units, e.decimals), source: 'trade', at: e.time }
	});
}

/**
 * The bookings for Kraken's ledger entries, by account key.
 *
 * @param {Entry[]} entries oldest first
 * @param {(asset: string, date: string) => Promise<import('../assets/valuation.js').Rate>} getRate
 * @returns {Promise<{ byAccount: Map<string, Incoming[]>, unpriced: { refid: string, date: string, asset: string, reason: string }[] }>}
 */
export async function krakenTransactions(entries, getRate) {
	/** @type {Map<string, Promise<import('../assets/valuation.js').Rate>>} */
	const rates = new Map();
	const rateOf = (/** @type {string} */ asset, /** @type {string} */ date) => {
		const key = `${asset}@${date}`;
		if (!rates.has(key)) rates.set(key, getRate(asset, date));
		return /** @type {Promise<import('../assets/valuation.js').Rate>} */ (rates.get(key));
	};
	/** @param {Entry} e @param {string} units */
	const atMarket = async (e, units) =>
		valuedFields({
			asset: e.asset,
			units,
			decimals: e.decimals,
			rate: await rateOf(e.asset, e.date)
		});

	/** @type {Map<string, Entry[]>} */
	const groups = new Map();
	for (const e of entries) {
		const key = e.refid || e.id;
		groups.set(key, [...(groups.get(key) ?? []), e]);
	}

	/** @type {Map<string, Incoming[]>} */
	const byAccount = new Map();
	/** @type {{ refid: string, date: string, asset: string, reason: string }[]} */
	const unpriced = [];

	for (const [refid, legs] of groups) {
		/** @type {Map<string, Record<string, any>>} entry id → { amountCents, … crypto fields } */
		const values = new Map();
		try {
			const isTrade = legs.length === 2 && legs.every((l) => TRADE_TYPES.has(l.type));
			const eur = legs.find((l) => l.asset === 'EUR');
			if (isTrade && eur && legs.some((l) => l.asset !== 'EUR')) {
				const other = /** @type {Entry} */ (legs.find((l) => l !== eur));
				const cents = euroCents(eur, unitsOf(eur, eur.amount));
				values.set(eur.id, { amountCents: cents });
				values.set(other.id, atTradePrice(other, unitsOf(other, other.amount), -cents));
			} else if (isTrade && !eur) {
				const out = legs.find((l) => l.amount.trim().startsWith('-')) ?? legs[0];
				const into = /** @type {Entry} */ (legs.find((l) => l !== out));
				const outValue = await atMarket(out, unitsOf(out, out.amount));
				values.set(out.id, outValue);
				values.set(into.id, atTradePrice(into, unitsOf(into, into.amount), -outValue.amountCents));
			} else {
				for (const leg of legs) {
					const units = unitsOf(leg, leg.amount);
					values.set(
						leg.id,
						leg.asset === 'EUR'
							? { amountCents: euroCents(leg, units) }
							: await atMarket(leg, units)
					);
				}
			}

			/** @type {[string, Incoming][]} */
			const out = [];
			for (const leg of legs) {
				const { label, movement } = describeEntry(leg);
				const value = /** @type {Record<string, any>} */ (values.get(leg.id));
				const base = {
					date: leg.date,
					bookedAt: leg.time,
					valueDate: leg.date,
					currency: 'EUR',
					counterpartyName: 'Kraken',
					txRef: refid,
					exchangeType: `${leg.type}${leg.subtype ? `/${leg.subtype}` : ''}`,
					// The on-chain hash of a crypto deposit or withdrawal: pairs it with the wallet.
					...(leg.transferRef && leg.asset !== 'EUR' ? { chainTxRef: leg.transferRef } : {})
				};
				out.push([
					accountKey(leg.asset, leg.wallet),
					{
						...base,
						sourceId: leg.id,
						amountCents: value.amountCents,
						purpose: `${label} · Ref. ${refid}`,
						bookingType: label,
						movement,
						...(value.quantity ? { crypto: cryptoOf(value) } : {})
					}
				]);

				const feeUnits = unitsOf(leg, leg.fee);
				if (BigInt(feeUnits) !== 0n) {
					const negative = (-BigInt(feeUnits)).toString();
					// A crypto fee at the rate its entry was valued with.
					const fee =
						leg.asset === 'EUR'
							? { amountCents: euroCents(leg, negative) }
							: valuedFields({
									asset: leg.asset,
									units: negative,
									decimals: leg.decimals,
									rate: value.valuation ?? (await rateOf(leg.asset, leg.date))
								});
					out.push([
						accountKey(leg.asset, leg.wallet),
						{
							...base,
							sourceId: `${leg.id}:fee`,
							amountCents: fee.amountCents,
							purpose: `Gebühr ${label} · Ref. ${refid}`,
							bookingType: 'Gebühr',
							movement: 'fee',
							...('quantity' in fee ? { crypto: cryptoOf(fee) } : {})
						}
					]);
				}
			}
			for (const [key, tx] of out) byAccount.set(key, [...(byAccount.get(key) ?? []), tx]);
		} catch (/** @type {any} */ error) {
			unpriced.push({
				refid,
				date: legs[0].date,
				asset: legs.map((l) => l.asset).join('/'),
				reason: String(error?.message ?? error)
			});
		}
	}
	return { byAccount, unpriced };
}

/** @param {Record<string, any>} v */
function cryptoOf(v) {
	return { asset: v.asset, quantity: v.quantity, decimals: v.decimals, valuation: v.valuation };
}

/** @param {Date} date @param {number} days */
function isoDaysBefore(date, days) {
	return new Date(date.getTime() - days * 864e5).toISOString().slice(0, 10);
}

/**
 * @param {object} params
 * @param {import('../bridge/client.js').BridgeClient} params.client
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {Date} [params.now]
 * @param {string} [params.from] YYYY-MM-DD: fetch from this day instead of the automatic start
 */
export async function syncKraken({ client, store, now = new Date(), from }) {
	if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from))
		throw new Error(`Kein Datum: ${from}`);
	const today = now.toISOString().slice(0, 10);
	const known = await store.accounts.list({ where: (a) => a.source === 'kraken' });
	const synced = known
		.map((a) => a.lastSyncedOn)
		.filter(Boolean)
		.sort();
	const since = from
		? from
		: synced.length
			? isoDaysBefore(new Date(`${synced[0]}T00:00:00Z`), OVERLAP_DAYS)
			: `${today.slice(0, 4)}-01-01`;

	const [{ balances }, { entries, transferRefs = 'ok' }] = await Promise.all([
		client.krakenBalances(),
		client.krakenLedgers(since)
	]);
	const { byAccount, unpriced } = await krakenTransactions(entries, (asset, date) =>
		client.rate(asset, date, { prefer: 'kraken' })
	);

	/** @type {Map<string, { asset: string, wallet: 'spot' | 'earn', decimals: number, balance: string | null }>} */
	const wanted = new Map();
	for (const b of balances) {
		wanted.set(accountKey(b.asset, b.wallet), { ...b, balance: b.amount });
	}
	for (const e of entries) {
		const key = accountKey(e.asset, e.wallet);
		if (!wanted.has(key))
			wanted.set(key, { asset: e.asset, wallet: e.wallet, decimals: e.decimals, balance: '0' });
	}

	// Entries that could not be valued are fetched again next time.
	const resumeOn = unpriced.map((u) => u.date).sort()[0] ?? today;
	const totals = { new: 0, updated: 0, skipped: 0 };
	/** @type {{ accountId: string, name: string, counts: typeof totals }[]} */
	const perAccount = [];
	for (const [key, info] of [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const record = await upsertAccount(store.accounts, {
			source: 'kraken',
			sourceAccountId: key,
			ibanLast4: '',
			name: accountName(info.asset, info.wallet),
			currency: 'EUR',
			kind: 'exchange',
			asset: info.asset,
			decimals: info.decimals
		});
		const counts = await importTransactions({
			transactions: store.transactions,
			account: { id: record.id, source: 'kraken', fingerprintAccount: `kraken:${key}` },
			incoming: byAccount.get(key) ?? []
		});
		await store.accounts.put({
			...record,
			importEnabled: true,
			lastSyncedOn: resumeOn,
			balance: info.balance,
			balanceOn: today
		});
		totals.new += counts.new;
		totals.updated += counts.updated;
		totals.skipped += counts.skipped;
		perAccount.push({ accountId: record.id, name: record.name, counts });
	}

	await recordEvent(store.events, 'bank-sync', {
		source: 'kraken',
		accounts: perAccount.length,
		accountIds: perAccount.map((a) => a.accountId),
		since,
		unpriced: unpriced.length,
		...totals
	});
	// 'refused': Kraken gave no on-chain hashes, so deposits and withdrawals
	// cannot be paired with a wallet by hash (bridge/src/kraken.js).
	return { since, totals, perAccount, unpriced, transferRefs };
}
