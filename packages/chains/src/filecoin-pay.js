// SPDX-License-Identifier: AGPL-3.0-or-later
// Filecoin Pay, read only: what a payer's balance in the payment contract of
// Filecoin Onchain Cloud was used for in one month. Storage there is not
// paid by transfers of a wallet. A wallet pays USDFC *into* the contract, and
// the contract pays the storage providers out of that balance over "rails",
// settled from time to time. Only the paying in shows in the wallet; this
// reads the rest, so that the storage has a document: a statement per payer
// and month, as Aleph's and Akash's credits have.
//
// Two ways to read it, the first one first:
//
//   1. The index its makers keep (a subgraph at Goldsky, the one their own
//      explorer pay.filecoin.cloud asks): settlements and one-time payments
//      by payer, and the balance now. It has no paying in and taking out.
//      Those are two of the contract's events, asked of Blockscout (two
//      requests, by payer – they also show what somebody else paid into
//      the payer's balance). Where Blockscout does not answer, the USDFC
//      transfers between the payer and the contract are read from Filfox
//      instead, as the Filecoin wallet reader does; the statement then says
//      that money paid in by another address is not in it.
//   2. Where the index does not answer: the contract's own events from
//      Blockscout's log API (RailCreated, DepositRecorded, WithdrawRecorded,
//      RailSettled, RailOneTimePaymentProcessed) and the balance by
//      `eth_call` (`accounts(token, owner)`). Without a key Blockscout
//      allows about ten requests and then none for minutes; with one
//      (dev.blockscout.com, free) it is asked through api.blockscout.com,
//      the key in the `authorization` header, never in a URL.
//      The public RPC is no way: it gives events for 360 blocks.
//
// Whoever is asked sees the payer's address and this machine's IP.
//
// A settlement is the unit of consumption: what left the payer's balance for
// one rail, up to the epoch it names, split into what the provider got, the
// operator's commission and the network fee. Rails are settled when someone
// asks for it, so a month's settlements need not cover exactly that month –
// each line says up to when it paid. What has run up since the last
// settlement is not in the statement; the balance says what is left.
//
// Balances: the balance now, less what came and plus what went since the
// month began (or ended). Only USDFC is read, the token storage is paid in.
// A payer that is also a payee of rails gets money this does not read: its
// balances would be off by it.
//
// Addresses: `0x…` or the same account's `f410f…`. Times are UTC, the month
// is the UTC month. Error messages name a host at most, never an address.

import { entry, multiply, normalize, sortEntries } from '@le-space/ledger';
import { unitsToDecimal } from '@le-space/ledger/decimal';
import { base32nopad } from '@scure/base';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { createJsonFetcher, WalletError } from './http.js';
import { isFilecoinAddress, toFilecoinAddress } from './filecoin.js';

/**
 * Mainnet, from the makers' own published addresses (`@filoz/synapse-core`
 * 0.10.0, `filecoinPayV1Address[314]` and
 * `filecoinWarmStorageServiceAddress[314]`); USDFC as in filecoin-chain.js.
 */
export const FILECOIN_PAY = Object.freeze({
	contract: '0x23b1e018f08bb982348b15a86ee926eebf7f4daa',
	token: Object.freeze({
		symbol: 'USDFC',
		decimals: 18,
		contract: '0x80b98d3aa09ffff255c3ba4a241111ff1262f045'
	}),
	/** Operators of rails that are known for the service they run. */
	services: Object.freeze({
		'0x8408502033c418e1bbc97ce9ac48e5528f371a9f': 'Filecoin Warm Storage'
	}),
	/** The makers' index, as their explorer pay.filecoin.cloud is built to ask it (read 2026-11-19). */
	index:
		'https://api.goldsky.com/api/public/project_cmb9tuo8r1xdw01ykb8uidk7h/subgraphs/filecoin-pay-mainnet/prod/gn',
	filfox: 'https://filfox.info/api/v1',
	api: 'https://filecoin.blockscout.com/api',
	/** Blockscout's API for a key: every chain behind one host, by `chain_id`. */
	keyedApi: 'https://api.blockscout.com/v2/api',
	/** Its JSON-RPC for a key (`eth_call`): the chain in the path. */
	keyedRpc: 'https://api.blockscout.com/{chain}/json-rpc',
	chainId: 314,
	message: 'https://filfox.info/en/message/{tx}',
	explorer: Object.freeze({
		name: 'Blockscout',
		tx: 'https://filecoin.blockscout.com/tx/{tx}',
		address: 'https://filecoin.blockscout.com/address/{address}'
	})
});

