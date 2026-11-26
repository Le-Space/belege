// "Wallet synchronisieren": an own wallet's transfers, through the bridge,
// into the sealed store (docs/crypto.md, "Own wallets").
//
// The list of wallets lives in the sealed settings (key `wallets`): chain,
// address and, optionally, the person's own endpoints. Nothing about a
// wallet is kept in the bridge.
//
// One Belege account per wallet and asset (`Wallet NYM ···w6d0y`), with the
// chain's id as its source. Every entry the bridge hands back becomes one
// booking:
//   sent / received   movement `transfer` (a reward from the staking module
//                     `reward`, a delegation `stake`)
//   the fee           movement `fee`, sourceId `<hash>:fee`: booked apart,
//                     like an exchange's fee (4970)
// valued at the day's rate (CoinGecko first, Kraken as the fallback; no
// `prefer`, this is no exchange booking). `txRef` is the transaction hash as
// the chain gives it (Cosmos: upper-case hex; EVM: 0x + lower-case hex), so
// both legs of a transfer between two own wallets share it, and an exchange
// that names the hash can be paired with it later. The other side's address
// is kept in `counterpartyAddress`, the explorer link in `explorerUrl`.
//
// Entries whose rate cannot be found are left out and named in the result;
// the next sync tries them again (every sync reads the whole history, and
// what is known is skipped).
//
// A reader that learns to read a transaction better may leave out an entry it
// gave before, because it is part of another one now: the NEAR handed to the
// wrap contract, once a payment, is the NEAR of the swap that follows. The
// bridge names such ids (`superseded`), and the booking an earlier sync made
// of one is taken out (`retireSuperseded`): it would count twice otherwise.

import { recordEvent } from '../activity/events.js';
import { isActive } from '../matching/engine.js';
import { importTransactions, upsertAccount } from '../bank/import.js';
import { toUnits } from '../assets/quantity.js';
import { tradeRate, valuedFields } from '../assets/valuation.js';
import { assetOf } from '../assets/registry.js';
import { crossSwapOf } from './cross-swap.js';
import { explorerMonthBalances, historyMonthBalances } from './month-balances.js';
import { getSetting, setSetting } from '../store/settings.js';
import { normalizeAddress, safeExplorerUrl, walletAccountName, walletChain } from './chains.js';
import { isAccountNumber } from '../booking/skr03.js';
import { currentLocale, t } from '../i18n/index.js';

/**
 * @typedef {object} Wallet an entry of the settings key `wallets`
 * @property {string} id
 * @property {string} chain an id of chains.js
 * @property {string} address normalised (chains.js normalizeAddress)
 * @property {Record<string, string>} endpoints the person's own, by name (`rpc`, `rest`, `api`); empty: the defaults
 * @property {string} addedAt ISO 8601
 * @property {string} [addressUrl] the explorer's page of the address, from the last sync
 * @property {string} [lastSyncedAt]
 * @property {number} [tipHeight] Bitcoin and its kin: the chain's height at the last sync, for confirmations (#1037)
 * @property {string} [name] the person's name for it (a project), shown instead of the address tail
 * @property {Record<string, string>} [ledgerAccounts] the ledger account (DATEV Konto) of each of its
 *   asset accounts, by asset (`{ NEAR: '1204', USDC: '1205' }`): every asset its own
 * @property {string} [ledgerAccount] before ledger accounts per asset: one number for the
 *   wallet. Read for one asset that has none yet (assetLedgerPlan); dropped once the
 *   person sets a number per asset, so that an older device, which gives this number to
 *   every asset account, no longer overwrites them
 * @property {string} [costCentre] a cost centre for all its bookings (DATEV KOST1)
 */

/** DATEV KOST1: up to 36 characters; letters and digits keep every import happy. */
export const COST_CENTRE = /^[A-Za-z0-9]{1,36}$/;

/** The longest asset symbol kept as a key of `ledgerAccounts`. */
const ASSET_KEY = 40;

/**
 * A wallet's name, ledger accounts and cost centre as kept: a name of at most
 * 60 characters, an account number per asset ('' to take one away), a cost
 * centre of letters and digits; '' for none. Throws on a ledger account or
 * cost centre that cannot be one.
 *
 * @param {{ name?: unknown, ledgerAccounts?: unknown, costCentre?: unknown }} input
 * @returns {{ name: string, ledgerAccounts: Record<string, string>, costCentre: string }}
 */
export function cleanWalletMeta(input) {
	const name = String(input.name ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);
	const costCentre = String(input.costCentre ?? '').trim();
	/** @type {Record<string, string>} */
	const ledgerAccounts = {};
	const given =
		input.ledgerAccounts && typeof input.ledgerAccounts === 'object' ? input.ledgerAccounts : {};
	for (const [key, value] of Object.entries(given)) {
		const asset = String(key).trim().slice(0, ASSET_KEY);
		if (!asset) continue;
		const number = String(value ?? '').trim();
		if (number && !isAccountNumber(number)) {
			throw new Error(t('messages.wallets.ledgerAccount', { value: number, asset }));
		}
		ledgerAccounts[asset] = number;
	}
	if (costCentre && !COST_CENTRE.test(costCentre)) {
		throw new Error(t('messages.wallets.costCentre', { value: costCentre }));
	}
	return { name, ledgerAccounts, costCentre };
}

/**
 * The ledger account of each asset of a wallet as it stands: what its asset
 * accounts carry, else what the wallet keeps for the asset (`ledgerAccounts`);
 * an old wallet's one number (`ledgerAccount`) for its native asset when no
 * account has numbers yet.
 *
 * @param {Wallet} wallet
 * @param {{ asset?: unknown, ledgerAccount?: unknown, deleted?: boolean }[]} accounts its asset accounts
 * @param {import('./chains.js').WalletChain | null} [chain]
 * @returns {Record<string, string>}
 */
