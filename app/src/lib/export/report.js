// "Fehler melden" on the export page (#1053): a mail to Le Space, opened in
// the person's own mail program. Filled in are only the month, the app's
// release and how many bookings and receipts each check counted – never an
// amount, a name, a purpose or a file. What else goes in, the person writes.
import { t } from '../i18n/index.js';

/** Where errors in an export are reported. */
export const REPORT_ADDRESS = 'belege@le-space.de';

/**
 * @param {object} p
 * @param {string} p.month YYYY-MM
 * @param {string} [p.app] the app's release; '' when unknown
 * @param {Pick<import('./plan.js').MonthPlan, 'lines' | 'checks'>} p.plan
 * @returns {{ subject: string, body: string }}
 */
export function reportMail({ month, app, plan }) {
	const n = (/** @type {unknown[] | undefined} */ list) => String(list?.length ?? 0);
	const c = plan.checks;
	return {
		subject: t('export.report.subject', { month }),
		body: t('export.report.body', {
			month,
			app: app || t('export.noticeFile.unknown'),
			bookings: n(plan.lines),
			unassigned: n(c.unassigned),
			unpriced: n(c.unpriced),
			missingReceipt: n(c.missingReceipt),
			unlinked: n(c.unlinkedReceipts),
			unverified: n(c.unverified),
			suspense: n(c.suspense)
		})
	};
}

/**
 * The same as a mailto: link.
 *
 * @param {Parameters<typeof reportMail>[0]} p
 */
export function reportMailto(p) {
	const { subject, body } = reportMail(p);
	return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
