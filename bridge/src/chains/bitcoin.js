// A Bitcoin wallet, read only, by its account's extended public key: a zpub
// (BIP84, native SegWit, bc1q…), a ypub (BIP49, 3…), or an xpub – which
// wallets hand out for either kind, so with an xpub the address type is said
// at setup: `p2wpkh` (bc1q…) or `p2pkh` (1…).
//
// The key never leaves the bridge: `pnpm setup:bitcoin` puts it into the
// macOS keychain (account `bitcoin`, JSON `{ key, type }`), and the app knows
// the wallet only by a fingerprint (`btc-` + 8 hex of the key's SHA-256),
// which the bridge checks on every sync, so a replaced key does not book onto
// the old account.
//
// Addresses are derived here (the key is the account; /0/i receive, /1/i
// change) until 20 in a row have never been used (BIP44 gap limit). Each used
// address is asked of an Esplora API (mempool.space by default, or the
// person's own):
//   GET /address/<a>                   chain_stats: used? balance
//   GET /address/<a>/txs/chain[/<last>] its confirmed transactions, 25 a page
// That API sees every address asked and this Mac's IP, so it can tell they
// belong together – the consent screen says so; an own Esplora avoids it.
//
// How a transaction becomes entries, from the wallet's point of view (all
// its addresses together):
//   - ours in = sum of inputs from our addresses, ours out = outputs to them
//   - all inputs ours: we sent. The fee is an entry of its own (type fee),
//     the rest is sent to the others (nothing, if all went to our change)
//   - no input ours: we received what went to our addresses
//   - some inputs ours (a payjoin or coinjoin): one entry with the net
//     change, fee included, marked in the memo – rare, and for a person
// Only confirmed transactions are booked; unconfirmed ones are counted.
// The log gets counts, never an address, a txid or the key.