/** Filecoin's mainnet began at this second; an epoch (an FEVM block) is 30 seconds. */
const GENESIS = 1598306400;
const EPOCH_SECONDS = 30;
/** Blockscout gives at most this many logs an answer. */
const PER_PAGE = 1000;

const hex = (/** @type {Uint8Array} */ bytes) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const topicOf = (/** @type {string} */ signature) =>
	`0x${hex(keccak_256(new TextEncoder().encode(signature)))}`;

const TOPIC = Object.freeze({
	railCreated: topicOf(
		'RailCreated(uint256,address,address,address,address,address,address,uint256)'
	),
	deposit: topicOf('DepositRecorded(address,address,address,uint256)'),
	withdraw: topicOf('WithdrawRecorded(address,address,address,uint256)'),
	settled: topicOf('RailSettled(uint256,uint256,uint256,uint256,uint256,uint256)'),
	oneTime: topicOf('RailOneTimePaymentProcessed(uint256,uint256,uint256,uint256)')
});
const ACCOUNTS = `0x${hex(keccak_256(new TextEncoder().encode('accounts(address,address)'))).slice(0, 8)}`;

/** An address as a 32-byte topic or call argument. @param {string} address 0x…, lower case */
const word = (address) => address.slice(2).padStart(64, '0');
/** The address in a 32-byte topic or data word. @param {string} w 64 hex characters */
const addressOf = (w) => `0x${w.slice(-40).toLowerCase()}`;
/** The 32-byte words of a log's data. @param {unknown} data */
function words(data) {
	const body = String(data ?? '').replace(/^0x/, '');
	if (body.length % 64 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) return [];
	return body.match(/.{64}/g) ?? [];
}
const uint = (/** @type {string | undefined} */ w) => (w ? BigInt(`0x${w}`) : 0n);

/** The epoch a second lies in. @param {number} seconds Unix */
export const epochAt = (seconds) => Math.max(0, Math.floor((seconds - GENESIS) / EPOCH_SECONDS));
/** When an epoch began, ISO. @param {number} epoch */
export const epochTime = (epoch) =>
	new Date((GENESIS + epoch * EPOCH_SECONDS) * 1000).toISOString();

/**
 * The Ethereum form of a payer's address: `0x…` as it is (lower case), or
 * the account behind a valid `f410f…`. Null for anything else – an f1 or f3
 * address has no account in a contract.
 *
 * @param {unknown} address
 * @returns {string | null}
 */
export function payerAddress(address) {
	const a = String(address ?? '').trim();
	if (/^0x[0-9a-fA-F]{40}$/.test(a)) return a.toLowerCase();
	if (!/^f410f[a-z2-7]+$/.test(a) || !isFilecoinAddress(a)) return null;
	const raw = base32nopad.decode(a.slice(5).toUpperCase());
	return `0x${hex(raw.slice(0, 20))}`;
}

/**
 * `YYYY-MM` → its first second, the first second after it, Unix, UTC.
 *
 * @param {string} month
 */
export function payMonth(month) {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
	if (!m) throw new WalletError('month must be YYYY-MM', 'FILPAY_MONTH', 400);
	return {
		start: Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 1000,
		next: Date.UTC(Number(m[1]), Number(m[2]), 1) / 1000
	};
}

/**
 * @typedef {object} PayLog one event of the contract, as Blockscout gives it
 * @property {string[]} topics
 * @property {string} data
 * @property {number} time Unix
 * @property {number} block
 * @property {string} txHash
 * @property {string} key transaction and log index: one event once
 */

/**
 * @typedef {object} Rail
 * @property {string} id
 * @property {string} payee 0x…
 * @property {string} operator 0x…
 * @property {string} service the operator's service, '' when not known
 * @property {number} commissionBps
 * @property {string} createdAt ISO
 */

/**
 * @typedef {object} Movement money paid into or taken out of the balance
 * @property {string} time ISO
 * @property {string} amount decimal, positive
 * @property {string} other who paid in, or where it was taken out to (0x…)
 * @property {string} txHash
 */

/**
 * @typedef {object} UsageLine one settlement of one rail
 * @property {string} time ISO, when it was settled
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {string} railId
 * @property {string} payee 0x…
 * @property {string} service
 * @property {boolean} oneTime a one-time payment, not a rate over time
 * @property {string} amount what left the balance, decimal
 * @property {string} toPayee of it, what the provider got
 * @property {string} commission of it, the operator's commission
 * @property {string} networkFee of it, the network's fee
 * @property {string | null} paidUntil ISO: up to when the rail is paid by this; null for a one-time payment
 * @property {string} txHash
 * @property {string | null} eurPerUnit the day's rate, EUR per USDFC
 * @property {number | null} eurCents
 */

