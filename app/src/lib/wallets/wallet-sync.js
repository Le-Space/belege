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

import { recordEvent } from '../activity/events.js';
import { importTransactions, upsertAccount } from '../bank/import.js';
import { toUnits } from '../assets/quantity.js';
import { valuedFields } from '../assets/valuation.js';
import { getSetting, setSetting } from '../store/settings.js';
import { normalizeAddress, safeExplorerUrl, walletAccountName, walletChain } from './chains.js';

/**
 * @typedef {object} Wallet an entry of the settings key `wallets`
 * @property {string} id
 * @property {string} chain an id of chains.js
 * @property {string} address normalised (chains.js normalizeAddress)
 * @property {Record<string, string>} endpoints the person's own, by name (`rpc`, `rest`, `api`); empty: the defaults
 * @property {string} addedAt ISO 8601
 * @property {string} [addressUrl] the explorer's page of the address, from the last sync
 * @property {string} [lastSyncedAt]
 */

/**
 * @typedef {import('../bridge/client.js').WalletEntry} Entry
 * @typedef {import('../bank/import.js').IncomingTransaction} Incoming
 */

/** How an entry is named, and what it is for matching. @param {Entry} e */
export function describeWalletEntry(e) {
	if (e.type === 'fee') {
		return {
			label: e.success ? 'Netzwerkgebühr' : 'Netzwerkgebühr (fehlgeschlagene Transaktion)',
			movement: /** @type {const} */ ('fee')
		};
	}
	if (e.kind === 'reward')
		return { label: 'Staking-Ertrag', movement: /** @type {const} */ ('reward') };
	if (e.kind === 'stake') {
		return {
			label: e.type === 'sent' ? 'Delegation (Staking)' : 'Rückfluss aus Staking',
			movement: /** @type {const} */ ('stake')
		};
	}
	if (e.kind === 'ibc')
		return { label: 'IBC-Transfer', movement: /** @type {const} */ ('transfer') };
	return {
		label: e.type === 'sent' ? 'Gesendet' : 'Empfangen',
		movement: /** @type {const} */ ('transfer')
	};
}

/** `AB12…9F3C`: a hash short enough for a purpose. @param {string} hash */
export const shortHash = (hash) =>
	hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;

/**
 * The bookings for a wallet's entries, by asset.
 *
 * @param {Entry[]} entries oldest first
 * @param {(asset: string, date: string) => Promise<import('../assets/valuation.js').Rate>} getRate
 * @returns {Promise<{ byAsset: Map<string, Incoming[]>, unpriced: { id: string, date: string, asset: string, reason: string }[] }>}
 */
export async function walletTransactions(entries, getRate) {
	/** @type {Map<string, Promise<import('../assets/valuation.js').Rate>>} */
	const rates = new Map();
	const rateOf = (/** @type {string} */ asset, /** @type {string} */ date) => {
		const key = `${asset}@${date}`;
		if (!rates.has(key)) rates.set(key, getRate(asset, date));
		return /** @type {Promise<import('../assets/valuation.js').Rate>} */ (rates.get(key));
	};

	/** @type {Map<string, Incoming[]>} */
	const byAsset = new Map();
	/** @type {{ id: string, date: string, asset: string, reason: string }[]} */
	const unpriced = [];
	for (const e of entries) {
		try {
			const units = toUnits(e.amount, e.decimals);
			if (BigInt(units) === 0n) continue;
			const value = valuedFields({
				asset: e.asset,
				units,
				decimals: e.decimals,
				rate: await rateOf(e.asset, e.date)
			});
			const { label, movement } = describeWalletEntry(e);
			const other = e.counterpartyLabel || e.counterparty;
			const purpose = [label, e.memo ? `Memo: ${e.memo}` : '', `Tx ${shortHash(e.hash)}`]
				.filter(Boolean)
				.join(' · ');
			/** @type {Incoming} */
			const tx = {
				sourceId: e.id,
				date: e.date,
				valueDate: e.date,
				amountCents: value.amountCents,
				currency: 'EUR',
				counterpartyName: e.type === 'fee' ? 'Netzwerkgebühr' : other,
				counterpartyAddress: e.counterparty,
				purpose,
				bookingType: label,
				movement,
				txRef: e.hash,
				explorerUrl: safeExplorerUrl(e.explorerUrl) ?? '',
				crypto: {
					asset: value.asset,
					quantity: value.quantity,
					decimals: value.decimals,
					valuation: value.valuation
				}
			};
			byAsset.set(e.asset, [...(byAsset.get(e.asset) ?? []), tx]);
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

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<Wallet[]>} */
export async function loadWallets(settings) {
	const value = await getSetting(settings, 'wallets');
	return Array.isArray(value) ? value.filter((w) => walletChain(w?.chain) && w?.address) : [];
}

/**
 * Add a wallet to the list; the same chain and address twice is one.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {{ chain: string, address: string, endpoints?: Record<string, string> }} input
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
	const wallets = await loadWallets(settings);
	const known = wallets.find((w) => w.chain === chain.id && w.address === address);
	if (known) return known;
	/** @type {Wallet} */
	const wallet = {
		id: `${chain.id}:${address}`,
		chain: chain.id,
		address,
		endpoints,
		addedAt: now.toISOString()
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
	const today = now.toISOString().slice(0, 10);
	const result = await client.walletHistory(chain.id, {
		address: wallet.address,
		endpoints: wallet.endpoints ?? {}
	});
	const { byAsset, unpriced } = await walletTransactions(result.entries, (asset, date) =>
		client.rate(asset, date)
	);

	// An account for every asset that moved or is held; a listed token never
	// touched (a balance of 0) gets none.
	/** @type {Map<string, { decimals: number, balance: string }>} */
	const wanted = new Map();
	for (const e of result.entries) {
		if (!wanted.has(e.asset)) wanted.set(e.asset, { decimals: e.decimals, balance: '0' });
	}
	for (const b of result.balances) {
		if (wanted.has(b.asset) || !/^0(\.0*)?$/.test(b.amount)) {
			wanted.set(b.asset, { decimals: b.decimals, balance: b.amount });
		}
	}

	const totals = { new: 0, updated: 0, skipped: 0 };
	/** @type {{ accountId: string, name: string, asset: string, counts: typeof totals }[]} */
	const perAccount = [];
	for (const [asset, info] of [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const key = `${wallet.address}:${asset}`;
		const record = await upsertAccount(store.accounts, {
			source: chain.id,
			sourceAccountId: key,
			ibanLast4: '',
			name: walletAccountName(chain, asset, wallet.address),
			currency: 'EUR',
			kind: 'wallet',
			asset,
			decimals: info.decimals
		});
		const counts = await importTransactions({
			transactions: store.transactions,
			account: { id: record.id, source: chain.id, fingerprintAccount: `${chain.id}:${key}` },
			incoming: byAsset.get(asset) ?? []
		});
		await store.accounts.put({
			...record,
			importEnabled: true,
			walletAddress: wallet.address,
			addressUrl: safeExplorerUrl(result.addressUrl) ?? '',
			lastSyncedOn: today,
			balance: info.balance,
			balanceOn: today
		});
		totals.new += counts.new;
		totals.updated += counts.updated;
		totals.skipped += counts.skipped;
		perAccount.push({ accountId: record.id, name: record.name, asset, counts });
	}

	await saveWallet(store.settings, {
		...wallet,
		addressUrl: safeExplorerUrl(result.addressUrl) ?? '',
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
		totals,
		perAccount,
		unpriced,
		unknownAssets: result.unknownAssets,
		history: result.history,
		endpoints: result.endpoints
	};
}
