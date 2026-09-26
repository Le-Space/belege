// A Cosmos SDK wallet, read only, by its address: every transfer in or out,
// the fees it paid, and its balance. Nyx (Nym) first; any chain in
// registry.js with kind `cosmos`.
//
// Where the data comes from:
//   - CometBFT RPC `tx_search` (JSON-RPC over POST), twice: once for
//     `transfer.sender='<address>'` and once for `transfer.recipient='…'`,
//     100 a page, oldest first, until `total_count`; merged by hash. Every
//     change of a balance through the bank module is a `transfer` event, the
//     fee included, so the two queries see every movement a transaction
//     made – also a failed one, whose fee is still paid.
//   - `header?height=` for the time of each block (cached per height).
//   - `status` for the oldest block the node still has: a pruned node does
//     not know older transactions, and the sync says so instead of
//     pretending the wallet was empty.
//   - REST `/cosmos/bank/v1beta1/balances/<address>` for the balance.
//   - the transaction's bytes for its memo (protobuf.js).
//
// How a transaction becomes entries:
//   - the fee: the `tx` event's `fee` and `fee_payer` (cosmos-sdk ≥ 0.46),
//     else the fee from the transaction's AuthInfo and the sender of the
//     transfer to the fee collector. It is an entry of its own, only when
//     this address paid it, and the transfer to the fee collector is not
//     counted a second time.
//   - a failed transaction (code ≠ 0) moved nothing but the fee.
//   - every other `transfer` event from or to the address, one entry per
//     coin, with the other side as counterparty. Several messages in one
//     transaction give several entries. A transfer to itself is none.
//     Events of cosmos-sdk < 0.47 that pack several transfers into one
//     event, and base64-encoded attributes (CometBFT 0.34), are read too.
//   - the other side named when it is a module: rewards come from
//     `distribution`, a delegation goes to `bonded_tokens_pool`; an IBC
//     transfer names its receiver on the other chain.
// Denoms that are not in the chain's list (IBC vouchers `ibc/…`, factory
// tokens) are counted and left out.
//
// Not seen: tokens that come back when an unbonding ends (the chain does
// that in its end-block, not in a transaction) and vesting. The balance
// shows them; the difference is for a person to look at.
//
// The log gets counts, never an address.

import { isCosmosAddress, moduleAddress } from './bech32.js';
import { decodeTx } from './protobuf.js';
import { addressUrl, txUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';

/** Module accounts a transfer may go to or come from, and how they are named. */
const MODULES = /** @type {const} */ ({
	fee_collector: 'Gebührensammler der Chain',
	distribution: 'Staking-Belohnungen (distribution)',
	bonded_tokens_pool: 'Staking (gebunden)',
	not_bonded_tokens_pool: 'Staking (ungebunden)',
	gov: 'Governance-Einlage',
	mint: 'Neu geprägt (mint)'
});

const PER_PAGE = 100;
const COIN = /^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]{1,127})$/;

/**
 * @typedef {object} WalletEntry
 * @property {string} id unique and stable: `<hash>:m<msg_index>:e<event>.<triple>:<asset>`, the fee `<hash>:fee`
 * @property {string} hash
 * @property {number} height
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {'sent' | 'received' | 'fee'} type
 * @property {'transfer' | 'reward' | 'stake' | 'ibc' | 'fee'} kind
 * @property {string} asset symbol
 * @property {string} amount signed decimal: negative when it left the wallet
 * @property {number} decimals
 * @property {string} counterparty the other address ('' for a fee)
 * @property {string} counterpartyLabel a module's name, or ''
 * @property {string} memo
 * @property {boolean} success false for the fee of a failed transaction
 * @property {string} explorerUrl
 */

/**
 * `1500unym,20unyx` → coins; null when it does not parse.
 *
 * @param {string} text
 * @returns {{ denom: string, amount: bigint }[] | null}
 */
export function parseCoins(text) {
	if (typeof text !== 'string') return null;
	if (!text.trim()) return [];
	/** @type {{ denom: string, amount: bigint }[]} */
	const coins = [];
	for (const part of text.split(',')) {
		const m = COIN.exec(part.trim());
		if (!m) return null;
		coins.push({ denom: m[2], amount: BigInt(m[1]) });
	}
	return coins;
}