export function walletLedgers(wallet, accounts, chain = walletChain(wallet.chain)) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [asset, number] of Object.entries(wallet.ledgerAccounts ?? {})) {
		if (isAccountNumber(number)) out[asset] = String(number);
	}
	for (const a of accounts) {
		const asset = String(a.asset ?? '');
		if (!a.deleted && asset && isAccountNumber(a.ledgerAccount))
			out[asset] = String(a.ledgerAccount);
	}
	const legacy = String(wallet.ledgerAccount ?? '');
	if (isAccountNumber(legacy) && !Object.values(out).includes(legacy)) {
		const assets = accounts
			.filter((a) => !a.deleted)
			.map((a) => String(a.asset ?? ''))
			.filter(Boolean)
			.sort();
		const holder = [chain?.nativeSymbol ?? '', ...assets].find(
			(x) => x && !out[x] && (!assets.length || assets.includes(x))
		);
		if (holder) out[holder] = legacy;
	}
	return out;
}

/**
 * Which ledger account a sync gives the asset accounts that have none: the
 * one the wallet keeps for the asset (`ledgerAccounts`); an old wallet's one
 * number (`ledgerAccount`) to one asset only – its native asset first, else
 * the first by name – and only while no other asset account of the wallet
 * holds it. An account that has a number keeps it: the person may have set it
 * in the DATEV settings.
 *
 * @param {object} p
 * @param {Wallet} p.wallet
 * @param {import('./chains.js').WalletChain} p.chain
 * @param {string[]} p.assets the assets the sync books
 * @param {{ asset?: unknown, ledgerAccount?: unknown, deleted?: boolean }[]} p.accounts the wallet's asset accounts in the books
 * @returns {Map<string, string>} asset → the number to give its account
 */
export function assetLedgerPlan({ wallet, chain, assets, accounts }) {
	/** @type {Map<string, string>} */
	const out = new Map();
	const live = accounts.filter((a) => !a.deleted);
	const has = (/** @type {string} */ asset) =>
		live.some((a) => a.asset === asset && isAccountNumber(a.ledgerAccount));
	const taken = new Set(
		live.map((a) => String(a.ledgerAccount ?? '')).filter((n) => isAccountNumber(n))
	);
	const open = assets.filter((asset) => !has(asset));
	for (const asset of open) {
		const own = wallet.ledgerAccounts?.[asset];
		if (isAccountNumber(own)) {
			out.set(asset, String(own));
			taken.add(String(own));
		}
	}
	const legacy = String(wallet.ledgerAccount ?? '');
	if (!isAccountNumber(legacy) || taken.has(legacy)) return out;
	const rest = open
		.filter((asset) => !out.has(asset) && !wallet.ledgerAccounts?.[asset])
		.sort((a, b) =>
			a === chain.nativeSymbol ? -1 : b === chain.nativeSymbol ? 1 : a < b ? -1 : 1
		);
	if (rest.length) out.set(rest[0], legacy);
	return out;
}

/**
 * The name of a wallet's account for one asset: the person's name for the
 * wallet with the asset (`Projekt X · NYM`, `Projekt X · USDC (Ethereum)`), or
 * `Wallet NYM ···abc123` without one.
 *
 * @param {import('./chains.js').WalletChain} chain
 * @param {string} asset
 * @param {{ address: string, name?: string }} wallet
 */
export function walletAccountLabel(chain, asset, wallet) {
	if (!wallet.name) return walletAccountName(chain, asset, wallet.address);
	const where = chain.kind === 'evm' ? ` (${chain.shortName})` : '';
	return `${wallet.name} · ${asset}${where}`;
}

/**
 * What a wallet gives its asset accounts: the name and the cost centre, and
 * a ledger account where one is given for this account (assetLedgerPlan) –
 * never the wallet's one number to every asset: each asset its own.
 *
 * @param {import('./chains.js').WalletChain} chain
 * @param {Record<string, any>} account
 * @param {Wallet} wallet
 * @param {string | null} [ledger] the ledger account to give this account; none: it keeps its own
 */
export function walletAccountFields(chain, account, wallet, ledger = null) {
	return {
		name: walletAccountLabel(chain, String(account.asset ?? ''), wallet),
		...(ledger ? { ledgerAccount: ledger } : {}),
		costCentre: wallet.costCentre || null
	};
}

/**
 * @typedef {import('../bridge/client.js').WalletEntry} Entry
 * @typedef {import('../bank/import.js').IncomingTransaction} Incoming
 */

/** Where tokens go to be destroyed: the zero address and the usual "dead" one. */
const BURN_ADDRESSES = new Set([`0x${'0'.repeat(40)}`, `0x${'0'.repeat(36)}dead`]);
/** @param {unknown} address */
export const isBurnAddress = (address) => BURN_ADDRESSES.has(String(address ?? '').toLowerCase());

/** How an entry is named, and what it is for matching. @param {Entry} e */
export function describeWalletEntry(e) {
	// Moved out in someone else's transaction (#162): a project burning holdings, or a spender.
	if (e.byOther && e.type === 'sent') {
		return {
			label: t(isBurnAddress(e.counterparty) ? 'walletBooks.burned' : 'walletBooks.byOther'),
			movement: /** @type {const} */ ('transfer')
		};
	}
	if (e.type === 'fee') {
		return {
			// A NEAR storage deposit (#968) – for a swap, a transfer, a receipt or of its own – is a cost, as gas is;
			// so is the 1 yoctoNEAR a token transfer attaches (#1028).
			label: t(
				e.purpose === 'storage' || (e.partOf && !e.id.endsWith(':fee'))
					? 'walletBooks.storageDeposit'
					: e.purpose === 'security'
						? 'walletBooks.securityDeposit'
						: e.success
							? 'walletBooks.fee'
							: 'walletBooks.feeFailed'
			),
			movement: /** @type {const} */ ('fee')
		};
	}
	if (e.kind === 'reward')
		return { label: t('walletBooks.stakingReward'), movement: /** @type {const} */ ('reward') };
	// Stored in the books, like the labels above (see the follow-up on #192).
	if (e.kind === 'mining')
		return { label: t('walletBooks.miningReward'), movement: /** @type {const} */ ('reward') };
	if (e.kind === 'stake') {
		return {
			label: t(e.type === 'sent' ? 'walletBooks.delegation' : 'walletBooks.undelegation'),
			movement: /** @type {const} */ ('stake')
		};
	}
	if (e.kind === 'swap')
		return { label: t('walletBooks.swap'), movement: /** @type {const} */ ('trade') };
	if (e.kind === 'ibc')
		return { label: t('walletBooks.ibc'), movement: /** @type {const} */ ('transfer') };
	return {
		label: t(e.type === 'sent' ? 'walletBooks.sent' : 'walletBooks.received'),
		movement: /** @type {const} */ ('transfer')
	};
}