/**
 * @typedef {object} PayRecords what either source gives, in one shape
 * @property {Map<string, Rail>} rails the payer's rails in the token, by id
 * @property {{ at: number, units: bigint, other: string, txHash: string }[]} paidIn since the month began
 * @property {{ at: number, units: bigint, other: string, txHash: string }[]} takenOut since the month began
 * @property {{ at: number, railId: string, total: bigint, toPayee: bigint, commission: bigint, fee: bigint, upTo: number | null, txHash: string }[]} spent
 *   settlements and one-time payments since the month began; `upTo` the epoch a settlement paid up to
 * @property {bigint} fundsNow the balance now, in the token's smallest units
 * @property {bigint} lockedNow of it, what is held for running rails
 * @property {'events' | 'transfers'} [movementsFrom] where paid in and taken out come from:
 *   the contract's events, or – without them – the payer's own token transfers
 */

/**
 * The contract's events (Blockscout) → the records. Pure.
 *
 * @param {object} p
 * @param {PayLog[]} p.rails RailCreated of the payer
 * @param {PayLog[]} p.deposits DepositRecorded to the payer
 * @param {PayLog[]} p.withdrawals WithdrawRecorded from the payer
 * @param {PayLog[]} p.settled RailSettled of any rail
 * @param {PayLog[]} p.oneTime RailOneTimePaymentProcessed of any rail
 * @param {bigint} p.fundsNow
 * @param {bigint} [p.lockedNow]
 * @returns {PayRecords}
 */
export function recordsFromLogs({
	rails,
	deposits,
	withdrawals,
	settled,
	oneTime,
	fundsNow,
	lockedNow = 0n
}) {
	const { token, services } = FILECOIN_PAY;
	const iso = (/** @type {number} */ s) => new Date(s * 1000).toISOString();
	const tokenTopic = `0x${word(token.contract)}`;

	/** @type {Map<string, Rail>} */
	const byId = new Map();
	for (const log of rails) {
		const w = words(log.data);
		// data: token, operator, validator, serviceFeeRecipient, commissionRateBps
		if (w.length < 5 || addressOf(w[0]) !== token.contract) continue;
		const id = uint(log.topics[1]?.slice(2)).toString();
		const operator = addressOf(w[1]);
		byId.set(id, {
			id,
			payee: addressOf(String(log.topics[3] ?? '')),
			operator,
			service: /** @type {Record<string, string>} */ (services)[operator] ?? '',
			commissionBps: Number(uint(w[4])),
			createdAt: iso(log.time)
		});
	}

	/** @param {PayLog[]} logs @param {number} otherTopic which topic names the other side */
	const movements = (logs, otherTopic) =>
		logs
			.filter((l) => l.topics[1]?.toLowerCase() === tokenTopic)
			.map((l) => ({
				at: l.time,
				units: uint(words(l.data)[0]),
				other: addressOf(String(l.topics[otherTopic] ?? '')),
				txHash: l.txHash
			}));

	/** @type {PayRecords['spent']} */
	const spent = [];
	for (const l of settled) {
		const railId = uint(l.topics[1]?.slice(2)).toString();
		const w = words(l.data);
		if (!byId.has(railId) || w.length < 5) continue;
		spent.push({
			at: l.time,
			railId,
			total: uint(w[0]),
			toPayee: uint(w[1]),
			commission: uint(w[2]),
			fee: uint(w[3]),
			upTo: Number(uint(w[4])),
			txHash: l.txHash
		});
	}
	for (const l of oneTime) {
		const railId = uint(l.topics[1]?.slice(2)).toString();
		const w = words(l.data);
		if (!byId.has(railId) || w.length < 3) continue;
		const [toPayee, commission, fee] = [uint(w[0]), uint(w[1]), uint(w[2])];
		spent.push({
			at: l.time,
			railId,
			total: toPayee + commission + fee,
			toPayee,
			commission,
			fee,
			upTo: null,
			txHash: l.txHash
		});
	}
	return {
		rails: byId,
		paidIn: movements(deposits, 2),
		takenOut: movements(withdrawals, 3),
		spent,
		fundsNow,
		lockedNow
	};
}

/**
 * The records of a month → the statement's lines. Pure.
 *
 * @param {PayRecords} records
 * @param {{ start: number, next: number }} window the month's first second, and the first after it
 */
