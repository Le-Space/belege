// The month's ZIP, made in the browser: the Buchungsstapel in Windows-1252,
// the receipts' files (opened from the sealed blob store), and the overview.
// Nothing leaves the browser; the page hands the bytes to a download.
// Loaded lazily by the export page, with fflate.
//
//   DATEV/EXTF_Buchungsstapel_<YYYY-MM>.csv
//   Belege/<receipt number>_<vendor>.pdf
//   Kontoauszuege/<statement number>_<account>.pdf   one per account (statement.js)
//   Uebersicht_<YYYY-MM>.csv

import { zipSync, strToU8 } from 'fflate';

import { recordEvent } from '../activity/events.js';
import { receiptVendor } from '../receipts/view.js';
import { encodeWindows1252 } from './cp1252.js';
import { buchungsstapel } from './datev.js';
import { overviewCsv } from './overview.js';
import { statementPdf } from './statement-pdf.js';

/** @typedef {Record<string, any>} Rec */

const EXTENSION = /** @type {Record<string, string>} */ ({
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp'
});

/**
 * A vendor as part of a file name: umlauts spelled out, anything else but
 * letters, digits and "-" as "_", at most 40 characters.
 *
 * @param {string} vendor
 */
export function fileSlug(vendor) {
	const s = vendor
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/Ä/g, 'Ae')
		.replace(/Ö/g, 'Oe')
		.replace(/Ü/g, 'Ue')
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9-]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40)
		.replace(/_+$/, '');
	return s || 'Beleg';
}

/**
 * The path of a receipt's file in the ZIP.
 *
 * @param {string} number
 * @param {Rec} receipt
 */
export function receiptPath(number, receipt) {
	const ext = EXTENSION[String(receipt.mime ?? '')] ?? 'pdf';
	return `Belege/${number}_${fileSlug(receiptVendor(/** @type {any} */ (receipt)))}.${ext}`;
}

/**
 * The path of an account's statement in the ZIP.
 *
 * @param {import('./statement.js').Statement} statement
 */
export function statementPath(statement) {
	return `Kontoauszuege/${statement.number}_${fileSlug(String(statement.account.name ?? ''))}.pdf`;
}

/**
 * @param {object} params
 * @param {import('./plan.js').MonthPlan} params.plan
 * @param {import('../booking/settings.js').DatevSettings} params.settings
 * @param {Rec[]} params.accounts
 * @param {Record<string, any>} params.classifications
 * @param {{ get: (cid: string) => Promise<Uint8Array> }} params.blobs
 * @param {Date} params.created
 * @returns {Promise<{ zip: Uint8Array, fileName: string, paths: string[], csv: string }>}
 */
export async function buildMonthZip({ plan, settings, accounts, classifications, blobs, created }) {
	if (plan.blocked) throw new Error('Dieser Monat ist noch nicht bereit für den Export.');
	const csv = buchungsstapel({
		settings,
		month: plan.month,
		created,
		lines: plan.lines.map((l) => l.line)
	});
	/** @type {Record<string, Uint8Array>} */
	const files = {
		[`DATEV/EXTF_Buchungsstapel_${plan.month}.csv`]: encodeWindows1252(csv)
	};
	for (const r of plan.receipts) {
		const number = plan.numbers.get(r.id);
		if (!number) continue;
		files[receiptPath(number, r)] = await blobs.get(String(r.fileCid));
	}
	for (const s of plan.statements) {
		files[statementPath(s)] = await statementPdf(s, { created });
	}
	files[`Uebersicht_${plan.month}.csv`] = strToU8(overviewCsv(plan, { accounts, classifications }));
	const zip = zipSync(files, { level: 6, mtime: created });
	return { zip, fileName: `DATEV_${plan.month}.zip`, paths: Object.keys(files), csv };
}

/**
 * Build the ZIP, then keep the new receipt numbers on their receipts and
 * write the event to the Verlauf ("DATEV-Export 2026-09: 5 Buchungen, 3 Belege").
 *
 * @param {object} params
 * @param {{ receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {Parameters<typeof buildMonthZip>[0]['blobs']} params.blobs
 * @param {import('./plan.js').MonthPlan} params.plan
 * @param {import('../booking/settings.js').DatevSettings} params.settings
 * @param {Rec[]} params.accounts
 * @param {Record<string, any>} params.classifications
 * @param {() => Date} [params.now]
 */
export async function runMonthExport({
	store,
	blobs,
	plan,
	settings,
	accounts,
	classifications,
	now = () => new Date()
}) {
	const built = await buildMonthZip({
		plan,
		settings,
		accounts,
		classifications,
		blobs,
		created: now()
	});
	for (const { receiptId, number } of plan.newNumbers) {
		const r = await store.receipts.get(receiptId);
		if (r && !r.exportNumber) await store.receipts.put({ ...r, exportNumber: number });
	}
	await recordEvent(store.events, 'export', {
		month: plan.month,
		bookings: plan.lines.length,
		receipts: plan.receipts.length,
		statements: plan.statements.length,
		skipped: plan.transferSides.length
	});
	return built;
}
