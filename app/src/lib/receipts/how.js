// How a receipt was read, in words: "Ausgelesen mit deepseek-flash · 1,4 s ·
// 812 Tokens · 7 Stellen geschwärzt", the second attempt and why, the
// redactions by kind. From `extractionInfo` on the record (extract.js). Pure.

import { t } from '../i18n/index.js';

const DECIMAL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat('de-DE');

/** `1400` → `1,4`; `850` → `0,9` */
export function seconds(/** @type {number} */ ms) {
	return DECIMAL.format(Math.max(0, ms) / 1000);
}

/** `12345` → `12.345` */
export function integer(/** @type {number} */ n) {
	return INTEGER.format(n);
}

/**
 * The bridge's reason for a failed attempt, in German.
 *
 * @param {string | null | undefined} reason e.g. `checks failed: net + VAT is not gross`
 */
export function attemptReasonText(reason) {
	const r = String(reason ?? '');
	const exact = /** @type {Record<string, string>} */ ({
		'stopped early: length': 'belege.how.why.stopped early: length',
		'content is not JSON': 'belege.how.why.content is not JSON',
		'answer is not JSON': 'belege.how.why.answer is not JSON'
	});
	if (exact[r]) return t(exact[r]);
	if (r.startsWith('checks failed: ')) {
		return t('belege.how.why.checks', { detail: r.slice('checks failed: '.length) });
	}
	if (r.startsWith('HTTP ')) return t('belege.how.why.http', { detail: r });
	if (r.startsWith('unreachable')) return t('belege.how.why.unreachable');
	return t('belege.how.why.other', { detail: r || '?' });
}

/**
 * @param {Record<string, any>} record a receipts record
 * @returns {{ line: string, fallback: string | null, redactions: string | null, tokens: string | null, attempts: string | null } | null}
 *   null when the receipt was not read
 */
export function extractionHow(record) {
	if (!record?.extraction) return null;
	const info = record.extractionInfo;
	const model = info?.model ?? record.extractionModel ?? '?';
	if (!info || typeof info.ms !== 'number') {
		return {
			line: t('belege.how.lineOld', { model }),
			fallback: null,
			redactions: null,
			tokens: null,
			attempts: null
		};
	}
	const r = info.redactions;
	const tokens =
		typeof info.tokensTotal === 'number'
			? info.tokensTotal
			: (info.usage?.prompt ?? 0) + (info.usage?.completion ?? 0);
	return {
		line: t('belege.how.line', {
			model,
			seconds: seconds(info.ms),
			tokens: integer(tokens),
			redactions: r ? integer(r.total ?? 0) : '?'
		}),
		fallback: info.fallback
			? t('belege.how.fallback', { model, reason: attemptReasonText(info.fallbackReason) })
			: null,
		redactions: r
			? t('belege.how.redactions', {
					terms: r.terms ?? 0,
					iban: r.iban ?? 0,
					email: r.email ?? 0,
					street: r.street ?? 0,
					postcode: r.postcode ?? 0,
					link: r.link ?? 0
				})
			: null,
		tokens: info.usage
			? t('belege.how.tokens', {
					prompt: integer(info.usage.prompt ?? 0),
					completion: integer(info.usage.completion ?? 0),
					reasoning: integer(info.usage.reasoning ?? 0)
				})
			: null,
		attempts: Array.isArray(info.attempts)
			? t('belege.how.attempts', {
					list: info.attempts
						.map(
							(/** @type {any} */ a) =>
								`${a.model} ${a.ok ? '✓' : `✗ (${a.reason})`} ${seconds(a.ms ?? 0)} s`
						)
						.join(' → ')
				})
			: null
	};
}