/**
 * `1234.5` → `1.234,5` in German, `1,234.5` in English: a decimal from the
 * bridge as the person reads it, every digit kept.
 *
 * @param {string} amount
 */
const deDecimal = (amount) => {
	const [int, frac] = String(amount).split('.');
	const [group, point] = currentLocale() === 'en' ? [',', '.'] : ['.', ','];
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
	return frac ? `${grouped}${point}${frac}` : grouped;
};

/**
 * "Tausch: 30.000 XYZ → 0,143 ETH über MetaMask Swap (Router)": the purpose of
 * a swap's leg. A token not in the chain's list says so – its symbol is its
 * own claim.
 *
 * @param {import('../bridge/client.js').SwapSides} swap
 */
export function swapText(swap) {
	const side = (/** @type {{ asset: string, amount: string, listed: boolean }[]} */ list) =>
		list
			// No amount: the chain gave it in events only (ACT minted by Akash BME, #303).
			.map((x) =>
				x.amount
					? `${deDecimal(x.amount)} ${x.asset}${x.listed ? '' : ` (${t('walletBooks.unlisted')})`}`
					: `${x.asset} (${t('walletBooks.amountUnknown')})`
			)
			.join(' + ');
	const via = swap.via ? ` ${t('walletBooks.via', { via: swap.via })}` : '';
	const gas = swap.fee ? ` · Gas ${deDecimal(swap.fee.amount)} ${swap.fee.asset}` : '';
	const storage = swap.storage
		? ` · ${t('walletBooks.storageDeposit')} ${deDecimal(swap.storage.amount)} ${swap.storage.asset}`
		: '';
	return `${t('walletBooks.swap')}: ${side(swap.gave)} → ${side(swap.got)}${via}${gas}${storage}`;
}

/** A hash, as the wallet's reader names another transaction. @param {unknown} h */
const isTxHash = (h) => typeof h === 'string' && /^\S{1,128}$/.test(h);

/**
 * What a NEAR storage deposit, or its transaction's gas, was for, as the
 * purpose says it after its label: the transfer or receipt it let happen, or
 * where it registered when it was for nothing else. A swap's says the swap
 * (swapText). '' for any other entry.
 *
 * @param {Entry} e
 */
export function storagePurpose(e) {
	if (e.enables && isTxHash(e.enables.hash)) {
		const tx = shortHash(e.enables.hash);
		const to = e.purpose === 'storage' ? e.registration?.account : undefined;
		if (e.enables.kind === 'receipt') return t('walletBooks.storageForReceipt', { tx });
		return to
			? t('walletBooks.storageForTransfer', { to, tx })
			: t('walletBooks.storageForTransferAnyone', { tx });
	}
	if (e.purpose === 'storage' && !e.partOf && e.counterparty)
		return t('walletBooks.storageAlone', { contract: e.counterparty });
	return '';
}

/**
 * What a NEAR storage deposit was for, kept on its booking: `for` the swap
 * (`partOf`), the transfer or receipt it let happen (`enables`), or `own`;
 * `registers` the account its call registered. Undefined for any other entry.
 *
 * @param {Entry} e
 * @returns {{ for: 'swap' | 'transfer' | 'receipt' | 'own', registers?: string } | undefined}
 */
export function storageOf(e) {
	if (e.purpose !== 'storage') return undefined;
	const registers = e.registration?.account;
	return {
		for: isTxHash(e.partOf)
			? 'swap'
			: e.enables?.kind === 'transfer' || e.enables?.kind === 'receipt'
				? e.enables.kind
				: 'own',
		...(typeof registers === 'string' && /^[a-z0-9._-]{2,64}$/.test(registers) ? { registers } : {})
	};
}

/** `AB12…9F3C`: a hash short enough for a purpose. @param {string} hash */
export const shortHash = (hash) =>
	hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;

/** How long after a burn its replacement may arrive (issue #162). */
export const MIGRATION_DAYS = 180;

/**
 * An entry's fields without a rate (issue #162): its quantity as it is, no
 * euro amount yet, and why. Throws for what cannot be kept at all (an amount
 * that does not parse, an asset without a symbol).
 *
 * @param {Entry} e
 * @param {string} units
 * @param {unknown} error why there is no rate
 */
function unpricedFields(e, units, error) {
	if (!/^-?\d+$/.test(units) || BigInt(units) === 0n) throw error;
	const known = assetOf(e.asset);
	const decimals = Number.isInteger(e.decimals) ? e.decimals : known?.decimals;
	if (!Number.isInteger(decimals) || !/^[A-Z0-9]{2,10}$/i.test(e.asset)) throw error;
	return {
		amountCents: 0,
		currency: 'EUR',
		asset: known?.symbol ?? e.asset.toUpperCase(),
		quantity: units,
		decimals: /** @type {number} */ (decimals),
		valuation: /** @type {any} */ (null),
		rateMissing: {
			// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
			reason: String(/** @type {any} */ (error)?.message ?? error ?? 'kein Kurs').slice(0, 200)
		}
	};
}

