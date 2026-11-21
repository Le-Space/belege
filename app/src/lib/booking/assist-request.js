// What "✦ Konto vorschlagen" sends the bridge for one payment (POST
// /booking/assist, bridge command `llm.booking`), and what the Verlauf keeps
// of the answer. One place for the payment's own block and for the list of
// payments without an account (Zahlungen), so both ask the same question.
//
// Pure: the bridge blacks out what must not leave (IBANs, the redaction
// terms) before anything goes to a model; nothing here is the redaction.
import { formatMoney } from '../bank/format.js';
import { eventCalls } from '../stats/usage.js';
import { accountsForAssist, learnedForAssist } from './assist-input.js';

/** @typedef {Record<string, any>} Rec */

/** @param {number} cents */
const plainMoney = (cents) => formatMoney(Math.abs(cents), 'EUR').replace(/\s*EUR$/, '');

/**
 * The request for one payment.
 *
 * @param {object} p
 * @param {Rec} p.tx
 * @param {Rec | null} p.receipt the first linked receipt
 * @param {Rec | null | undefined} p.own the payment's own account
 * @param {Rec[]} p.partners the books' partners with their learned accounts
 * @param {{ number: string, name: string }[]} p.catalogue the accounts the "Konto" field offers
 * @param {import('./chart.js').StoredChart | null | undefined} p.chart
 * @param {(vendors: string) => string} p.learnedName the name of a learned account outside the catalogue
 */
export function assistBody({ tx, receipt, own, partners, catalogue, chart, learnedName }) {
	const ex = /** @type {Rec} */ (receipt?.extraction ?? {});
	const learned = learnedForAssist(partners, [
		tx.counterparty,
		tx.purpose,
		receipt?.vendor ?? ex.vendor
	]);
	return {
		booking: {
			direction: (tx.amountCents ?? 0) > 0 ? 'in' : 'out',
			amount: plainMoney(tx.amountCents ?? 0),
			day: String(tx.bookedOn ?? '').slice(0, 10),
			account: own ? String(own.name ?? '').slice(0, 200) : null,
			counterparty: String(tx.counterparty ?? '').slice(0, 200),
			purpose: String(tx.purpose ?? '').slice(0, 1000)
		},
		receipt: receipt
			? {
					vendor: String(receipt.vendor ?? ex.vendor ?? '').slice(0, 200) || null,
					kind: typeof ex.document_type === 'string' ? ex.document_type.slice(0, 60) : null,
					vat:
						(Array.isArray(ex.vat) ? ex.vat : [])
							.map((/** @type {any} */ v) => v?.rate)
							.filter((/** @type {unknown} */ x) => typeof x === 'number')
							.map((/** @type {number} */ x) => `${x} %`)
							.join(', ')
							.slice(0, 60) || null,
					items: (Array.isArray(ex.line_items) ? ex.line_items : [])
						.map((/** @type {any} */ i) => String(i?.description ?? '').slice(0, 200))
						.filter(Boolean)
						.slice(0, 20)
				}
			: null,
		learned,
		accounts: accountsForAssist(catalogue, learned, chart, learnedName)
	};
}

/**
 * The Verlauf's `booking-assist` entry for an answer.
 *
 * @param {string} transactionId
 * @param {Rec} r the bridge's answer
 */
export function assistEventData(transactionId, r) {
	const calls = /** @type {Rec[]} */ (r?.llm?.calls ?? []);
	return {
		transactionId,
		picks: (r?.picks ?? []).length,
		model: calls.at(-1)?.model ?? null,
		calls: eventCalls(calls),
		ms: calls.reduce((n, c) => n + (c.ms ?? 0), 0),
		tokensTotal: calls.reduce((n, c) => n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0), 0)
	};
}
