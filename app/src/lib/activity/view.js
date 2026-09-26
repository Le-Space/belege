// What the Verlauf page says about an event: a title, a line of facts, and
// the receipt and booking it links to. Names are looked up by id at render
// time (the event itself keeps ids and numbers only). Pure.

import { formatDate } from '../bank/format.js';
import { t } from '../i18n/index.js';
import { receiptVendor } from '../receipts/view.js';
import { attemptReasonText, integer, seconds } from '../receipts/how.js';

/** @typedef {{ id: string } & Record<string, any>} Rec */

/**
 * @param {Record<string, any>} e an events record
 * @param {{ receipts?: Rec[], transactions?: Rec[] }} [books]
 * @returns {{ title: string, text: string, receiptId: string | null, transactionId: string | null, failed: boolean }}
 */
export function describeEvent(e, { receipts = [], transactions = [] } = {}) {
	const receipt = e.receiptId ? receipts.find((r) => r.id === e.receiptId) : null;
	const tx = e.transactionId ? transactions.find((x) => x.id === e.transactionId) : null;
	const vendor = receipt ? receiptVendor(receipt) : '—';
	const base = {
		receiptId: receipt ? receipt.id : null,
		transactionId: tx ? tx.id : null,
		failed: false
	};
	/** @param {string} v */
	const verdict = (v) => t(`verlauf.verdict.${v}`);

	switch (e.kind) {
		case 'bank-sync':
			return {
				...base,
				title: t('verlauf.kind.bank-sync'),
				text: t('verlauf.text.bankSync', {
					source: t(
						`verlauf.source.${e.source === 'camt' || e.source === 'kraken' ? e.source : 'hibiscus'}`
					),
					accounts: e.accounts ?? 0,
					new: e.new ?? 0,
					updated: e.updated ?? 0,
					skipped: e.skipped ?? 0
				})
			};
		case 'mail-fetch':
			return {
				...base,
				title: t('verlauf.kind.mail-fetch'),
				text:
					t('verlauf.text.mailFetch', {
						from: e.since ? formatDate(e.since) : '?',
						to: e.until ? formatDate(e.until) : t('verlauf.text.today'),
						mails: e.mails ?? 0,
						new: e.new ?? 0,
						skipped: e.skipped ?? 0,
						duplicate: e.duplicate ?? 0
					}) + (e.verdicts ? t('belege.mailVerdicts', { count: e.verdicts }) : '')
			};
		case 'file-import':
			return {
				...base,
				title: t(`verlauf.kind.file-import-${e.source === 'folder' ? 'folder' : 'upload'}`),
				text: t('verlauf.text.fileImport', {
					new: e.new ?? 0,
					duplicate: e.duplicate ?? 0,
					unsupported: e.unsupported ?? 0
				})
			};
		case 'sender-verdict':
			return {
				...base,
				title: t('verlauf.kind.sender-verdict'),
				text:
					t('verlauf.text.senderVerdict', {
						vendor,
						was: verdict(e.was ?? 'none'),
						now: verdict(e.now ?? 'none')
					}) + (e.released ? t('verlauf.text.senderReleased') : '')
			};
		case 'extract':
			if (e.ok === false) {
				return {
					...base,
					failed: true,
					title: t('verlauf.kind.extractFailed'),
					text: t('verlauf.text.extractFailed', { vendor, error: e.error ?? '?' })
				};
			}
			return {
				...base,
				title: t('verlauf.kind.extract'),
				text:
					t('verlauf.text.extract', {
						vendor,
						model: e.model ?? '?',
						seconds: typeof e.ms === 'number' ? seconds(e.ms) : '?',
						tokens: integer(
							typeof e.tokensTotal === 'number'
								? e.tokensTotal
								: (e.tokens?.prompt ?? 0) + (e.tokens?.completion ?? 0)
						),
						redactions: integer(e.redactions?.total ?? 0)
					}) +
					(e.fallback
						? t('verlauf.text.extractFallback', { reason: attemptReasonText(e.fallbackReason) })
						: '')
			};
		case 'mail-assist':
			return {
				...base,
				title: t('verlauf.kind.mail-assist'),
				text:
					t('verlauf.text.mailAssist', {
						model: e.model ?? '?',
						terms: e.terms ?? 0,
						domains: e.domains ?? 0,
						mails: e.mails ?? 0,
						seconds: typeof e.ms === 'number' ? seconds(e.ms) : '?',
						tokens: integer(e.tokensTotal ?? 0)
					}) +
					(e.pick
						? t('verlauf.text.mailAssistPick', {
								confidence: t(`zahlungen.detail.aiConfidence.${e.pick}`)
							})
						: '')
			};
		case 'match-assist':
			return {
				...base,
				title: t('verlauf.kind.match-assist'),
				text:
					t('verlauf.text.matchAssist', {
						model: e.model ?? '?',
						candidates: e.candidates ?? 0,
						seconds: typeof e.ms === 'number' ? seconds(e.ms) : '?',
						tokens: integer(e.tokensTotal ?? 0)
					}) +
					(e.pick
						? t('verlauf.text.mailAssistPick', {
								confidence: t(`zahlungen.detail.aiConfidence.${e.pick}`)
							})
						: '')
			};
		case 'matching': {
			const pairs = Array.isArray(e.pairs) ? e.pairs : [];
			const named = pairs.flatMap((/** @type {Rec} */ p) => {
				const r = receipts.find((x) => x.id === p.receiptId);
				return r ? [receiptVendor(r)] : [];
			});
			return {
				...base,
				// One pair: link it directly.
				receiptId: pairs.length === 1 ? (pairs[0].receiptId ?? null) : null,
				transactionId: pairs.length === 1 ? (pairs[0].transactionId ?? null) : null,
				title: `${t('verlauf.kind.matching')} (${t(
					e.trigger === 'manual' ? 'verlauf.text.matchingManual' : 'verlauf.text.matchingAuto'
				)})`,
				text:
					t('verlauf.text.matching', {
						sure: e.sure ?? 0,
						created: e.created ?? 0,
						resolved: e.resolved ?? 0,
						classified: e.classified ?? 0,
						waiting: e.waiting ?? 0
					}) + (named.length ? ` · ${t('verlauf.text.pairs', { list: named.join(', ') })}` : '')
			};
		}
		case 'decision': {
			const title =
				e.action === 'answer'
					? t('verlauf.decision.answer', { choice: t(`rueckfragen.answer.${e.choice}`) })
					: t(`verlauf.decision.${e.action}`);
			const parts = [
				receipt ? vendor : null,
				tx ? `${tx.counterparty || '—'} · ${formatDate(tx.bookedOn)}` : null,
				typeof e.score === 'number' ? t('explain.points', { score: e.score }) : null
			].filter(Boolean);
			return { ...base, title, text: parts.join(' · ') };
		}
		case 'export':
			return {
				...base,
				title: t('verlauf.kind.export'),
				text: t('verlauf.text.export', {
					month: String(e.month ?? '?'),
					bookings: e.bookings ?? 0,
					receipts: e.receipts ?? 0
				})
			};
		default:
			return { ...base, title: String(e.kind), text: '' };
	}
}