/**
 * The bookings for a wallet's entries, by asset.
 *
 * @param {Entry[]} entries oldest first
 * @param {(asset: string, date: string, contract?: string, at?: { block: number, decimals: number }) => Promise<import('../assets/valuation.js').Rate>} getRate
 *   `contract`: a token not in the list, priced by its contract (#115); `at`: its
 *   block and decimals, for its DEX pool when CoinGecko has no rate (#163)
 * @returns {Promise<{ byAsset: Map<string, Incoming[]>, unpriced: { id: string, date: string, asset: string, reason: string }[] }>}
 */
export async function walletTransactions(entries, getRate) {
	/** @type {Map<string, Promise<import('../assets/valuation.js').Rate>>} */
	const rates = new Map();
	const rateOf = (
		/** @type {string} */ asset,
		/** @type {string} */ date,
		/** @type {string | undefined} */ contract,
		/** @type {{ block: number, decimals: number } | undefined} */ at
	) => {
		// A token by its contract may be priced by its pool, which moves from block to block.
		const key = `${contract ?? asset}@${date}${contract && at ? `@${at.block}` : ''}`;
		if (!rates.has(key)) rates.set(key, getRate(asset, date, contract, at));
		return /** @type {Promise<import('../assets/valuation.js').Rate>} */ (rates.get(key));
	};

	/** @type {Map<string, Incoming[]>} */
	const byAsset = new Map();
	/** @type {{ id: string, date: string, asset: string, reason: string }[]} */
	const unpriced = [];

	// First every entry at its day's rate; then a swap leg without one from its
	// other side (issue #163): what was given is worth what was got.
	/** @type {Map<Entry, { units: string, value?: ReturnType<typeof valuedFields>, error?: unknown }>} */
	const priced = new Map();
	for (const e of entries) {
		let units;
		try {
			units = toUnits(e.amount, e.decimals);
		} catch (error) {
			priced.set(e, { units: '0', error });
			continue;
		}
		if (BigInt(units) === 0n) continue;
		try {
			priced.set(e, {
				units,
				value: valuedFields({
					asset: e.asset,
					units,
					decimals: e.decimals,
					rate: await rateOf(
						e.asset,
						e.date,
						e.contract,
						e.contract && Number.isSafeInteger(e.height) && e.height > 0
							? { block: e.height, decimals: e.decimals }
							: undefined
					)
				})
			});
		} catch (error) {
			priced.set(e, { units, error });
		}
	}
	for (const [e, p] of priced) {
		if (p.value || e.kind !== 'swap' || e.type === 'fee') continue;
		const rate = swapRate(e, p.units, priced);
		if (rate) {
			try {
				priced.set(e, {
					units: p.units,
					value: valuedFields({ asset: e.asset, units: p.units, decimals: e.decimals, rate })
				});
			} catch {
				// stays unpriced, with the first reason
			}
		}
	}

	// A token handed out by the one who burned the old one (issue #162): worth
	// what the burned holding was worth – its acquisition cost carries over.
	/** @type {Set<Entry>} */
	const burnsUsed = new Set();
	for (const [e, p] of priced) {
		if (p.value || e.type !== 'received' || e.kind === 'swap') continue;
		const from = String(e.counterparty ?? '').toLowerCase();
		const day = Date.parse(`${e.date}T00:00:00Z`);
		const burn = [...priced.entries()]
			.filter(
				([b, q]) =>
					q.value &&
					!burnsUsed.has(b) &&
					b.byOther &&
					b.type === 'sent' &&
					isBurnAddress(b.counterparty) &&
					b.txFrom === from &&
					b.asset !== e.asset &&
					day - Date.parse(`${b.date}T00:00:00Z`) >= 0 &&
					day - Date.parse(`${b.date}T00:00:00Z`) <= MIGRATION_DAYS * 86_400_000
			)
			.at(-1);
		if (!burn) continue;
		const cents = Math.abs(Number(burn[1].value?.amountCents ?? 0));
		if (!cents) continue;
		try {
			priced.set(e, {
				units: p.units,
				value: valuedFields({
					asset: e.asset,
					units: p.units,
					decimals: e.decimals,
					rate: {
						rate: tradeRate(cents, p.units, e.decimals),
						source: 'migration',
						at: e.time || `${e.date}T00:00:00Z`,
						ref: burn[0].hash
					}
				})
			});
			burnsUsed.add(burn[0]);
		} catch {
			// stays unpriced
		}
	}

	for (const [e, p] of priced) {
		try {
			// No rate anywhere (issue #162): kept all the same, its euro amount
			// open ("Kurs fehlt"), the reason with it, for a rate by hand.
			/** @type {ReturnType<typeof unpricedFields> | (ReturnType<typeof valuedFields> & { rateMissing?: undefined })} */
			const value = p.value ?? unpricedFields(e, p.units, p.error);
			const { label, movement } = describeWalletEntry(e);
			const other = e.counterpartyLabel || e.counterparty;
			const storage = storagePurpose(e);
			const purpose = [
				// A swap's gas names the swap it paid for.
				e.swap
					? e.type === 'fee'
						? `${label} für ${swapText(e.swap)}`
						: swapText(e.swap)
					: storage
						? `${label} ${storage}`
						: label,
				e.memo ? `Memo: ${e.memo}` : '',
				// Tokens back from an unbonding: no transaction, the block it ended in (#1029).
				e.hash ? `Tx ${shortHash(e.hash)}` : `Block ${e.height}`
			]
				.filter(Boolean)
				.join(' · ');
			/** @type {Incoming} */
			const tx = {
				sourceId: e.id,
				date: e.date,
				bookedAt: e.time,
				valueDate: e.date,
				amountCents: value.amountCents,
				currency: 'EUR',
				counterpartyName: e.type === 'fee' ? t('walletBooks.fee') : other,
				counterpartyAddress: e.counterparty,
				purpose,
				bookingType: label,
				movement,
				txRef: e.hash,
				explorerUrl: safeExplorerUrl(e.explorerUrl) ?? '',
				...(e.swap ? { swap: e.swap } : {}),
				// A NEAR storage deposit made for a swap: the swap's transaction (#968).
				...(e.type === 'fee' && isTxHash(e.partOf) ? { partOf: e.partOf } : {}),
				// …or the transfer or receipt it let happen (a NEAR storage deposit, and its gas).
				...(e.type === 'fee' && !isTxHash(e.partOf) && e.enables && isTxHash(e.enables.hash)
					? { enables: e.enables.hash }
					: {}),
				...(e.type === 'fee' && storageOf(e) ? { storageDeposit: storageOf(e) } : {}),
				...(e.byOther ? { movedByOther: { by: e.txFrom ?? '' } } : {}),
				// Bitcoin and its kin: the transaction's inputs and outputs (#1037).
				...(e.utxo ? { utxo: e.utxo } : {}),
				...(value.rateMissing ? { rateMissing: value.rateMissing } : {}),
				// A swap to another chain, planned in the IBC memo (issue #170).
				...(() => {
					// The plan is in the IBC message's memo; the transaction's own is usually empty.
					const cross =
						e.kind === 'ibc' && e.type === 'sent'
							? (crossSwapOf(e.ibcMemo) ?? crossSwapOf(e.memo))
							: null;
					return cross ? { crossSwap: cross } : {};
				})(),
				crypto: {
					asset: value.asset,
					quantity: value.quantity,
					decimals: value.decimals,
					valuation: value.valuation
				}
			};
			byAsset.set(e.asset, [...(byAsset.get(e.asset) ?? []), tx]);
			if (value.rateMissing) {
				unpriced.push({ id: e.id, date: e.date, asset: e.asset, reason: value.rateMissing.reason });
			}
		} catch (/** @type {any} */ error) {
			unpriced.push({
				id: e.id,
				date: e.date,
				asset: e.asset,
				reason: String(error?.message ?? error)
			});
		}
	}
	return { byAsset, unpriced };
}

