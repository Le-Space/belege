// SPDX-License-Identifier: AGPL-3.0-or-later
// A fake Aleph API as a `fetch` function, for Node and browser tests alike:
// balance, credit history (filters, pages, newest first), its summary, and
// messages. Every address, hash and amount handed to it is made up.

/**
 * @typedef {object} Row
 * @property {string} at ISO
 * @property {number} amount credits; negative leaves
 * @property {string} [price] USD per credit, a purchase's
 * @property {string} [txHash]
 * @property {string} [token]
 * @property {string} [chain]
 * @property {string} [paymentMethod]
 * @property {string} [origin]
 * @property {string} [originRef]
 * @property {number} [count]
 * @property {number} [sizeMib]
 */

/**
 * @param {{ accounts: Record<string, { balance: number, rows: Row[] }>, messages?: Record<string, { type: string, name: string }> }} data
 * @returns {typeof fetch}
 */
export function alephFetch({ accounts, messages = {} }) {
	const json = (/** @type {unknown} */ body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	return async (input) => {
		const url = new URL(String(input));
		const q = url.searchParams;
		const message = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(url.pathname);
		if (message) {
			const m = messages[message[1]];
			return m
				? json({ message: { type: m.type, content: { metadata: { name: m.name } } } })
				: json({}, 404);
		}
		const m =
			/^\/api\/v0\/addresses\/(0x[0-9a-fA-F]{40})\/(balance|credit_history)(\/summary)?$/.exec(
				url.pathname
			);
		// Keyed in any case here; the client asks with the EIP-55 checksum, as Aleph needs.
		const key = m
			? Object.keys(accounts).find((a) => a.toLowerCase() === m[1].toLowerCase())
			: undefined;
		const account = key ? accounts[key] : undefined;
		if (!m || !account) return json({}, 404);
		if (m[2] === 'balance') return json({ credit_balance: account.balance });
		const from = q.has('startDate') ? Number(q.get('startDate')) * 1000 : -Infinity;
		const to = q.has('endDate') ? Number(q.get('endDate')) * 1000 : Infinity;
		const direction = q.get('direction');
		const rows = account.rows
			.filter((r) => Date.parse(r.at) >= from && Date.parse(r.at) <= to)
			.filter((r) => !direction || (direction === 'incoming' ? r.amount > 0 : r.amount < 0))
			.sort((a, b) => b.at.localeCompare(a.at));
		if (m[3])
			return json({
				total_amount: rows.reduce((n, r) => n + r.amount, 0),
				entry_count: rows.length
			});
		const per = Number(q.get('pagination') ?? 100);
		const page = Number(q.get('page') ?? 1);
		return json({
			pagination_total: rows.length,
			credit_history: rows.slice((page - 1) * per, page * per).map((r) => ({
				message_timestamp: r.at,
				amount: r.amount,
				price: r.price ?? null,
				tx_hash: r.txHash ?? null,
				token: r.token ?? null,
				chain: r.chain ?? null,
				payment_method: r.paymentMethod ?? null,
				origin: r.origin ?? null,
				origin_ref: r.originRef ?? null,
				expense_count: r.count ?? null,
				expense_size_mib: r.sizeMib ?? null
			}))
		});
	};
}
