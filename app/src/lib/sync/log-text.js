// The devices' log as the devices card shows it (DevicesCard.svelte): when a
// line came, and what it was about. Up to a hundred lines and every device row
// are formatted on each render, so the formatters are made once per language
// (bank/format.js), not once per line.

import { formatter } from '../bank/format.js';
import { intlLocale } from '../i18n/index.js';

/** A moment of the log, day and time. @param {number} at ms */
export const logTime = (at) =>
	formatter('date', intlLocale(), { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(at));

/**
 * A receipt's file, size and date; a payment's counterparty, amount and day; a setting's key.
 *
 * @param {import('./sync-log.js').SyncLine} line
 */
export function logWhat(line) {
	const w = line.what ?? {};
	const parts = [];
	if (w.fileName) parts.push(w.fileName);
	if (typeof w.size === 'number')
		parts.push(
			`${formatter('number', intlLocale(), { maximumFractionDigits: 0 }).format(w.size / 1024)} kB`
		);
	if (w.counterparty) parts.push(w.counterparty);
	if (typeof w.amountCents === 'number')
		parts.push(
			formatter('number', intlLocale(), { style: 'currency', currency: 'EUR' }).format(
				w.amountCents / 100
			)
		);
	if (w.date) parts.push(w.date);
	if (w.key) parts.push(w.key);
	return parts.join(' · ');
}