/**
 * A swap leg's rate from the swap's other side (issue #163): the euro value
 * of what came back (or went out) for it, less the other priced legs on its
 * own side, per unit. Only when every other leg of the swap has a price and
 * something is left for this one; the source is the trade itself.
 *
 * @param {Entry} e
 * @param {string} units
 * @param {Map<Entry, { units: string, value?: { amountCents: number } }>} priced
 * @returns {import('../assets/valuation.js').Rate | null}
 */
export function swapRate(e, units, priced) {
	const legs = [...priced.entries()].filter(
		([x]) => x !== e && x.hash === e.hash && x.kind === 'swap' && x.type !== 'fee'
	);
	const partners = legs.filter(([x]) => x.type !== e.type);
	const sameSide = legs.filter(([x]) => x.type === e.type);
	if (!partners.length || [...partners, ...sameSide].some(([, p]) => !p.value)) return null;
	const cents = (/** @type {typeof legs} */ list) =>
		list.reduce((sum, [, p]) => sum + Math.abs(p.value?.amountCents ?? 0), 0);
	const left = cents(partners) - cents(sameSide);
	if (left <= 0) return null;
	return {
		asset: e.asset,
		date: e.date,
		currency: 'EUR',
		rate: tradeRate(left, units, e.decimals),
		usdRate: null,
		source: 'trade',
		at: e.time || `${e.date}T00:00:00Z`
	};
}

/**
 * What kind of movement an id names, after its hash; null for anything else.
 * EVM: the gas, the value, a token transfer or an internal one. Cosmos: the
 * fee, or a movement – read from the node's events
 * (`m<message>:e<event>.<part>:<asset>`) or from the Akash indexer's
 * messages (`c<message>.<part>:<asset>`).
 *
 * @param {string} id
 * @param {string} hash
 */
function idFamily(id, hash) {
	if (!id.startsWith(`${hash}:`)) return null;
	const rest = id.slice(hash.length + 1);
	if (/^[0-9A-F]{64}$/.test(hash)) {
		if (rest === 'fee' || rest.startsWith('fee:')) return 'fee';
		if (/^(?:m[^:]*:e\d+\.\d+|c\d+\.\d+):/.test(rest)) return 'cosmos-move';
		return null;
	}
	if (!/^0x[0-9a-f]{64}$/.test(hash)) return null;
	if (rest === 'fee' || rest === 'value') return rest;
	if (rest.startsWith('internal:')) return 'internal';
	if (rest.startsWith('erc20:') || rest.startsWith('log:')) return 'token';
	return null;
}

/**
 * The same transfer read from another source keeps the id it was booked
 * under. Blockscout and Alchemy give an EVM transfer the same id – except an
 * internal one, which Blockscout numbers by its place among all calls
 * (`<hash>:internal:<index>`) and Alchemy by its trace address
 * (`<hash>:internal:trace:<address>`); a custom endpoint may number token
 * transfers by log index. An Akash transaction read from the node and,
 * once the node's window has moved on, from the indexer gets two ids too. An incoming entry whose id is not stored takes
 * the id of a stored booking of the same transaction, kind, quantity and
 * other address that no incoming entry names – each stored one once – so a
 * change of source books nothing twice (docs/crypto.md, "Own wallets").
 *
 * @param {{ sourceId?: string | null, txRef?: string, quantity?: string, counterpartyAddress?: string }[]} stored
 *   the account's bookings, the deleted ones too
 * @param {Incoming[]} incoming
 * @returns {Incoming[]}
 */
