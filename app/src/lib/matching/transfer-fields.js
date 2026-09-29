// What the transfer suggestion (bridge POST /transfer/assist, issue #109)
// sends about a booking, and which bookings are worth asking about. Shared
// by "✦ KI-Vorschlag" under "Als Gegenbuchung verknüpfen …"
// (TransactionDetail.svelte) and the AI queue (ai-suggest.svelte.js), which
// asks "own transfer?" before it looks for a receipt.

import { formatMoney } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { formatQuantity } from '../assets/quantity.js';
import { walletChain } from '../wallets/chains.js';
import { transferCandidates } from './view.js';

/**
 * A booking as the transfer suggestion sends it: no address, no IBAN, no
 * hash (the bridge cuts them again and redacts).
 *
 * @param {Record<string, any>} b
 */
export function transferFields(b) {
	const chain = walletChain(b.source);
	const q = typeof b.quantity === 'string' && /^-?\d+$/.test(b.quantity) ? b.quantity : null;
	return {
		direction: /** @type {'in' | 'out'} */ (
			(b.amountCents ?? 0) > 0 || (q && !q.startsWith('-')) ? 'in' : 'out'
		),
		amount: formatMoney(b.amountCents ?? 0, b.currency, DOCUMENT_LOCALE).replace(/\s*EUR$/, ''),
		...(q && b.asset && Number.isInteger(b.decimals)
			? {
					quantity: formatQuantity(q, b.decimals, '', { locale: DOCUMENT_LOCALE }),
					asset: String(b.asset)
				}
			: {}),
		day: String(b.bookedOn ?? ''),
		account: chain ? `Wallet ${chain.name}` : b.source === 'kraken' ? 'Börse Kraken' : 'Bankkonto',
		counterparty: String(b.counterparty ?? '').slice(0, 200),
		purpose: String(b.purpose ?? '').slice(0, 500)
	};
}

/** How far apart two bookings are, 0 = the same amount: by quantity for one asset, else in euros. */
function gap(/** @type {Record<string, any>} */ tx, /** @type {Record<string, any>} */ o) {
	const abs = (/** @type {bigint} */ n) => (n < 0n ? -n : n);
	if (tx.asset && o.asset === tx.asset && /^-?\d+$/.test(String(tx.quantity ?? ''))) {
		const a = abs(BigInt(tx.quantity));
		const b = /^-?\d+$/.test(String(o.quantity ?? '')) ? abs(BigInt(o.quantity)) : 0n;
		return a ? Number(((a > b ? a - b : b - a) * 10000n) / a) / 10000 : 1;
	}
	const a = Math.abs(Number(tx.amountCents ?? 0));
	const b = Math.abs(Number(o.amountCents ?? 0));
	return a ? Math.abs(a - b) / a : 1;
}

/** Candidates further apart than this are not worth a request in a run. */
export const QUEUE_MAX_GAP = 0.15;

/**
 * The other sides a run asks the model about: the "Als Gegenbuchung
 * verknüpfen …" list, but only those within 15 % – fees and a bridge's cut –
 * so a question with nothing close costs no request.
 *
 * @param {Record<string, any>} tx
 * @param {Record<string, any>[]} transactions
 */
export const queueTransferCandidates = (tx, transactions) =>
	transferCandidates(tx, transactions).filter((o) => gap(tx, o) <= QUEUE_MAX_GAP);