export function summarisePay(
	{ rails: byId, paidIn, takenOut, spent: all, fundsNow },
	{ start, next }
) {
	const { token } = FILECOIN_PAY;
	const dec = (/** @type {bigint} */ units) => unitsToDecimal(units, token.decimals);
	const iso = (/** @type {number} */ s) => new Date(s * 1000).toISOString();
	// A settlement that moved nothing (the rail was paid up already) is no line.
	const spent = all.filter((s) => s.total > 0n && byId.has(s.railId));

	const sum = (/** @type {bigint[]} */ xs) => xs.reduce((a, b) => a + b, 0n);
	/** What came less what went, from a moment on. @param {number} from */
	const netSince = (from) =>
		sum(paidIn.filter((m) => m.at >= from).map((m) => m.units)) -
		sum(takenOut.filter((m) => m.at >= from).map((m) => m.units)) -
		sum(spent.filter((s) => s.at >= from).map((s) => s.total));
	const within = (/** @type {{ at: number }} */ x) => x.at >= start && x.at < next;

	/** @param {typeof paidIn} list @returns {Movement[]} */
	const lines = (list) =>
		list
			.filter(within)
			.sort((a, b) => a.at - b.at)
			.map((m) => ({ time: iso(m.at), amount: dec(m.units), other: m.other, txHash: m.txHash }));
	/** @type {UsageLine[]} */
	const usage = spent
		.filter(within)
		.sort((a, b) => a.at - b.at || a.railId.localeCompare(b.railId, 'en', { numeric: true }))
		.map((s) => {
			const rail = /** @type {Rail} */ (byId.get(s.railId));
			return {
				time: iso(s.at),
				date: iso(s.at).slice(0, 10),
				railId: s.railId,
				payee: rail.payee,
				service: rail.service,
				oneTime: s.upTo === null,
				amount: dec(s.total),
				toPayee: dec(s.toPayee),
				commission: dec(s.commission),
				networkFee: dec(s.fee),
				paidUntil: s.upTo === null ? null : epochTime(s.upTo),
				txHash: s.txHash,
				eurPerUnit: null,
				eurCents: null
			};
		});
	const used = new Set(usage.map((u) => u.railId));
	return {
		opening: dec(fundsNow - netSince(start)),
		closing: dec(fundsNow - netSince(next)),
		deposits: lines(paidIn),
		withdrawals: lines(takenOut),
		usage,
		rails: Object.fromEntries([...byId].filter(([id]) => used.has(id))),
		railCount: byId.size,
		totals: {
			deposits: dec(sum(paidIn.filter(within).map((m) => m.units))),
			withdrawals: dec(sum(takenOut.filter(within).map((m) => m.units))),
			usage: dec(sum(spent.filter(within).map((s) => s.total)))
		}
	};
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.maxPages] answers read per list before giving up
 * @param {number} [options.perPage] how many logs Blockscout gives an answer (a full answer is read on)
 * @param {number} [options.pauseMs] the wait between two requests to Blockscout
 * @param {{ rate: (asset: string, date: string) => Promise<{ rate: string, source: string }> } | null} [options.rates]
 * @param {() => Date} [options.now]
 * @param {{ api: string, rpc: string }} [options.keyed] where a Blockscout key is sent: Blockscout's
 *   keyed host. Set where the client is made, not per request, so that whoever asks for a
 *   statement cannot have the key sent elsewhere (tests: a fake on this machine).
 */