export function reconcileSourceIds(stored, incoming) {
	const known = new Set(stored.map((r) => r.sourceId).filter(Boolean));
	const named = new Set(incoming.map((tx) => tx.sourceId).filter(Boolean));
	const free = stored.filter(
		(r) => r.sourceId && r.txRef && !named.has(r.sourceId) && idFamily(r.sourceId, r.txRef)
	);
	/** @type {Set<unknown>} */
	const taken = new Set();
	return incoming.map((tx) => {
		if (!tx.sourceId || known.has(tx.sourceId) || !tx.txRef) return tx;
		const family = idFamily(tx.sourceId, tx.txRef);
		if (!family) return tx;
		const match = free.find(
			(r) =>
				!taken.has(r) &&
				r.txRef === tx.txRef &&
				idFamily(String(r.sourceId), String(tx.txRef)) === family &&
				r.quantity === tx.crypto?.quantity &&
				// The node names the module an IBC or escrow movement went
				// through, the indexer the message's other side: for Cosmos the
				// transaction, kind and quantity decide.
				(family === 'cosmos-move' ||
					(r.counterpartyAddress ?? '') === (tx.counterpartyAddress ?? ''))
		);
		if (!match) return tx;
		taken.add(match);
		return { ...tx, sourceId: /** @type {string} */ (match.sourceId) };
	});
}

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<Wallet[]>} */
export async function loadWallets(settings) {
	const value = await getSetting(settings, 'wallets');
	return Array.isArray(value) ? value.filter((w) => walletChain(w?.chain) && w?.address) : [];
}

/**
 * Add a wallet to the list; the same chain and address twice is one.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {{ chain: string, address: string, endpoints?: Record<string, string>, name?: string, ledgerAccounts?: Record<string, string>, costCentre?: string }} input
 * @param {Date} [now]
 * @returns {Promise<Wallet>}
 */
export async function addWallet(settings, input, now = new Date()) {
	const chain = walletChain(input.chain);
	if (!chain) throw new Error(`Unbekannte Chain: ${input.chain}`);
	const address = normalizeAddress(chain, input.address);
	/** @type {Record<string, string>} */
	const endpoints = {};
	for (const [name, url] of Object.entries(input.endpoints ?? {})) {
		const trimmed = String(url ?? '').trim();
		if (trimmed) endpoints[name] = trimmed;
	}
	const meta = cleanWalletMeta(input);
	const ledgerAccounts = Object.fromEntries(
		Object.entries(meta.ledgerAccounts).filter(([, number]) => number)
	);
	const wallets = await loadWallets(settings);
	const known = wallets.find((w) => w.chain === chain.id && w.address === address);
	if (known) return known;
	/** @type {Wallet} */
	const wallet = {
		id: `${chain.id}:${address}`,
		chain: chain.id,
		address,
		endpoints,
		addedAt: now.toISOString(),
		...(meta.name ? { name: meta.name } : {}),
		...(Object.keys(ledgerAccounts).length ? { ledgerAccounts } : {}),
		...(meta.costCentre ? { costCentre: meta.costCentre } : {})
	};
	await setSetting(settings, 'wallets', [...wallets, wallet]);
	return wallet;
}

/**
 * Take a wallet off the list. Its accounts and bookings stay in the books.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {string} id
 */
export async function removeWallet(settings, id) {
	const wallets = await loadWallets(settings);
	await setSetting(
		settings,
		'wallets',
		wallets.filter((w) => w.id !== id)
	);
}

/**
 * Change a wallet's name, ledger accounts and cost centre, and carry them to
 * its asset accounts at once. A ledger account is set for the assets named in
 * `ledgerAccounts` only ('' takes it away); the other assets keep theirs.
 *
 * @param {{ settings: import('../store/repository.js').Collection, accounts: import('../store/repository.js').Collection }} store
 * @param {string} id
 * @param {{ name?: unknown, ledgerAccounts?: unknown, costCentre?: unknown }} input
 * @returns {Promise<Wallet>}
 */
export async function updateWalletMeta(store, id, input) {
	const meta = cleanWalletMeta(input);
	const wallets = await loadWallets(store.settings);
	const found = wallets.find((w) => w.id === id);
	const chain = found ? walletChain(found.chain) : null;
	if (!found || !chain) throw new Error(`Unbekannte Wallet: ${id}`);
	const accounts = await store.accounts.list({
		where: (a) => a.source === chain.id && a.walletAddress === found.address
	});
	/** @type {Wallet} */
	const wallet = { ...found };
	for (const key of /** @type {const} */ (['name', 'costCentre'])) {
		if (meta[key]) wallet[key] = meta[key];
		else delete wallet[key];
	}
	setLedgers(wallet, { ...walletLedgers(found, accounts, chain), ...meta.ledgerAccounts });
	await saveWallet(store.settings, wallet);
	for (const account of accounts) {
		const asset = String(account.asset ?? '');
		const named = Object.hasOwn(meta.ledgerAccounts, asset);
		await store.accounts.put({
			...account,
			...walletAccountFields(chain, account, wallet),
			...(named ? { ledgerAccount: meta.ledgerAccounts[asset] || null } : {})
		});
	}
	return wallet;
}

/**
 * Keep a wallet's ledger accounts per asset, and drop its old one number:
 * an older device would give that to every asset account again.
 *
 * @param {Wallet} wallet changed in place
 * @param {Record<string, string>} ledgers asset → number; '' for none
 */
function setLedgers(wallet, ledgers) {
	const kept = Object.fromEntries(
		Object.entries(ledgers).filter(([, number]) => isAccountNumber(number))
	);
	if (Object.keys(kept).length) wallet.ledgerAccounts = kept;
	else delete wallet.ledgerAccounts;
	delete wallet.ledgerAccount;
}

/**
 * A ledger account set on one asset account by hand (Einstellungen →
 * Buchhaltung): the wallet keeps it for that asset, so that its record and
 * the other devices know it. The account itself is written by the caller.
 *
 * @param {{ settings: import('../store/repository.js').Collection, accounts: import('../store/repository.js').Collection }} store
 * @param {Record<string, any>} account the wallet's asset account, as it is now in the books
 * @returns {Promise<Wallet | null>} the wallet, or null for an account that is no own wallet's
 */