import { HDKey } from '@scure/bip32';
import { bech32, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

import { txUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';

/** SLIP-132 version bytes (mainnet) of each extended public key, with its private twin. */
const VERSIONS = /** @type {const} */ ({
	xpub: { public: 0x0488b21e, private: 0x0488ade4 },
	ypub: { public: 0x049d7cb2, private: 0x049d7878 },
	zpub: { public: 0x04b24746, private: 0x04b2430c }
});
/** The address type a prefix means; an xpub says nothing. */
const TYPE_OF = /** @type {const} */ ({ ypub: 'p2sh-p2wpkh', zpub: 'p2wpkh' });
export const ADDRESS_TYPES = /** @type {const} */ (['p2wpkh', 'p2sh-p2wpkh', 'p2pkh']);
const base58check = createBase58check(sha256);
const GAP_LIMIT = 20;
const MAX_ADDRESSES = 2000;

/**
 * The fingerprint the app knows a key by: `btc-` + the first 8 hex of its
 * SHA-256. Tells two keys apart; says nothing about the addresses.
 *
 * @param {string} key
 */
export function keyFingerprint(key) {
	return `btc-${Buffer.from(sha256(new TextEncoder().encode(key.trim())))
		.toString('hex')
		.slice(0, 8)}`;
}

/**
 * An extended public key and the address type to derive.
 *
 * @param {string} text xpub…, ypub… or zpub…
 * @param {string} [type] required for an xpub
 * @returns {{ account: HDKey, type: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' }} throws a WalletError when it is none
 */
export function parseExtendedKey(text, type) {
	const key = String(text ?? '').trim();
	const prefix = /** @type {keyof typeof VERSIONS} */ (key.slice(0, 4));
	if (!Object.hasOwn(VERSIONS, prefix)) {
		throw new WalletError('not an extended public key (xpub, ypub or zpub)', 'WALLET_ADDRESS', 400);
	}
	const implied = prefix === 'xpub' ? null : TYPE_OF[prefix];
	const chosen = type ?? implied;
	if (!chosen || !ADDRESS_TYPES.includes(/** @type {any} */ (chosen))) {
		throw new WalletError(
			'an xpub needs its address type: p2wpkh (bc1q…) or p2pkh (1…)',
			'WALLET_ADDRESS',
			400
		);
	}
	if (implied && chosen !== implied) {
		throw new WalletError(`a ${prefix} is ${implied}, not ${chosen}`, 'WALLET_ADDRESS', 400);
	}
	/** @type {HDKey} */ let account;
	try {
		account = HDKey.fromExtendedKey(key, VERSIONS[prefix]);
	} catch {
		throw new WalletError(
			'not a valid extended public key (checksum or length)',
			'WALLET_ADDRESS',
			400
		);
	}
	if (account.privateKey) {
		throw new WalletError('that is a private key; give the public one', 'WALLET_ADDRESS', 400);
	}
	return { account, type: /** @type {'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh'} */ (chosen) };
}

/**
 * The keychain's entry: JSON `{ key, type }`, or a bare zpub/ypub.
 *
 * @param {string} stored
 */
export function parseStoredKey(stored) {
	/** @type {any} */ let value = null;
	try {
		value = JSON.parse(stored);
	} catch {
		value = { key: stored };
	}
	const key = String(value?.key ?? '').trim();
	return { key, ...parseExtendedKey(key, value?.type || undefined) };
}

/**
 * The address of the public key at `<chain>/<index>` below the account.
 *
 * @param {HDKey} account
 * @param {'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh'} type
 * @param {0 | 1} chain 0 receive, 1 change
 * @param {number} index
 */
export function deriveAddress(account, type, chain, index) {
	const pub = account.deriveChild(chain).deriveChild(index).publicKey;
	if (!pub) throw new WalletError('cannot derive a public key', 'WALLET_ADDRESS', 400);
	const hash = ripemd160(sha256(pub));
	if (type === 'p2wpkh') return bech32.encode('bc', [0, ...bech32.toWords(hash)]);
	if (type === 'p2pkh') return base58check.encode(Uint8Array.of(0x00, ...hash));
	// p2sh-p2wpkh: the script hash of `0 <20-byte key hash>`
	const redeem = Uint8Array.of(0x00, 0x14, ...hash);
	return base58check.encode(Uint8Array.of(0x05, ...ripemd160(sha256(redeem))));
}

/**
 * @typedef {object} EsploraTx the parts this module reads
 * @property {string} txid
 * @property {{ confirmed: boolean, block_height?: number, block_time?: number }} status
 * @property {number} fee sats
 * @property {{ prevout: { scriptpubkey_address?: string, value: number } | null }[]} vin
 * @property {{ scriptpubkey_address?: string, value: number }[]} vout
 */

/**
 * Entries for our transactions (pure; the tests call it directly).
 *
 * @param {EsploraTx[]} txs confirmed, each once
 * @param {Set<string>} own our addresses
 * @param {import('./registry.js').BitcoinChain} chain
 * @returns {import('./cosmos.js').WalletEntry[]}
 */
export function normalizeBitcoin(txs, own, chain) {
	/** @type {import('./cosmos.js').WalletEntry[]} */
	const entries = [];
	const decimals = chain.native.decimals;
	const btc = (/** @type {bigint} */ sats) => unitsToDecimal(sats, decimals);
	for (const tx of [...txs].sort(
		(a, b) => (a.status.block_height ?? 0) - (b.status.block_height ?? 0)
	)) {
		const inputs = tx.vin.map((i) => i.prevout).filter((p) => p !== null);
		const oursIn = inputs.filter((p) => own.has(String(p?.scriptpubkey_address ?? '')));
		const inSats = oursIn.reduce((s, p) => s + BigInt(p?.value ?? 0), 0n);
		const outSats = tx.vout
			.filter((o) => own.has(String(o.scriptpubkey_address ?? '')))
			.reduce((s, o) => s + BigInt(o.value), 0n);
		const time = new Date((tx.status.block_time ?? 0) * 1000).toISOString();
		const base = {
			hash: tx.txid,
			height: tx.status.block_height ?? 0,
			time,
			date: time.slice(0, 10),
			asset: chain.native.symbol,
			decimals,
			counterpartyLabel: '',
			success: true,
			explorerUrl: txUrl(chain.explorer, tx.txid)
		};
		const fee = BigInt(tx.fee ?? 0);
		const allOurs = oursIn.length > 0 && oursIn.length === inputs.length;
		const firstOther = (/** @type {{ scriptpubkey_address?: string }[]} */ list) =>
			list.map((x) => String(x?.scriptpubkey_address ?? '')).find((a) => a && !own.has(a)) ?? '';

		if (allOurs) {
			const sent = inSats - outSats - fee; // what went to others
			if (sent > 0n) {
				entries.push({
					...base,
					id: `${tx.txid}:value`,
					type: 'sent',
					kind: 'transfer',
					amount: btc(-sent),
					counterparty: firstOther(tx.vout),
					memo: ''
				});
			}
			if (fee > 0n) {
				entries.push({
					...base,
					id: `${tx.txid}:fee`,
					type: 'fee',
					kind: 'fee',
					amount: btc(-fee),
					counterparty: '',
					memo: ''
				});
			}
		} else if (oursIn.length === 0) {
			if (outSats > 0n) {
				entries.push({
					...base,
					id: `${tx.txid}:value`,
					type: 'received',
					kind: 'transfer',
					amount: btc(outSats),
					counterparty: firstOther(inputs.map((p) => p ?? {})),
					memo: ''
				});
			}
		} else {
			const net = outSats - inSats;
			if (net !== 0n) {
				entries.push({
					...base,
					id: `${tx.txid}:value`,
					type: net < 0n ? 'sent' : 'received',
					kind: 'transfer',
					amount: btc(net),
					counterparty: firstOther(net < 0n ? tx.vout : inputs.map((p) => p ?? {})),
					memo: 'Inputs from several wallets: the fee is included in this amount.'
				});
			}
		}
	}
	return entries;
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {() => Promise<string | null>} options.getZpub the keychain's zpub, or null
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.pauseMs] between requests, to stay under a public API's limit
 */
export function createBitcoinClient({
	fetch: f,
	getZpub,
	timeoutMs,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	pauseMs = 250
}) {
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep });
	/** @param {string} url */
	const get = async (url) => {
		if (pauseMs) await sleep(pauseMs);
		return getJson(url);
	};

	async function key() {
		const stored = await getZpub().catch(() => null);
		if (!stored) {
			throw new WalletError(
				'no Bitcoin key in the keychain: run `pnpm setup:bitcoin`',
				'WALLET_NOT_SET_UP',
				503
			);
		}
		return parseStoredKey(stored);
	}

	return {
		/** The fingerprint of the configured zpub, or null. */
		async fingerprint() {
			const stored = await getZpub().catch(() => null);
			if (!stored) return null;
			try {
				return keyFingerprint(parseStoredKey(stored).key);
			} catch {
				return null;
			}
		},

		/**
		 * @param {{ chain: import('./registry.js').BitcoinChain, address: string, endpoints: { api: string } }} params
		 *   `address` is the fingerprint the app knows the wallet by
		 */
		async history({ chain, address, endpoints }) {
			const { key: text, account, type } = await key();
			if (address !== keyFingerprint(text)) {
				throw new WalletError(
					'the Bitcoin key in the keychain is not the one this wallet was added with',
					'WALLET_KEY_CHANGED',
					409
				);
			}

			/** @type {Map<string, { funded: bigint, spent: bigint, txs: number }>} */
			const used = new Map();
			/** @type {Set<string>} */
			const own = new Set();
			for (const branch of /** @type {const} */ ([0, 1])) {
				let unused = 0;
				for (let i = 0; unused < GAP_LIMIT; i++) {
					if (own.size >= MAX_ADDRESSES) {
						throw new WalletError('more than 2000 addresses in use', 'WALLET_TOO_LARGE', 413);
					}
					const a = deriveAddress(account, type, branch, i);
					own.add(a);
					const info = await get(`${endpoints.api}/address/${a}`);
					const s = info?.chain_stats ?? {};
					const txs = Number(s.tx_count ?? 0) + Number(info?.mempool_stats?.tx_count ?? 0);
					if (txs === 0) {
						unused++;
						continue;
					}
					unused = 0;
					used.set(a, {
						funded: BigInt(s.funded_txo_sum ?? 0),
						spent: BigInt(s.spent_txo_sum ?? 0),
						txs: Number(s.tx_count ?? 0)
					});
				}
			}

			/** @type {Map<string, EsploraTx>} */
			const confirmed = new Map();
			for (const [a, stats] of used) {
				if (!stats.txs) continue;
				let last = '';
				for (let page = 0; page < 1000; page++) {
					/** @type {EsploraTx[]} */
					const list = await get(
						`${endpoints.api}/address/${a}/txs/chain${last ? `/${last}` : ''}`
					);
					if (!Array.isArray(list) || !list.length) break;
					for (const tx of list) if (tx?.status?.confirmed) confirmed.set(tx.txid, tx);
					last = list[list.length - 1].txid;
					if (list.length < 25) break;
				}
			}
			const balance = [...used.values()].reduce((s, u) => s + u.funded - u.spent, 0n);
			const entries = normalizeBitcoin([...confirmed.values()], own, chain);
			return {
				entries,
				balances: [
					{
						asset: chain.native.symbol,
						amount: unitsToDecimal(balance, chain.native.decimals),
						decimals: chain.native.decimals
					}
				],
				transactions: confirmed.size,
				unknownAssets: 0,
				history: { earliestHeight: 0, earliestTime: null, pruned: false },
				addresses: { used: used.size, derived: own.size },
				addressUrl: ''
			};
		}
	};
}