export function createFilecoinPayClient({
	fetch: f = fetch,
	timeoutMs = 30_000,
	sleep,
	maxPages = 40,
	perPage = PER_PAGE,
	pauseMs = 350,
	rates = null,
	now = () => new Date(),
	keyed = {
		api: FILECOIN_PAY.keyedApi,
		rpc: FILECOIN_PAY.keyedRpc.replace('{chain}', String(FILECOIN_PAY.chainId))
	}
} = {}) {
	const wait = sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep: wait });
	// Blockscout's public API refuses a quick run of requests (HTTP 429): one
	// after the other, with a breath between them.
	let asked = false;
	/** @type {typeof getJson} */
	const slowly = async (url, init, options) => {
		if (asked && pauseMs > 0) await wait(pauseMs);
		asked = true;
		return getJson(url, init, options);
	};
	const tooMany = () =>
		new WalletError('more events since that month than are read here', 'FILPAY_TOO_MANY', 413);

	// ---- 1. the makers' index, and Filfox for what was paid in and taken out

	/**
	 * One GraphQL list, whole: asked on by id until an answer is not full.
	 *
	 * @param {string} index @param {string} name the list's field
	 * @param {string} where the filter's inside, without the id
	 * @param {string} fields
	 * @returns {Promise<any[]>}
	 */
	async function listed(index, name, where, fields) {
		/** @type {any[]} */
		const out = [];
		let after = '';
		for (let page = 0; ; page++) {
			if (page >= maxPages) throw tooMany();
			const query = `{ ${name}(first: 1000, orderBy: id, where: { ${where}${after ? `, id_gt: "${after}"` : ''} }) { id ${fields} } }`;
			const body = await getJson(index, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query })
			});
			const batch = body?.data?.[name];
			if (!Array.isArray(batch))
				throw new WalletError('the index answered without a list', 'FILPAY_INDEX');
			out.push(...batch);
			if (batch.length < 1000) break;
			after = String(batch.at(-1)?.id ?? '');
			if (!after) break;
		}
		return out;
	}

	/**
	 * @param {string} payer 0x…, lower case
	 * @param {number} start the month's first second
	 * @param {{ index: string, filfox: string, blockscout: string, blockscoutKey?: string }} endpoints
	 * @returns {Promise<PayRecords>}
	 */
	async function fromIndex(payer, start, endpoints) {
		const { token, services, contract } = FILECOIN_PAY;
		const own = `payer: "${payer}", token: "${token.contract}"`;
		const tokens = await listed(
			endpoints.index,
			'userTokens',
			`account: "${payer}", token: "${token.contract}"`,
			'funds lockupCurrent'
		);
		const railRows = await listed(
			endpoints.index,
			'rails',
			own,
			'railId commissionRateBps createdAt payee { id } operator { id }'
		);
		/** @type {Map<string, Rail>} */
		const rails = new Map();
		for (const r of railRows) {
			const operator = String(r?.operator?.id ?? '').toLowerCase();
			rails.set(String(r.railId), {
				id: String(r.railId),
				payee: String(r?.payee?.id ?? '').toLowerCase(),
				operator,
				service: /** @type {Record<string, string>} */ (services)[operator] ?? '',
				commissionBps: Number(r.commissionRateBps ?? 0),
				createdAt: new Date(Number(r.createdAt ?? 0) * 1000).toISOString()
			});
		}
		const big = (/** @type {unknown} */ v) => (/^\d+$/.test(String(v)) ? BigInt(String(v)) : 0n);
		/** @type {PayRecords['spent']} */
		const spent = [];
		if (rails.size) {
			const settled = await listed(
				endpoints.index,
				'settlements',
				`rail_: { ${own} }, createdAt_gte: "${start}"`,
				'totalSettledAmount totalNetPayeeAmount networkFee operatorCommission settledUpto txHash createdAt rail { railId }'
			);
			for (const x of settled) {
				spent.push({
					at: Number(x.createdAt),
					railId: String(x?.rail?.railId),
					total: big(x.totalSettledAmount),
					toPayee: big(x.totalNetPayeeAmount),
					commission: big(x.operatorCommission),
					fee: big(x.networkFee),
					upTo: Number(x.settledUpto),
					txHash: String(x.txHash ?? '')
				});
			}
			const once = await listed(
				endpoints.index,
				'oneTimePayments',
				`${own}, createdAt_gte: "${start}"`,
				'totalAmount netPayeeAmount networkFee operatorCommission txHash createdAt rail { railId }'
			);
			for (const x of once) {
				spent.push({
					at: Number(x.createdAt),
					railId: String(x?.rail?.railId),
					total: big(x.totalAmount),
					toPayee: big(x.netPayeeAmount),
					commission: big(x.operatorCommission),
					fee: big(x.networkFee),
					upTo: null,
					txHash: String(x.txHash ?? '')
				});
			}
		}

		// Paid in and taken out: the contract's own events where Blockscout gives
		// them – they name the balance that got the money, whoever sent it.
		/** @type {PayRecords['paidIn']} */
		let paidIn = [];
		/** @type {PayRecords['takenOut']} */
		let takenOut = [];
		/** @type {'events' | 'transfers'} */
		let movementsFrom = 'events';
		try {
			const fromBlock = epochAt(start);
			const moved = recordsFromLogs({
				rails: [],
				deposits: await logs(endpoints, TOPIC.deposit, fromBlock, { index: 3, value: payer }),
				withdrawals: await logs(endpoints, TOPIC.withdraw, fromBlock, { index: 2, value: payer }),
				settled: [],
				oneTime: [],
				fundsNow: 0n
			});
			paidIn = moved.paidIn;
			takenOut = moved.takenOut;
		} catch (/** @type {any} */ error) {
			if (error?.code === 'FILPAY_TOO_MANY') throw error;
			// Else the token's transfers between the payer and the contract, newest
			// first, read back to the month's beginning. What another address paid
			// into this balance is not among them.
			movementsFrom = 'transfers';
			const self = toFilecoinAddress(payer);
			const pay = toFilecoinAddress(contract);
			const usdfc = toFilecoinAddress(token.contract);
			for (let page = 0; ; page++) {
				if (page >= maxPages) throw tooMany();
				const body = await getJson(
					`${endpoints.filfox}/address/${encodeURIComponent(self)}/token-transfers?pageSize=100&page=${page}`
				);
				const list = Array.isArray(body?.transfers) ? body.transfers : [];
				let older = false;
				for (const t of list) {
					const at = Number(t?.timestamp);
					if (!Number.isFinite(at)) continue;
					if (at < start) {
						older = true;
						continue;
					}
					if (String(t?.token) !== usdfc || !/^\d+$/.test(String(t?.value))) continue;
					const move = {
						at,
						units: BigInt(String(t.value)),
						other: payer,
						txHash: String(t.message ?? '')
					};
					if (t.from === self && t.to === pay) paidIn.push(move);
					else if (t.from === pay && t.to === self) takenOut.push(move);
				}
				if (older || list.length < 100) break;
			}
		}
		return {
			rails,
			paidIn,
			takenOut,
			spent,
			fundsNow: big(tokens[0]?.funds),
			lockedNow: big(tokens[0]?.lockupCurrent),
			movementsFrom
		};
	}

	// ---- 2. the contract's events, from Blockscout

	/**
	 * Blockscout's Etherscan-like API with a query: the chain's own instance, or
	 * – with a key – the one host for every chain. The key is not in the URL:
	 * it goes in a header (`keyHeaders`), so no log of URLs can hold it.
	 *
	 * @param {{ blockscout: string, blockscoutKey?: string }} endpoints
	 * @param {Record<string, string>} query
	 */
	const blockscoutUrl = (endpoints, query) => {
		const params = new URLSearchParams(query);
		if (!endpoints.blockscoutKey) return `${endpoints.blockscout}?${params}`;
		params.set('chain_id', String(FILECOIN_PAY.chainId));
		return `${keyed.api}?${params}`;
	};
	/** @param {{ blockscoutKey?: string }} endpoints @returns {Record<string, string>} */
	const keyHeaders = (endpoints) =>
		endpoints.blockscoutKey ? { authorization: `Bearer ${endpoints.blockscoutKey}` } : {};

	/**
	 * Every log of one event, oldest first, from a block on; narrowed to one
	 * indexed argument where given.
	 *
	 * @param {{ blockscout: string, blockscoutKey?: string }} endpoints
	 * @param {string} topic0 @param {number} fromBlock
	 * @param {{ index: 1 | 2 | 3, value: string } | null} [where]
	 * @returns {Promise<PayLog[]>}
	 */
	async function logs(endpoints, topic0, fromBlock, where = null) {
		/** @type {Map<string, PayLog>} */
		const seen = new Map();
		let from = fromBlock;
		for (let page = 0; ; page++) {
			if (page >= maxPages) throw tooMany();
			/** @type {Record<string, string>} */
			const query = {
				module: 'logs',
				action: 'getLogs',
				address: FILECOIN_PAY.contract,
				topic0,
				fromBlock: String(from),
				toBlock: 'latest'
			};
			if (where) {
				query[`topic${where.index}`] = `0x${word(where.value)}`;
				query[`topic0_${where.index}_opr`] = 'and';
			}
			const body = await slowly(blockscoutUrl(endpoints, query), {
				headers: keyHeaders(endpoints)
			});
			// "No logs found" comes with status 0 and an empty result.
			const batch = Array.isArray(body?.result) ? body.result : null;
			if (!batch) throw new WalletError('Blockscout answered without logs', 'FILPAY_DATA');
			let last = from;
			for (const r of batch) {
				const block = Number.parseInt(String(r?.blockNumber), 16);
				const time = Number.parseInt(String(r?.timeStamp), 16);
				const txHash = String(r?.transactionHash ?? '');
				if (!Number.isFinite(block) || !Number.isFinite(time) || !Array.isArray(r?.topics))
					continue;
				const key = `${txHash}:${String(r.logIndex)}`;
				seen.set(key, {
					topics: r.topics.filter((/** @type {unknown} */ t) => typeof t === 'string'),
					data: String(r.data ?? ''),
					time,
					block,
					txHash,
					key
				});
				last = Math.max(last, block);
			}
			if (batch.length < perPage) break;
			// A full answer: on from its last block (read again, kept once).
			if (last === from) throw tooMany();
			from = last;
		}
		return [...seen.values()].sort((a, b) => a.block - b.block || a.key.localeCompare(b.key));
	}

	/**
	 * The payer's balance in the contract now, by `eth_call`.
	 *
	 * @param {{ blockscout: string, blockscoutKey?: string }} endpoints @param {string} payer
	 */
	async function fundsOf(endpoints, payer) {
		const data = `${ACCOUNTS}${word(FILECOIN_PAY.token.contract)}${word(payer)}`;
		// The module API has no `eth_call` (no `proxy` module, checked 2026-11-19):
		// the JSON-RPC of the instance, or of the keyed host.
		const body = await slowly(
			endpoints.blockscoutKey ? keyed.rpc : `${endpoints.blockscout}/eth-rpc`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json', ...keyHeaders(endpoints) },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_call',
					params: [{ to: FILECOIN_PAY.contract, data }, 'latest']
				})
			}
		);
		const w = words(body?.result);
		if (w.length < 4)
			throw new WalletError('Blockscout answered the balance without one', 'FILPAY_DATA');
		return { funds: uint(w[0]), lockup: uint(w[1]) };
	}

	/**
	 * @param {string} payer @param {number} start
	 * @param {{ blockscout: string, blockscoutKey?: string }} endpoints
	 * @returns {Promise<PayRecords>}
	 */
	async function fromLogs(payer, start, endpoints) {
		const fromBlock = epochAt(start);
		const account = await fundsOf(endpoints, payer);
		const rails = await logs(endpoints, TOPIC.railCreated, 0, { index: 2, value: payer });
		const deposits = await logs(endpoints, TOPIC.deposit, fromBlock, { index: 3, value: payer });
		const withdrawals = await logs(endpoints, TOPIC.withdraw, fromBlock, {
			index: 2,
			value: payer
		});
		// A payer without rails spent nothing: the two long lists are not asked for.
		const settled = rails.length ? await logs(endpoints, TOPIC.settled, fromBlock) : [];
		const oneTime = rails.length ? await logs(endpoints, TOPIC.oneTime, fromBlock) : [];
		return recordsFromLogs({
			rails,
			deposits,
			withdrawals,
			settled,
			oneTime,
			fundsNow: account.funds,
			lockedNow: account.lockup
		});
	}

	return {
		/**
		 * One payer's balance in Filecoin Pay in one month: what it was at the
		 * beginning and the end, what was paid in and taken out, and each
		 * settlement of each rail, valued in euros. From the makers' index first;
		 * from Blockscout when the index does not answer (or `source` says so).
		 *
		 * @param {object} p
		 * @param {string} p.address the payer, `0x…` or `f410f…`
		 * @param {string} p.month YYYY-MM
		 * @param {'index' | 'logs'} [p.source] one way only; both in turn when left out
		 * @param {{ index?: string, filfox?: string, blockscout?: string, blockscoutKey?: string }} [p.endpoints] checked by the caller
		 */
		async statement({ address, month, source, endpoints = {} }) {
			const payer = payerAddress(address);
			if (!payer) {
				throw new WalletError(
					'not an address with an account in a contract (0x…, or f410f…)',
					'FILPAY_ADDRESS',
					400
				);
			}
			const { start, next } = payMonth(month);
			const nowSeconds = Math.floor(now().getTime() / 1000);
			if (start > nowSeconds)
				throw new WalletError('that month has not begun', 'FILPAY_MONTH', 400);
			const at = {
				index: (endpoints.index ?? FILECOIN_PAY.index).replace(/\/+$/, ''),
				filfox: (endpoints.filfox ?? FILECOIN_PAY.filfox).replace(/\/+$/, ''),
				blockscout: (endpoints.blockscout ?? FILECOIN_PAY.api).replace(/\/+$/, ''),
				...(endpoints.blockscoutKey ? { blockscoutKey: endpoints.blockscoutKey } : {})
			};

			/** @type {PayRecords} */
			let records;
			/** @type {'index' | 'logs'} */
			let from = source ?? 'index';
			/** @type {string | null} why the index was not used */
			let indexFailed = null;
			if (from === 'index') {
				try {
					records = await fromIndex(payer, start, at);
				} catch (/** @type {any} */ error) {
					// One way was asked for, or the history is too long either way: said as it is.
					if (source === 'index' || error?.code === 'FILPAY_TOO_MANY') throw error;
					indexFailed = String(error?.code ?? 'error');
					from = 'logs';
					records = await fromLogs(payer, start, at);
				}
			} else {
				records = await fromLogs(payer, start, at);
			}

			const summary = summarisePay(records, { start, next });

			/** @type {Map<string, string | null>} */
			const eurPerUnit = new Map();
			let rateSource = null;
			if (rates) {
				for (const line of summary.usage) {
					if (!eurPerUnit.has(line.date)) {
						const r = await rates.rate(FILECOIN_PAY.token.symbol, line.date).catch(() => null);
						eurPerUnit.set(line.date, r?.rate ?? null);
						rateSource ??= r?.source ?? null;
					}
					const rate = eurPerUnit.get(line.date) ?? null;
					line.eurPerUnit = rate;
					line.eurCents =
						rate === null
							? null
							: Math.round(Number(normalize(multiply(line.amount, rate, 8))) * 100);
				}
			}
			const cents = summary.usage.map((u) => u.eurCents);
			const dec = (/** @type {bigint} */ units) =>
				unitsToDecimal(units, FILECOIN_PAY.token.decimals);
			return {
				address: payer,
				filecoinAddress: toFilecoinAddress(payer),
				month,
				from: new Date(start * 1000).toISOString(),
				until: new Date((next - 1) * 1000).toISOString(),
				asset: FILECOIN_PAY.token.symbol,
				decimals: FILECOIN_PAY.token.decimals,
				...summary,
				totals: {
					...summary.totals,
					eurCents:
						summary.usage.length && cents.every((c) => c !== null)
							? cents.reduce((a, b) => /** @type {number} */ (a) + /** @type {number} */ (b), 0)
							: summary.usage.length
								? null
								: 0
				},
				/** As it is now, not at the month's end: the balance, and what of it is held for running rails. */
				now: {
					funds: dec(records.fundsNow),
					lockedUp: dec(records.lockedNow),
					at: now().toISOString()
				},
				rateSource,
				/** Where the lines come from, and – when the index was passed over – why. */
				source: from,
				indexFailed,
				/**
				 * `transfers`: paid in and taken out are the payer's own transfers to
				 * and from the contract; what another address paid in is missing, and
				 * the balances are off by it.
				 */
				movementsFrom: records.movementsFrom ?? 'events',
				entries: records.paidIn.length + records.takenOut.length + records.spent.length
			};
		}
	};
}

