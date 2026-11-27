// The month's ZIP, made in the browser: the Buchungsstapel in Windows-1252,
// the receipts' files (opened from the sealed blob store), and the overview.
// Nothing leaves the browser; the page hands the bytes to a download.
// Loaded lazily by the export page, with fflate.
//
//   HINWEIS.txt / NOTICE.txt                         the notice confirmed before the download (#1053)
//   DATEV/EXTF_Buchungsstapel_<YYYY-MM>.csv
//   Belege/<receipt number>_<vendor>.pdf            a mail without an attachment: a PDF of its text
//   Kontoauszuege/<statement number>_<account>.pdf   one per account (statement.js)
//   Aktennotizen/<date>_<counterparty>_<id>.txt       a private payment's note (#172)
//   Uebersicht_<YYYY-MM>.csv

/* eslint-disable belege/no-german -- the monthly export for German bookkeeping stays German (#192) */

import { zipSync, strToU8 } from 'fflate';

import { recordEvent } from '../activity/events.js';
import { receiptVendor } from '../receipts/view.js';
import { emlText } from '../receipts/eml.js';

/** The mail's text, or null when it cannot be read. @param {Uint8Array} eml */
function safeEmlText(eml) {
	try {
		return emlText(eml);
	} catch {
		return null;
	}
}
import { encodeWindows1252 } from './cp1252.js';
import { buchungsstapel } from './datev.js';
import { overviewCsv } from './overview.js';
import { statementPdf } from './statement-pdf.js';
import { mailReceiptPdf } from './mail-pdf.js';
import { isMailText } from './plan.js';
import { t } from '../i18n/index.js';
import { REPORT_ADDRESS } from './report.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} ExportNotice
 * @property {string} [acknowledgedAt] ISO, when the person confirmed it
 * @property {string} [version] the text's version (acknowledgments.js)
 * @property {string} [app] the app's release
 */

/**
 * The notice the person confirmed, as a file for the ZIP (#1053): the text,
 * the month, when it was made, with which app, and when it was confirmed –
 * the copy of the confirmation that travels with the export. In the app's
 * language; nothing of the books in it.
 *
 * @param {{ month: string, created: Date, notice?: ExportNotice }} p
 * @returns {{ name: string, text: string }}
 */
export function exportNotice({ month, created, notice = {} }) {
	const unknown = t('export.noticeFile.unknown');
	const rows = [
		[t('export.noticeFile.month'), month],
		[t('export.noticeFile.exported'), created.toISOString()],
		[t('export.noticeFile.app'), notice.app || unknown],
		[t('export.noticeFile.acknowledged'), notice.acknowledgedAt || unknown],
		[t('export.noticeFile.version'), notice.version || unknown]
	];
	const width = Math.max(...rows.map(([k]) => k.length)) + 2;
	return {
		name: t('export.noticeFile.name'),
		text: [
			t('export.noticeFile.heading'),
			'',
			t('export.notice.title'),
			t('export.notice.text', { mail: REPORT_ADDRESS }),
			'',
			...rows.map(([k, v]) => `${`${k}:`.padEnd(width)}${v}`),
			''
		].join('\n')
	};
}

const EXTENSION = /** @type {Record<string, string>} */ ({
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	// An e-invoice's original (#160).
	'application/xml': 'xml'
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
 * @param {ExportNotice} [params.notice] the confirmation before the download
 * @returns {Promise<{ zip: Uint8Array, fileName: string, paths: string[], csv: string }>}
 */
export async function buildMonthZip({
	plan,
	settings,
	accounts,
	classifications,
	blobs,
	created,
	notice
}) {
	if (plan.blocked) throw new Error(t('messages.export.notReady'));
	const csv = buchungsstapel({
		settings,
		month: plan.month,
		created,
		lines: plan.lines.map((l) => l.line)
	});
	const readMe = exportNotice({ month: plan.month, created, notice });
	/** @type {Record<string, Uint8Array>} */
	const files = {
		[readMe.name]: strToU8(readMe.text),
		[`DATEV/EXTF_Buchungsstapel_${plan.month}.csv`]: encodeWindows1252(csv)
	};
	for (const r of plan.receipts) {
		const number = plan.numbers.get(r.id);
		if (!number) continue;
		if (isMailText(r)) {
			// The mail as received beside the PDF made from it (#288), its full text in the PDF.
			const eml = r.emlCid ? await blobs.get(String(r.emlCid)) : null;
			files[receiptPath(number, r)] = await mailReceiptPdf(r, {
				number,
				created,
				// A mail that cannot be read as text keeps the month's export going.
				text: eml ? safeEmlText(eml) : null
			});
			if (eml) files[receiptPath(number, r).replace(/\.pdf$/, '.eml')] = eml;
		} else {
			files[receiptPath(number, r)] = await blobs.get(String(r.fileCid));
			// A ZUGFeRD / Factur-X invoice: its XML, the e-invoice's original, beside the PDF (#160).
			if (r.xmlCid) {
				files[receiptPath(number, r).replace(/\.[a-z]+$/, '.xml')] = await blobs.get(
					String(r.xmlCid)
				);
			}
		}
	}
	for (const s of plan.statements) {
		files[statementPath(s)] = await statementPdf(s, { created });
	}
	// A private payment from the business account has no receipt: its note is its document.
	for (const l of plan.lines) {
		const note = l.tx?.privateMistake?.note;
		if (!note) continue;
		const name = `${l.tx.bookedOn}_${fileSlug(String(l.tx.counterparty || 'privat'))}_${String(l.tx.id).slice(-6)}`;
		files[`Aktennotizen/${name}.txt`] = strToU8(`Privat (Irrläufer)\n\n${note}\n`);
	}
	files[`Uebersicht_${plan.month}.csv`] = strToU8(overviewCsv(plan, { accounts, classifications }));
	const zip = zipSync(files, { level: 6, mtime: created });
	// A package of sample bookings says so in its name: it is no bookkeeping.
	// With test bookings in it, it says TEST_ – for trying the export, not for the books.
	const prefix = plan.testsIncluded ? 'TEST_' : plan.sample === 'all' ? 'BEISPIEL_' : '';
	return { zip, fileName: `${prefix}DATEV_${plan.month}.zip`, paths: Object.keys(files), csv };
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
 * @param {ExportNotice} [params.notice]
 * @param {() => Date} [params.now]
 */
export async function runMonthExport({
	store,
	blobs,
	plan,
	settings,
	accounts,
	classifications,
	notice,
	now = () => new Date()
}) {
	const built = await buildMonthZip({
		plan,
		settings,
		accounts,
		classifications,
		blobs,
		created: now(),
		notice
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
		skipped: plan.transferSides.length,
		...(plan.checks.suspense.length ? { suspense: plan.checks.suspense.length } : {})
	});
	return built;
}
