// A fake Aleph API on 127.0.0.1 for tests: balance, credit history (with its
// filters and pages), its summary, and messages. Every address, hash and
// amount here is made up.
import http from 'node:http';
import { createHash } from 'node:crypto';

/** A made-up 0x address from a phrase. @param {string} phrase */
export const fakeAlephAddress = (phrase) =>
	`0x${createHash('sha256').update(`aleph ${phrase}`).digest('hex').slice(0, 40)}`;

/** A made-up item hash. @param {string} phrase */
export const fakeItemHash = (phrase) => createHash('sha256').update(`item ${phrase}`).digest('hex');

/**
 * @typedef {object} FakeRow
 * @property {string} at ISO
 * @property {number} amount credits; negative leaves
 * @property {string} [paymentMethod] `credit_expense` for consumption
 * @property {string} [originRef] `storage`, or a billing message's hash
 * @property {string} [origin] a billed instance's item hash, or a transfer's other account
 * @property {string} [price] USD per credit, a purchase's
 * @property {string} [txHash]
 * @property {number} [count] resources billed
 * @property {number} [sizeMib]
 */

/**
 * @param {object} options
 * @param {Record<string, { balance: number, rows: FakeRow[] }>} options.accounts by address
 * @param {Record<string, { type: string, name: string }>} [options.messages] by item hash
 */
export async function startFakeAleph({ accounts, messages = {} }) {
	/** @type {string[]} */
	const calls = [];
	const server = http.createServer((req, res) => {
		const url = new URL(String(req.url), 'http://x');
		calls.push(url.pathname.replace(/0x[0-9a-fA-F]{40}/g, '<address>'));
		const reply = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const m =
			/^\/api\/v0\/addresses\/(0x[0-9a-fA-F]{40})\/(balance|credit_history(?:\/summary)?)$/.exec(
				url.pathname
			);
		if (m) {
			const account = accounts[m[1]];
			if (!account) {
				if (m[2] === 'balance') return reply(404, { error: 'unknown address' });
				if (m[2] === 'credit_history/summary') {
					return reply(200, {
						address: m[1],
						entry_count: 0,
						total_amount: 0,
						total_incoming: 0,
						total_outgoing: 0
					});
				}
				return reply(404, { error: 'no history' });
			}
			if (m[2] === 'balance') {
				return reply(200, {
					address: m[1],
					balance: 0,
					locked_amount: 0,
					credit_balance: account.balance,
					details: {},
					credit_balance_details: {}
				});
			}
			const start = Number(url.searchParams.get('startDate') ?? -Infinity);
			const end = Number(url.searchParams.get('endDate') ?? Infinity);
			const direction = url.searchParams.get('direction');
			const rows = account.rows
				.filter((r) => {
					const t = Date.parse(r.at) / 1000;
					return t >= start && t <= end;
				})
				.filter((r) => !direction || (direction === 'incoming' ? r.amount > 0 : r.amount < 0))
				.sort((a, b) => (a.at < b.at ? 1 : -1));
			if (m[2] === 'credit_history/summary') {
				const incoming = rows.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0);
				const outgoing = rows.filter((r) => r.amount < 0).reduce((n, r) => n + r.amount, 0);
				return reply(200, {
					address: m[1],
					entry_count: rows.length,
					total_amount: incoming + outgoing,
					total_incoming: incoming,
					total_outgoing: outgoing
				});
			}
			const per = Number(url.searchParams.get('pagination') ?? 100);
			const page = Number(url.searchParams.get('page') ?? 1);
			return reply(200, {
				address: m[1],
				credit_history: rows.slice((page - 1) * per, page * per).map((r, i) => ({
					amount: r.amount,
					price: r.price ?? null,
					bonus_amount: null,
					tx_hash: r.txHash ?? null,
					token: r.price ? 'USDC' : null,
					chain: r.price ? 'ETH' : null,
					provider: 'ALEPH',
					origin: r.origin ?? null,
					origin_ref: r.originRef ?? null,
					payment_method: r.paymentMethod ?? (r.price ? 'token' : 'credit_transfer'),
					credit_ref: fakeItemHash(`ref ${r.at} ${i}`),
					credit_index: i,
					expense_count: r.count ?? null,
					expense_size_mib: r.sizeMib ?? null,
					expiration_date: null,
					message_timestamp: r.at
				})),
				pagination_page: page,
				pagination_total: rows.length,
				pagination_per_page: per
			});
		}
		const msg = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(url.pathname);
		if (msg && messages[msg[1]]) {
			const { type, name } = messages[msg[1]];
			return reply(200, {
				status: 'processed',
				message: { type, item_hash: msg[1], content: { metadata: { name } } }
			});
		}
		return reply(404, { error: 'not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
