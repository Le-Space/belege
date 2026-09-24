// Grouping and formatting for the transaction list. Pure, so it is tested
// without a database.

const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/**
 * Transactions grouped by the month they were booked in, newest month first,
 * newest booking first inside a month.
 *
 * @template {{ bookedOn: string, id: string }} T
 * @param {T[]} transactions `bookedOn` as `YYYY-MM-DD`
 * @returns {{ month: string, label: string, items: T[] }[]}
 */
export function groupByMonth(transactions) {
	/** @type {Map<string, T[]>} */
	const groups = new Map();
	for (const tx of transactions) {
		const month = String(tx.bookedOn ?? '').slice(0, 7) || 'unbekannt';
		const items = groups.get(month) ?? [];
		items.push(tx);
		groups.set(month, items);
	}

	return [...groups.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([month, items]) => ({
			month,
			label: /^\d{4}-\d{2}$/.test(month)
				? MONTH.format(new Date(`${month}-01T00:00:00Z`))
				: 'Ohne Datum',
			items: items.sort((x, y) =>
				x.bookedOn === y.bookedOn ? (x.id < y.id ? 1 : -1) : x.bookedOn < y.bookedOn ? 1 : -1
			)
		}));
}

/** @param {number} cents */
export function formatCents(cents) {
	return EURO.format(cents / 100);
}
