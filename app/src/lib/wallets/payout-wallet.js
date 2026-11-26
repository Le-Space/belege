// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether a Bitcoin receipt came from a payout wallet (issue #1037): an
// exchange's or a payment service's hot wallet that pays many people from
// one address, in batches, and keeps its change on that address. One answer
// for such an address ("a customer paid") would label every later payout from
// it the same way – the person's own withdrawals from that exchange too – so
// what a person says about such a receipt is kept for that booking only.
//
// The signals come from the transaction's shape the reader stores (`utxo`,
// packages/chains/src/bitcoin.js):
//   busy        the sender has a thousand transactions or more
//   reused      the sender has been used before: ten or more transactions,
//               or another booking of ours with it
//   batch       five outputs or more
//   changeBack  an output goes back to an address the inputs came from
// A payout wallet: busy, or a batch with the change back or a reused sender.

/** The sender's transaction count from which it is busy. */
export const BUSY_TXS = 1000;
/** …from which it counts as reused. */
export const REUSED_TXS = 10;
/** Outputs from which a transaction is a batch. */
export const BATCH_OUTPUTS = 5;

/**
 * @typedef {object} UtxoSide
 * @property {string} address
 * @property {string} sats
 * @property {boolean} own
 * @property {number} [count]
 */

/**
 * @typedef {object} Utxo the reader's `utxo` (packages/ledger/src/wallet-entry.js)
 * @property {UtxoSide[]} inputs
 * @property {UtxoSide[]} outputs
 * @property {number} inputCount
 * @property {number} outputCount
 * @property {{ count: number, sats: string }} [moreInputs]
 * @property {{ count: number, sats: string }} [moreOutputs]
 * @property {string} fee
 * @property {number} height
 * @property {number} [senderTxs]
 */

/** @param {unknown} u @returns {u is Utxo} */
export function isUtxo(u) {
	const x = /** @type {any} */ (u);
	return Boolean(
		x &&
			Array.isArray(x.inputs) &&
			Array.isArray(x.outputs) &&
			Number.isInteger(x.inputCount) &&
			Number.isInteger(x.outputCount)
	);
}

/**
 * A booking's outputs and inputs, each marked by what it is to us:
 *   ours        to one of our addresses (for a receipt: what we got)
 *   ourChange   back to one of ours when we sent (the change)
 *   change      back to the sender (an address the inputs came from)
 *   other       anyone else
 *
 * @param {Record<string, any>} tx
 * @returns {{ inputs: (UtxoSide & { role: 'ours' | 'other' })[], outputs: (UtxoSide & { role: 'ours' | 'ourChange' | 'change' | 'other' })[], weSent: boolean, utxo: Utxo } | null}
 */
export function utxoFlow(tx) {
	const utxo = tx?.utxo;
	if (!isUtxo(utxo)) return null;
	const weSent = utxo.inputs.some((i) => i.own);
	const senders = new Set(utxo.inputs.filter((i) => !i.own && i.address).map((i) => i.address));
	return {
		utxo,
		weSent,
		inputs: utxo.inputs.map((i) => ({ ...i, role: i.own ? 'ours' : 'other' })),
		outputs: utxo.outputs.map((o) => ({
			...o,
			role: o.own
				? weSent
					? 'ourChange'
					: 'ours'
				: o.address && senders.has(o.address)
					? 'change'
					: 'other'
		}))
	};
}

/**
 * The own address of a booking: where a receipt arrived, or the first of ours
 * a payment was paid from; '' without the transaction's shape.
 *
 * @param {Record<string, any>} tx
 */
export function ownAddressOf(tx) {
	const flow = utxoFlow(tx);
	if (!flow) return '';
	const side = flow.weSent
		? flow.inputs.find((i) => i.own)
		: flow.outputs.find((o) => o.role === 'ours');
	return side?.address ?? '';
}

/**
 * Why a receipt looks like it came from a payout wallet; null for anything
 * that is no receipt from someone else, or has no transaction shape.
 *
 * @param {Record<string, any>} tx
 * @param {{ others?: number }} [seen] other bookings of ours with the same sender
 * @returns {{ payout: boolean, sender: string, busy: boolean, reused: boolean, batch: boolean, changeBack: boolean, senderTxs: number, outputs: number } | null}
 */
export function payoutSignals(tx, { others = 0 } = {}) {
	const flow = utxoFlow(tx);
	if (!flow || flow.weSent) return null;
	if (!flow.outputs.some((o) => o.role === 'ours')) return null;
	const sender = flow.inputs.find((i) => i.address)?.address ?? '';
	const senderTxs = Number(flow.utxo.senderTxs ?? 0) || 0;
	const busy = senderTxs >= BUSY_TXS;
	const reused = senderTxs >= REUSED_TXS || others > 0;
	const batch = flow.utxo.outputCount >= BATCH_OUTPUTS;
	const changeBack = flow.outputs.some((o) => o.role === 'change');
	return {
		payout: busy || (batch && (changeBack || reused)),
		sender,
		busy,
		reused,
		batch,
		changeBack,
		senderTxs,
		outputs: flow.utxo.outputCount
	};
}

/**
 * Confirmations of a booking at the chain's height of the last sync; null
 * when either is not known.
 *
 * @param {Record<string, any>} tx
 * @param {number | undefined | null} tipHeight
 */
export function confirmationsOf(tx, tipHeight) {
	const height = Number(tx?.utxo?.height ?? 0);
	const tip = Number(tipHeight ?? 0);
	if (!Number.isInteger(height) || height <= 0 || !Number.isInteger(tip) || tip < height) {
		return null;
	}
	return tip - height + 1;
}
