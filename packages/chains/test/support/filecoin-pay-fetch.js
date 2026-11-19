// SPDX-License-Identifier: AGPL-3.0-or-later
// A fake of everything the Filecoin Pay reader asks, from one list of events
// given as plain objects: the makers' index (GraphQL: userTokens, rails,
// settlements, oneTimePayments), Filfox's token transfers of an address, and
// Blockscout's log API with its eth_call (by topic and block range, at most
// `perPage` an answer – as the real one). Any of the three can be switched
// off, to see the reader take the other way. Every address, hash and amount
// handed to it is made up.
import { keccak_256 } from '@noble/hashes/sha3.js';

const hex = (/** @type {Uint8Array} */ b) =>
	Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const topic = (/** @type {string} */ sig) => `0x${hex(keccak_256(new TextEncoder().encode(sig)))}`;
const word = (/** @type {string | bigint | number} */ v) =>
	typeof v === 'string' && v.startsWith('0x')
		? v.slice(2).toLowerCase().padStart(64, '0')
		: BigInt(v).toString(16).padStart(64, '0');

const SIG = {
	railCreated: 'RailCreated(uint256,address,address,address,address,address,address,uint256)',
	deposit: 'DepositRecorded(address,address,address,uint256)',
	withdraw: 'WithdrawRecorded(address,address,address,uint256)',
	settled: 'RailSettled(uint256,uint256,uint256,uint256,uint256,uint256)',
	oneTime: 'RailOneTimePaymentProcessed(uint256,uint256,uint256,uint256)'
};
const GENESIS = 1598306400;
/** The block of a moment. @param {string} iso */
export const blockAt = (iso) => Math.floor((Date.parse(iso) / 1000 - GENESIS) / 30);
/** Smallest units of an 18-decimal token. @param {string} amount */
export const units = (amount) => {
	const [whole, frac = ''] = amount.split('.');
	return BigInt(whole + frac.padEnd(18, '0').slice(0, 18));
};
const ZERO = `0x${'0'.repeat(40)}`;

/**
 * @typedef {{ at: string, tx?: string } & (
 *   | { rail: number, payer: string, payee: string, token: string, operator: string, commissionBps?: number }
 *   | { deposit: string, token: string, from: string, to: string }
 *   | { withdraw: string, token: string, from: string, to: string }
 *   | { settled: string, railId: number, toPayee: string, commission: string, fee: string, upTo: string }
 *   | { oneTime: string, railId: number, commission?: string, fee?: string }
 * )} PayEvent
 */

/**
 * @param {object} p
 * @param {string} p.contract
 * @param {PayEvent[]} p.events
 * @param {Record<string, string>} p.funds payer (lower case) → the balance now, as a decimal
 * @param {number} [p.perPage]
 * @param {string} [p.token] the token the index and Filfox know (0x…)
 * @param {(address: string) => string} [p.toFilecoin] 0x… → f410f…, for Filfox's answers
 * @param {{ index?: boolean, blockscout?: boolean, filfox?: boolean }} [p.down] which of the three answers 503
 * @returns {typeof fetch & { calls: string[] }}
 */