export async function noteAssetLedger(store, account) {
	const chain = account.kind === 'wallet' ? walletChain(account.source) : null;
	const asset = String(account.asset ?? '');
	if (!chain || !account.walletAddress || !asset) return null;
	const wallets = await loadWallets(store.settings);
	const found = wallets.find((w) => w.chain === chain.id && w.address === account.walletAddress);
	if (!found) return null;
	const accounts = await store.accounts.list({
		where: (a) => a.source === chain.id && a.walletAddress === found.address
	});
	const number = isAccountNumber(account.ledgerAccount) ? String(account.ledgerAccount) : '';
	/** @type {Wallet} */
	const wallet = { ...found };
	setLedgers(wallet, { ...walletLedgers(found, accounts, chain), [asset]: number });
	await saveWallet(store.settings, wallet);
	return wallet;
}

/** @param {import('../store/repository.js').Collection} settings @param {Wallet} wallet */
async function saveWallet(settings, wallet) {
	const wallets = await loadWallets(settings);
	await setSetting(
		settings,
		'wallets',
		wallets.map((w) => (w.id === wallet.id ? wallet : w))
	);
}

/**
 * @param {object} params
 * @param {import('../bridge/client.js').BridgeClient} params.client
 * @param {{ accounts: import('../store/repository.js').Collection, transactions: import('../store/repository.js').Collection, settings: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {Wallet} params.wallet
 * @param {Date} [params.now]
 */
export async function syncWallet({ client, store, wallet, now = new Date() }) {
	const chain = walletChain(wallet.chain);
	if (!chain) throw new Error(`Unbekannte Chain: ${wallet.chain}`);
	const hashes =
		chain.kind === 'cosmos' ? exchangeWithdrawalHashes(await store.transactions.list(), chain) : [];
	const result = await client.walletHistory(chain.id, {
		address: wallet.address,
		endpoints: wallet.endpoints ?? {},
		...(hashes.length ? { hashes } : {})
	});
	return bookWalletHistory({ client, store, wallet, result, now });
}

/**
 * The on-chain hashes of exchange withdrawals in a chain's native asset that
 * no wallet booking of that chain has yet (#303): the bridge asks the chain's
 * indexer for them by hash, where the address's own listing leaves one out –
 * the first funding of a wallet from Kraken, say. Which wallet received it,
 * the indexer's answer says; a hash that is not this wallet's books nothing.
 *
 * @param {Record<string, any>[]} transactions
 * @param {import('./chains.js').WalletChain} chain
 * @returns {string[]}
 */
export function exchangeWithdrawalHashes(transactions, chain) {
	const booked = new Set(
		transactions
			.filter((t) => !t.deleted && t.source === chain.id && t.txRef)
			.map((t) => String(t.txRef).toUpperCase())
	);
	return [
		...new Set(
			transactions
				.filter(
					(t) =>
						!t.deleted &&
						t.source === 'kraken' &&
						t.asset === chain.nativeSymbol &&
						Number(t.amountCents ?? 0) < 0 &&
						/^[0-9a-f]{64}$/i.test(String(t.chainTxRef ?? ''))
				)
				.map((t) => String(t.chainTxRef).toUpperCase())
				.filter((h) => !booked.has(h))
		)
	].slice(0, 100);
}

/**
 * Take out the bookings of entries the source no longer gives because they
 * are part of another entry now. Only this wallet's own bookings, only the
 * ids the bridge names, and only what is not taken out already; a link to a
 * receipt is undone, a question about the booking goes with it. The Verlauf
 * keeps what was taken out.
 *
 * @param {object} params
 * @param {any} params.store
 * @param {import('./chains.js').WalletChain} params.chain
 * @param {Wallet} params.wallet
 * @param {unknown} params.ids the bridge's `superseded`
 * @returns {Promise<number>} how many bookings were taken out
 */
export async function retireSuperseded({ store, chain, wallet, ids }) {
	const named = new Set(
		(Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id).slice(0, 5000)
	);
	if (!named.size) return 0;
	const own = new Set(
		(
			await store.accounts.list({
				where: (/** @type {Record<string, any>} */ a) =>
					a.source === chain.id && String(a.sourceAccountId ?? '').startsWith(`${wallet.address}:`)
			})
		).map((/** @type {Record<string, any>} */ a) => String(a.id))
	);
	const bookings = await store.transactions.list({
		where: (/** @type {Record<string, any>} */ r) =>
			r.source === chain.id && own.has(String(r.accountId)) && named.has(String(r.sourceId ?? ''))
	});
	if (!bookings.length) return 0;
	/** @type {Set<string>} */
	const taken = new Set();
	for (const b of bookings) {
		taken.add(String(b.id));
		await store.transactions.softDelete(b.id);
	}
	const points = (/** @type {Record<string, any>} */ r) => taken.has(String(r.transactionId ?? ''));
	let matches = 0;
	for (const m of (await store.matches?.list({ where: points })) ?? []) {
		if (isActive(m)) {
			await store.matches.put({ ...m, state: 'rejected' });
			matches++;
		}
		await store.matches.softDelete(m.id);
	}
	for (const q of (await store.questions?.list({ where: points })) ?? []) {
		await store.questions.softDelete(q.id);
	}
	await recordEvent(store.events, 'wallet-superseded', {
		source: chain.id,
		accountIds: [
			...new Set(bookings.map((/** @type {Record<string, any>} */ b) => String(b.accountId)))
		],
		transactionIds: [...taken],
		bookings: taken.size,
		withReceipt: bookings.filter((/** @type {Record<string, any>} */ b) => Boolean(b.receiptId))
			.length,
		matches
	});
	return taken.size;
}