/** Units → a signed decimal string. @param {bigint} units @param {number} decimals */
export function unitsToDecimal(units, decimals) {
	const negative = units < 0n;
	const digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');
	const int = digits.slice(0, digits.length - decimals);
	const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
	return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/**
 * CometBFT 0.34 hands out event keys and values in base64; 0.37 and later
 * as text. Keys are short lower-case words, so text keys tell.
 *
 * @param {any[]} events
 * @returns {{ type: string, attributes: { key: string, value: string }[] }[]}
 */
export function readEvents(events) {
	const list = Array.isArray(events) ? events : [];
	const keys = list.flatMap((e) => (Array.isArray(e?.attributes) ? e.attributes : []));
	const plain = keys.every((a) => typeof a?.key === 'string' && /^[a-z_.]+$/.test(a.key));
	const read = (/** @type {unknown} */ v) =>
		typeof v !== 'string' ? '' : plain ? v : Buffer.from(v, 'base64').toString('utf8');
	return list.map((e) => ({
		type: String(e?.type ?? ''),
		attributes: (Array.isArray(e?.attributes) ? e.attributes : []).map((/** @type {any} */ a) => ({
			key: read(a?.key),
			value: read(a?.value)
		}))
	}));
}

/**
 * The transfers of a transaction's events: `{ sender, recipient, amount }`,
 * with where they stand – the event's index in the transaction and the
 * triple's within the event – so an entry keeps its id however the rest of
 * the transaction is read. One event may hold several (cosmos-sdk < 0.47); a
 * triple ends with its amount.
 *
 * @param {ReturnType<typeof readEvents>} events
 */
export function transfersOf(events) {
	/** @type {{ sender: string, recipient: string, amount: string, msgIndex: string | null, event: number, part: number }[]} */
	const out = [];
	events.forEach((event, index) => {
		if (event.type !== 'transfer') return;
		/** @type {Record<string, string>} */
		let current = {};
		let part = 0;
		const msgIndex = event.attributes.find((a) => a.key === 'msg_index')?.value ?? null;
		for (const { key, value } of event.attributes) {
			if (key === 'recipient' || key === 'sender') current[key] = value;
			if (key === 'amount') {
				out.push({
					sender: current.sender ?? '',
					recipient: current.recipient ?? '',
					amount: value,
					msgIndex,
					event: index,
					part: part++
				});
				current = {};
			}
		}
	});
	return out;
}

/**
 * One transaction from tx_search → the entries of `address`.
 *
 * @param {any} raw an item of `result.txs`
 * @param {object} context
 * @param {string} context.address
 * @param {import('./registry.js').CosmosChain} context.chain
 * @param {string} context.time ISO 8601 of its block
 * @returns {{ entries: WalletEntry[], unknownDenoms: string[] }}
 */
export function normalizeCosmosTx(raw, { address, chain, time }) {
	const hash = String(raw?.hash ?? '').toUpperCase();
	if (!/^[0-9A-F]{64}$/.test(hash))
		throw new WalletError('a transaction without a hash', 'WALLET_DATA');
	const height = Number(raw?.height);
	const code = Number(raw?.tx_result?.code ?? 0);
	const events = readEvents(raw?.tx_result?.events);
	const decoded = decodeTx(raw?.tx);
	const memo = decoded?.memo ?? '';
	const feeCollector = moduleAddress(chain.bech32Prefix, 'fee_collector');
	/** @type {Map<string, string>} */
	const modules = new Map(
		Object.entries(MODULES).map(([name, label]) => [moduleAddress(chain.bech32Prefix, name), label])
	);
	const pools = {
		distribution: moduleAddress(chain.bech32Prefix, 'distribution'),
		bonded: moduleAddress(chain.bech32Prefix, 'bonded_tokens_pool'),
		notBonded: moduleAddress(chain.bech32Prefix, 'not_bonded_tokens_pool')
	};
	const explorerUrl = txUrl(chain.explorer, hash);
	const date = time.slice(0, 10);
	/** @type {WalletEntry[]} */
	const entries = [];
	/** @type {string[]} */
	const unknownDenoms = [];

	const txEvent = (/** @type {string} */ key) =>
		events
			.find((e) => e.type === 'tx' && e.attributes.some((a) => a.key === key))
			?.attributes.find((a) => a.key === key)?.value;

	let transfers = transfersOf(events);
	// The fee and who paid it. The fee transfer is the ante handler's: to the
	// fee collector, outside any message (no msg_index), from the payer the
	// `tx` event names – recognised by where it stands, not by its amount
	// text, which need not be spelt as the fee is.
	const namedPayer = txEvent('fee_payer') ?? null;
	const feeTransfer = transfers.find(
		(t) =>
			t.recipient === feeCollector &&
			t.msgIndex === null &&
			(namedPayer === null || t.sender === namedPayer)
	);
	const payer = namedPayer ?? feeTransfer?.sender ?? '';
	if (feeTransfer) transfers = transfers.filter((t) => t !== feeTransfer);
	const feeText =
		txEvent('fee') ??
		((decoded?.fee ?? []).map((c) => `${c.amount}${c.denom}`).join(',') ||
			feeTransfer?.amount ||
			'');
	const feeCoins = parseCoins(feeText) ?? [];

	/**
	 * Ids that stay what they are when the rest of the transaction is read
	 * differently (a denom listed later, another entry found): the fee
	 * `<hash>:fee` (in another denom than the chain's own `<hash>:fee:<asset>`),
	 * a transfer `<hash>:m<msg_index>:e<event>.<triple>:<asset>`.
	 *
	 * @param {string} id
	 * @param {Omit<WalletEntry, 'id' | 'hash' | 'height' | 'time' | 'date' | 'explorerUrl' | 'memo'>} e
	 */
	const push = (id, e) => {
		entries.push({ id, hash, height, time, date, memo, explorerUrl, ...e });
	};

	/** @param {{ denom: string, amount: bigint }} coin */
	const assetOf = (coin) => {
		const asset = Object.hasOwn(chain.denoms, coin.denom) ? chain.denoms[coin.denom] : null;
		if (!asset) unknownDenoms.push(coin.denom);
		return asset;
	};

	if (payer === address) {
		for (const coin of feeCoins) {
			const asset = assetOf(coin);
			if (!asset || coin.amount === 0n) continue;
			push(coin.denom === chain.nativeDenom ? `${hash}:fee` : `${hash}:fee:${asset.symbol}`, {
				type: 'fee',
				kind: 'fee',
				asset: asset.symbol,
				amount: unitsToDecimal(-coin.amount, asset.decimals),
				decimals: asset.decimals,
				counterparty: '',
				counterpartyLabel: '',
				success: code === 0
			});
		}
	}
	if (code !== 0) return { entries, unknownDenoms };

	const ibcReceiver =
		events.find((e) => e.type === 'ibc_transfer')?.attributes.find((a) => a.key === 'receiver')
			?.value ?? '';
	for (const t of transfers) {
		const out = t.sender === address;
		const into = t.recipient === address;
		if (out === into) continue; // not ours, or to itself
		const other = out ? t.recipient : t.sender;
		const label = modules.get(other) ?? '';
		const coins = parseCoins(t.amount);
		if (!coins) throw new WalletError('a transfer amount that does not parse', 'WALLET_DATA');
		const kind =
			!out && other === pools.distribution
				? 'reward'
				: other === pools.bonded || other === pools.notBonded
					? 'stake'
					: out && ibcReceiver && !label
						? 'ibc'
						: 'transfer';
		for (const coin of coins) {
			const asset = assetOf(coin);
			if (!asset || coin.amount === 0n) continue;
			push(`${hash}:m${t.msgIndex ?? 'x'}:e${t.event}.${t.part}:${asset.symbol}`, {
				type: out ? 'sent' : 'received',
				kind,
				asset: asset.symbol,
				amount: unitsToDecimal(out ? -coin.amount : coin.amount, asset.decimals),
				decimals: asset.decimals,
				counterparty: kind === 'ibc' ? ibcReceiver : other,
				counterpartyLabel: kind === 'ibc' ? 'IBC-Transfer' : label,
				success: true
			});
		}
	}
	return { entries, unknownDenoms };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxPages] per query; beyond that the sync stops with an error
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createCosmosClient({ fetch: f = fetch, timeoutMs, maxPages = 200, sleep } = {}) {
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep });

	/**
	 * @param {string} rpc
	 * @param {string} method
	 * @param {Record<string, string | boolean>} params CometBFT: integers as strings, bools as bools
	 */
	async function rpcCall(rpc, method, params) {
		const body = await getJson(
			`${rpc}/`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
			},
			// "Internal error" with a timeout inside is a busy node, not a bad question.
			{ retryIf: (b) => /timed out|timeout|too many/i.test(String(b?.error?.data ?? '')) }
		);
		if (body?.error) {
			// A message may quote the query, and with it the address: bech32 strings go.
			const detail = String(body.error.data ?? body.error.message ?? '')
				.replace(/[a-z]{1,20}1[02-9ac-hj-np-z]{20,}/gi, '…')
				.slice(0, 120);
			throw new WalletError(`the node refused ${method}: ${detail}`, 'WALLET_RPC');
		}
		if (!body || typeof body !== 'object' || !('result' in body)) {
			throw new WalletError(`the node answered ${method} without a result`, 'WALLET_RPC');
		}
		return body.result;
	}

	return {
		/**
		 * @param {object} params
		 * @param {import('./registry.js').CosmosChain} params.chain
		 * @param {string} params.address
		 * @param {{ rpc: string, rest: string }} params.endpoints already checked
		 */
		async history({ chain, address, endpoints }) {
			if (!isCosmosAddress(address, chain.bech32Prefix)) {
				throw new WalletError(
					`not a ${chain.name} address (bech32, prefix ${chain.bech32Prefix}1…)`,
					'WALLET_ADDRESS',
					400
				);
			}
			const status = await rpcCall(endpoints.rpc, 'status', {});
			const network = String(status?.node_info?.network ?? '');
			if (network !== chain.chainId) {
				throw new WalletError(
					`the node belongs to chain "${network.slice(0, 40)}", not ${chain.chainId}`,
					'WALLET_WRONG_CHAIN',
					400
				);
			}
			const earliestHeight = Number(status?.sync_info?.earliest_block_height ?? 0);
			const earliestTime = String(status?.sync_info?.earliest_block_time ?? '') || null;

			/** @type {Map<string, any>} */
			const txs = new Map();
			for (const key of ['transfer.sender', 'transfer.recipient']) {
				for (let page = 1; ; page++) {
					if (page > maxPages) {
						throw new WalletError(
							`more than ${maxPages * PER_PAGE} transactions; not synchronised`,
							'WALLET_TOO_MANY'
						);
					}
					const result = await rpcCall(endpoints.rpc, 'tx_search', {
						query: `${key}='${address}'`,
						// CometBFT's JSON-RPC takes integers as strings, but a bool must be a
						// JSON bool: "false" is refused ("cannot unmarshal string into Go
						// value of type bool").
						prove: false,
						page: String(page),
						per_page: String(PER_PAGE),
						order_by: 'asc'
					});
					const batch = Array.isArray(result?.txs) ? result.txs : [];
					for (const tx of batch) txs.set(String(tx.hash).toUpperCase(), tx);
					const total = Number(result?.total_count ?? 0);
					if (!batch.length || page * PER_PAGE >= total) break;
				}
			}

			/** @type {Map<number, string>} */
			const times = new Map();
			const timeOf = async (/** @type {number} */ height) => {
				const known = times.get(height);
				if (known) return known;
				let header;
				try {
					header = (await rpcCall(endpoints.rpc, 'header', { height: String(height) }))?.header;
				} catch {
					header = (await rpcCall(endpoints.rpc, 'block', { height: String(height) }))?.block
						?.header;
				}
				const time = Date.parse(String(header?.time ?? ''));
				if (Number.isNaN(time)) {
					throw new WalletError(`no time for block ${height}`, 'WALLET_DATA');
				}
				const iso = new Date(time).toISOString();
				times.set(height, iso);
				return iso;
			};

			/** @type {WalletEntry[]} */
			const entries = [];
			/** @type {Set<string>} */
			const unknown = new Set();
			const ordered = [...txs.values()].sort(
				(a, b) => Number(a.height) - Number(b.height) || Number(a.index ?? 0) - Number(b.index ?? 0)
			);
			for (const raw of ordered) {
				const height = Number(raw.height);
				if (!Number.isSafeInteger(height) || height <= 0) {
					throw new WalletError('a transaction without a height', 'WALLET_DATA');
				}
				const result = normalizeCosmosTx(raw, { address, chain, time: await timeOf(height) });
				entries.push(...result.entries);
				for (const d of result.unknownDenoms) unknown.add(d);
			}

			const bank = await getJson(
				`${endpoints.rest}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}?pagination.limit=1000`
			);
			if (!Array.isArray(bank?.balances)) {
				throw new WalletError('the REST API answered the balance without balances', 'WALLET_NODE');
			}
			const balances = bank.balances.flatMap((/** @type {any} */ b) => {
				const asset = Object.hasOwn(chain.denoms, b?.denom) ? chain.denoms[b.denom] : null;
				if (!asset || !/^\d+$/.test(String(b.amount))) return [];
				return [
					{
						asset: asset.symbol,
						amount: unitsToDecimal(BigInt(b.amount), asset.decimals),
						decimals: asset.decimals
					}
				];
			});

			return {
				entries,
				balances,
				transactions: txs.size,
				unknownAssets: unknown.size,
				history: {
					earliestHeight,
					earliestTime,
					// A node that starts after block 1 has forgotten older transactions.
					pruned: earliestHeight > 1
				},
				addressUrl: addressUrl(chain.explorer, address)
			};
		}
	};
}