export function filecoinPayFetch({
	contract,
	events,
	funds,
	perPage = 1000,
	token = '',
	toFilecoin = (a) => a,
	down = {}
}) {
	const logs = events.map((/** @type {any} */ e, i) => {
		const block = blockAt(e.at);
		const base = {
			address: contract,
			blockNumber: `0x${block.toString(16)}`,
			timeStamp: `0x${Math.floor(Date.parse(e.at) / 1000).toString(16)}`,
			transactionHash: e.tx ?? `0x${(i + 1).toString(16).padStart(64, '0')}`,
			logIndex: `0x${i.toString(16)}`
		};
		if ('rail' in e)
			return {
				...base,
				topics: [
					topic(SIG.railCreated),
					`0x${word(e.rail)}`,
					`0x${word(e.payer)}`,
					`0x${word(e.payee)}`
				],
				data: `0x${word(e.token)}${word(e.operator)}${word(ZERO)}${word(ZERO)}${word(e.commissionBps ?? 0)}`
			};
		if ('deposit' in e)
			return {
				...base,
				topics: [topic(SIG.deposit), `0x${word(e.token)}`, `0x${word(e.from)}`, `0x${word(e.to)}`],
				data: `0x${word(units(e.deposit))}`
			};
		if ('withdraw' in e)
			return {
				...base,
				topics: [topic(SIG.withdraw), `0x${word(e.token)}`, `0x${word(e.from)}`, `0x${word(e.to)}`],
				data: `0x${word(units(e.withdraw))}`
			};
		if ('settled' in e)
			return {
				...base,
				topics: [topic(SIG.settled), `0x${word(e.railId)}`],
				data: `0x${word(units(e.settled))}${word(units(e.toPayee))}${word(units(e.commission))}${word(units(e.fee))}${word(blockAt(e.upTo))}`
			};
		const fee = units(e.fee ?? '0');
		const commission = units(e.commission ?? '0');
		return {
			...base,
			topics: [topic(SIG.oneTime), `0x${word(e.railId)}`],
			data: `0x${word(units(e.oneTime) - fee - commission)}${word(commission)}${word(fee)}`
		};
	});
	const json = (/** @type {unknown} */ body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	/** @type {string[]} */
	const calls = [];
	const f = /** @type {any} */ (
		async (/** @type {any} */ input, /** @type {any} */ init) => {
			const url = new URL(String(input));
			const unavailable = () => json({ error: 'unavailable' }, 503);
			// ---- the makers' index
			if (url.hostname === 'api.goldsky.com') {
				const query = String(JSON.parse(String(init?.body ?? '{}')).query ?? '');
				const name = /\{\s*(\w+)\(/.exec(query)?.[1] ?? '';
				calls.push(`index ${name}`);
				if (down.index) return unavailable();
				const payer = /(?:payer|account): "(0x[0-9a-f]{40})"/.exec(query)?.[1] ?? '';
				const since = Number(/createdAt_gte: "(\d+)"/.exec(query)?.[1] ?? 0);
				const after = /id_gt: "([^"]+)"/.exec(query)?.[1] ?? '';
				const all = /** @type {any[]} */ (events);
				const rails = all.filter((e) => 'rail' in e && e.payer === payer && e.token === token);
				const railOf = (/** @type {number} */ id) => rails.find((r) => r.rail === id);
				const at = (/** @type {any} */ e) => Math.floor(Date.parse(e.at) / 1000);
				/** @type {any[]} */
				let rows = [];
				if (name === 'userTokens') {
					rows =
						payer in funds
							? [{ id: `${payer}-token`, funds: String(units(funds[payer])), lockupCurrent: '0' }]
							: [];
				} else if (name === 'rails') {
					rows = rails.map((r) => ({
						id: `rail-${String(r.rail).padStart(9, '0')}`,
						railId: String(r.rail),
						commissionRateBps: String(r.commissionBps ?? 0),
						createdAt: String(at(r)),
						payee: { id: r.payee },
						operator: { id: r.operator }
					}));
				} else if (name === 'settlements') {
					rows = all
						.map((e, i) => ({ e, i }))
						.filter(({ e }) => 'settled' in e && railOf(e.railId) && at(e) >= since)
						.map(({ e, i }) => ({
							id: `0x${(i + 1).toString(16).padStart(64, '0')}`,
							totalSettledAmount: String(units(e.settled)),
							totalNetPayeeAmount: String(units(e.toPayee)),
							networkFee: String(units(e.fee)),
							operatorCommission: String(units(e.commission)),
							settledUpto: String(blockAt(e.upTo)),
							txHash: e.tx ?? `0x${(i + 1).toString(16).padStart(64, '0')}`,
							createdAt: String(at(e)),
							rail: { railId: String(e.railId) }
						}));
				} else if (name === 'oneTimePayments') {
					rows = all
						.map((e, i) => ({ e, i }))
						.filter(({ e }) => 'oneTime' in e && railOf(e.railId) && at(e) >= since)
						.map(({ e, i }) => {
							const fee = units(e.fee ?? '0');
							const commission = units(e.commission ?? '0');
							return {
								id: `0x${(i + 1).toString(16).padStart(64, '0')}`,
								totalAmount: String(units(e.oneTime)),
								netPayeeAmount: String(units(e.oneTime) - fee - commission),
								networkFee: String(fee),
								operatorCommission: String(commission),
								txHash: e.tx ?? `0x${(i + 1).toString(16).padStart(64, '0')}`,
								createdAt: String(at(e)),
								rail: { railId: String(e.railId) }
							};
						});
				}
				rows = rows.filter((r) => !after || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1));
				return json({ data: { [name]: rows.slice(0, 1000) } });
			}
			// ---- Filfox: the token's transfers of an address, newest first
			if (url.hostname === 'filfox.info') {
				const address = decodeURIComponent(
					/\/address\/([^/]+)\/token-transfers/.exec(url.pathname)?.[1] ?? ''
				);
				calls.push('filfox token-transfers');
				if (down.filfox) return unavailable();
				const page = Number(url.searchParams.get('page') ?? 0);
				const transfers = /** @type {any[]} */ (events)
					.map((e, i) => ({ e, i }))
					.filter(({ e }) => 'deposit' in e || 'withdraw' in e)
					.map(({ e, i }) =>
						'deposit' in e
							? { e, i, from: e.from, to: contract, value: units(e.deposit) }
							: { e, i, from: contract, to: e.to, value: units(e.withdraw) }
					)
					.map((t) => ({
						height: blockAt(t.e.at),
						timestamp: Math.floor(Date.parse(t.e.at) / 1000),
						message: `bafy2bzacefake${String(t.i).padStart(4, '0')}`,
						from: toFilecoin(t.from),
						to: toFilecoin(t.to),
						token: toFilecoin(t.e.token),
						value: String(t.value)
					}))
					.filter((t) => t.from === address || t.to === address)
					.sort((a, b) => b.timestamp - a.timestamp);
				return json({
					totalCount: transfers.length,
					transfers: transfers.slice(page * 100, page * 100 + 100)
				});
			}
			// ---- Blockscout
			if (down.blockscout) {
				calls.push('blockscout (down)');
				return unavailable();
			}
			if (url.pathname.endsWith('/eth-rpc')) {
				calls.push('eth_call');
				const call = JSON.parse(String(init?.body ?? '{}'));
				const data = String(call?.params?.[0]?.data ?? '');
				const owner = `0x${data.slice(-40)}`;
				const have = units(funds[owner] ?? '0');
				return json({
					jsonrpc: '2.0',
					id: 1,
					result: `0x${word(have)}${word(0)}${word(0)}${word(0)}`
				});
			}
			const q = url.searchParams;
			calls.push(`getLogs ${q.get('topic0')?.slice(0, 10)} from ${q.get('fromBlock')}`);
			if (q.get('address')?.toLowerCase() !== contract.toLowerCase())
				return json({ message: 'No logs found', result: [], status: '0' });
			const from = Number(q.get('fromBlock') ?? 0);
			const found = logs
				.filter((l) => l.topics[0] === q.get('topic0'))
				.filter((l) => Number.parseInt(l.blockNumber, 16) >= from)
				.filter((l) =>
					[1, 2, 3].every((n) => !q.get(`topic${n}`) || l.topics[n] === q.get(`topic${n}`))
				)
				.sort((a, b) => Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16));
			return found.length
				? json({ message: 'OK', result: found.slice(0, perPage), status: '1' })
				: json({ message: 'No logs found', result: [], status: '0' });
		}
	);
	f.calls = calls;
	return f;
}