/**
 * A wallet's history into the books, wherever it came from: the bridge
 * (`syncWallet`) or the wallet's own export (Monero, monero-import.js). Every
 * entry valued at its day's rate, one account per asset, the known ones
 * skipped.
 *
 * @param {object} params
 * @param {{ rate: (asset: string, date: string, options?: any) => Promise<any> }} params.client the bridge, for the rates
 * @param {any} params.store
 * @param {Wallet} params.wallet
 * @param {Pick<import('../bridge/client.js').WalletHistory, 'entries' | 'balances'> & Partial<Omit<import('../bridge/client.js').WalletHistory, 'source'>> & { addressUrl?: string, source?: string }} params.result
 * @param {Date} [params.now]
 */
export async function bookWalletHistory({ client, store, wallet, result, now = new Date() }) {
	const chain = walletChain(wallet.chain);
	if (!chain) throw new Error(`Unbekannte Chain: ${wallet.chain}`);
	const today = now.toISOString().slice(0, 10);
	const { byAsset, unpriced } = await walletTransactions(
		result.entries,
		(asset, date, contract, at) =>
			client.rate(asset, date, contract ? { contract, chain: chain.id, ...(at ?? {}) } : {})
	);

	// An account for every asset that moved or is held; a listed token never
	// touched (a balance of 0) gets none.
	/** @type {Map<string, { decimals: number, balance: string | null, contract?: string }>} */
	const wanted = new Map();
	for (const e of result.entries) {
		// A token not in the list (#115): no balance claimed unless the reader read one (#93).
		if (!wanted.has(e.asset)) {
			wanted.set(e.asset, {
				decimals: e.decimals,
				balance: e.contract ? null : '0',
				...(e.contract ? { contract: e.contract } : {})
			});
		}
	}
	for (const b of result.balances) {
		if (wanted.has(b.asset) || !/^0(\.0*)?$/.test(b.amount)) {
			// An unlisted token keeps the contract it is priced by.
			const contract = wanted.get(b.asset)?.contract ?? /** @type {any} */ (b).contract;
			wanted.set(b.asset, {
				decimals: b.decimals,
				balance: b.amount,
				...(contract ? { contract } : {})
			});
		}
	}

	// The whole history was read (not a pruned node's part of it): its
	// bookings, summed from nothing, must give the balance (#287).
	const fullHistory = !(result.history?.pruned && result.history?.completedBy !== 'indexer');
	const thisMonth = today.slice(0, 7);

	// Which ledger account each asset account gets that has none.
	const ledgerPlan = assetLedgerPlan({
		wallet,
		chain,
		assets: [...wanted.keys()],
		accounts: await store.accounts.list({
			where: (/** @type {Record<string, any>} */ a) =>
				a.source === chain.id && String(a.sourceAccountId ?? '').startsWith(`${wallet.address}:`)
		})
	});

	const totals = { new: 0, updated: 0, skipped: 0 };
	/** @type {{ accountId: string, name: string, asset: string, counts: typeof totals }[]} */
	const perAccount = [];
	for (const [asset, info] of [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const key = `${wallet.address}:${asset}`;
		const record = await upsertAccount(store.accounts, {
			source: chain.id,
			sourceAccountId: key,
			ibanLast4: '',
			name: walletAccountLabel(chain, asset, wallet),
			currency: 'EUR',
			kind: 'wallet',
			asset,
			decimals: info.decimals
		});
		const stored = await store.transactions.list({
			includeDeleted: true,
			where: (/** @type {Record<string, any>} */ r) =>
				r.accountId === record.id && r.source === chain.id
		});
		const counts = await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: { id: record.id, source: chain.id, fingerprintAccount: `${chain.id}:${key}` },
			incoming: reconcileSourceIds(/** @type {any[]} */ (stored), byAsset.get(asset) ?? [])
		});
		await store.accounts.put({
			...record,
			...walletAccountFields(
				chain,
				{ ...record, asset },
				wallet,
				isAccountNumber(record.ledgerAccount) ? null : (ledgerPlan.get(asset) ?? null)
			),
			importEnabled: true,
			walletAddress: wallet.address,
			addressUrl: safeExplorerUrl(result.addressUrl) ?? '',
			lastSyncedOn: today,
			balance: info.balance,
			balanceOn: info.balance === null ? null : today,
			fullHistory,
			// The month's opening and closing as the source has them (#287, step
			// 3; month-balances.js): the explorer's running balance first, else
			// the source's own history where it adds up to today's balance.
			// Worked out again on every sync; none where neither is known.
			monthBalances:
				explorerMonthBalances(result.balanceHistory, asset, thisMonth) ??
				(fullHistory
					? historyMonthBalances(result.entries, asset, info.decimals, info.balance, thisMonth)
					: null),
			...(info.contract ? { tokenContract: info.contract } : {})
		});
		totals.new += counts.new;
		totals.updated += counts.updated;
		totals.skipped += counts.skipped;
		perAccount.push({ accountId: record.id, name: record.name, asset, counts });
	}

	// After the import, so that what replaces them is in the books first.
	const superseded = await retireSuperseded({ store, chain, wallet, ids: result.superseded });

	await saveWallet(store.settings, {
		...wallet,
		addressUrl: safeExplorerUrl(result.addressUrl) ?? '',
		// The chain's tip at this sync: a booking's confirmations (#1037).
		...(Number.isInteger(result.tipHeight) ? { tipHeight: result.tipHeight } : {}),
		lastSyncedAt: now.toISOString()
	});
	await recordEvent(store.events, 'bank-sync', {
		source: chain.id,
		accounts: perAccount.length,
		accountIds: perAccount.map((a) => a.accountId),
		unpriced: unpriced.length,
		...totals
	});
	return {
		source: result.source ?? null,
		totals,
		perAccount,
		unpriced,
		unknownAssets: result.unknownAssets ?? 0,
		superseded,
		history: result.history ?? { earliestHeight: 0, earliestTime: null, pruned: false },
		endpoints: result.endpoints ?? {}
	};
}