/**
 * A statement's lines as ledger entries, seen from the payer's balance in the
 * contract: paid in (`received`), taken out (`sent`), and each settlement
 * (`sent`, kind `usage`) with the provider as the other side. Asset USDFC,
 * priced as a dollar stablecoin where a rate is needed.
 *
 * @param {Awaited<ReturnType<ReturnType<typeof createFilecoinPayClient>['statement']>>} statement
 * @returns {import('@le-space/ledger').LedgerEntry[]}
 */
export function filecoinPayEntries(statement) {
	const { address, deposits, withdrawals, usage } = statement;
	const { token, explorer } = FILECOIN_PAY;
	// A message's CID (from Filfox) or a transaction's hash (from the index and Blockscout).
	const link = (/** @type {string} */ tx) =>
		(tx.startsWith('0x') ? explorer.tx : FILECOIN_PAY.message).replace('{tx}', tx);
	const common = {
		chain: 'filecoin-pay',
		network: 'mainnet',
		account: address,
		height: 0,
		asset: token.symbol,
		contract: token.contract,
		decimals: token.decimals,
		method: '',
		success: true,
		priceAs: 'USDC'
	};
	return sortEntries([
		...deposits.map((d, i) =>
			entry({
				...common,
				id: `filecoin-pay:${address}:in:${d.txHash}:${i}`,
				hash: d.txHash,
				time: d.time,
				type: 'received',
				kind: 'transfer',
				amount: d.amount,
				counterparty: d.other,
				counterpartyLabel: d.other === address ? 'Einzahlung in Filecoin Pay' : '',
				memo: '',
				explorerUrl: link(d.txHash)
			})
		),
		...withdrawals.map((w, i) =>
			entry({
				...common,
				id: `filecoin-pay:${address}:out:${w.txHash}:${i}`,
				hash: w.txHash,
				time: w.time,
				type: 'sent',
				kind: 'transfer',
				amount: `-${w.amount}`,
				counterparty: w.other,
				counterpartyLabel: w.other === address ? 'Auszahlung aus Filecoin Pay' : '',
				memo: '',
				explorerUrl: link(w.txHash)
			})
		),
		...usage.map((u, i) =>
			entry({
				...common,
				id: `filecoin-pay:${address}:usage:${u.txHash}:${u.railId}:${i}`,
				hash: u.txHash,
				time: u.time,
				type: 'sent',
				kind: 'usage',
				amount: `-${u.amount}`,
				counterparty: u.payee,
				counterpartyLabel: `${u.service || 'Filecoin Pay'} (Rail ${u.railId})`,
				memo: u.paidUntil ? `bezahlt bis ${u.paidUntil.slice(0, 10)}` : 'Einmalzahlung',
				explorerUrl: link(u.txHash),
				...(u.eurPerUnit
					? {
							unitPrice: {
								currency: 'EUR',
								amount: u.eurPerUnit,
								source: statement.rateSource ?? ''
							}
						}
					: {})
			})
		)
	]);
}
