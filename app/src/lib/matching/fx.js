// The ECB's rate of a payment's day, for an invoice in another currency
// (instalments.js `paidIn`). A USD invoice paid in instalments from euros –
// in Monero valued at the day's euro rate, or from a bank that names no
// original amount – could not be reckoned: euros are never taken for
// dollars. With the rate of each payment's day kept on the booking, each
// instalment counts in the invoice's currency, and the invoice says what is
// open in it.
//
// Kept as `fx: { USD: { rate, source, at } }` on the transaction: EUR per
// unit, from the bridge's /rates (bridge/src/rates.js, the ECB reference rate
// of the day or the last before it). An import does not own the field
// (bank/import.js FIELDS), so a sync keeps it. Only for what is linked: the
// active links of receipts in a currency other than the payment's, where the
// bank gave no original amount and no rate is kept yet.

/** @typedef {Record<string, any>} Rec */

/** A link that counts (engine.js `isActive`, kept here to load no engine). @param {Rec} m */
const isActive = (m) => !m.deleted && (m.state === 'auto' || m.state === 'confirmed');

/** A receipt's currency, upper case. @param {Rec} r */
const currencyOf = (r) => String(r?.currency ?? r?.extraction?.currency ?? 'EUR').toUpperCase();

/**
 * The linked payments that need a rate: `{ tx, currency, day }`, each payment
 * and currency once.
 *
 * @param {{ receipts: Rec[], matches: Rec[], transactions: Rec[] }} books
 * @returns {{ tx: Rec, currency: string, day: string }[]}
 */
export function fxGaps({ receipts, matches, transactions }) {
	const receiptById = new Map(receipts.filter((r) => !r.deleted).map((r) => [r.id, r]));
	const txById = new Map(transactions.filter((t) => !t.deleted).map((t) => [t.id, t]));
	/** @type {Map<string, { tx: Rec, currency: string, day: string }>} */
	const out = new Map();
	for (const m of matches) {
		if (!isActive(m)) continue;
		const receipt = receiptById.get(m.receiptId);
		const tx = txById.get(m.transactionId);
		if (!receipt || !tx) continue;
		const currency = currencyOf(receipt);
		if (!/^[A-Z]{3}$/.test(currency) || currency === 'EUR') continue;
		if (String(tx.currency ?? 'EUR').toUpperCase() !== 'EUR') continue;
		if (String(tx.original?.currency ?? '').toUpperCase() === currency) continue;
		if (tx.fx?.[currency]?.rate) continue;
		const day = String(tx.bookedOn ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		out.set(`${tx.id}|${currency}`, { tx, currency, day });
	}
	return [...out.values()];
}

/**
 * Ask the bridge for each gap's rate and keep it on the booking. One request
 * per currency and day; a rate the bridge does not have leaves the gap open
 * (asked again next time). At most `limit` requests a run.
 *
 * @param {object} params
 * @param {{ rate: (asset: string, date: string) => Promise<any> }} params.client
 * @param {import('../store/repository.js').Collection} params.transactions
 * @param {{ tx: Rec, currency: string, day: string }[]} params.gaps
 * @param {number} [params.limit]
 * @returns {Promise<number>} bookings that got a rate
 */
export async function fillFx({ client, transactions, gaps, limit = 60 }) {
	/** @type {Map<string, any>} */
	const asked = new Map();
	let filled = 0;
	for (const { tx, currency, day } of gaps) {
		const key = `${currency}|${day}`;
		if (!asked.has(key)) {
			if (asked.size >= limit) break;
			asked.set(key, await client.rate(currency, day).catch(() => null));
		}
		const rate = asked.get(key);
		if (!rate || typeof rate.rate !== 'string' || !(Number(rate.rate) > 0)) continue;
		const [current] = await transactions.list({ where: (/** @type {Rec} */ r) => r.id === tx.id });
		if (!current || current.fx?.[currency]?.rate) continue;
		await transactions.put({
			...current,
			fx: {
				...(current.fx ?? {}),
				[currency]: {
					rate: rate.rate,
					source: String(rate.source ?? 'ecb'),
					at: String(rate.at ?? `${day}T00:00:00Z`)
				}
			}
		});
		filled += 1;
	}
	return filled;
}
