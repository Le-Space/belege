// Dust and lookalike addresses on own wallets. Pure.
//
// Address poisoning: someone sends a tiny amount from an address made to
// start and end like one the person really uses, so that it stands next to
// the real one in the history and gets copied as the next recipient.

import { walletChain } from '../wallets/chains.js';

/** Characters compared at each end of an address for a lookalike. */
export const LOOKALIKE_CHARS = 4;

/**
 * The part of an address a person reads: after `0x`, or after a bech32
 * prefix (`nym1…`), in lower case.
 *
 * @param {unknown} address
 */
export function addressBody(address) {
	const a = String(address ?? '')
		.trim()
		.toLowerCase();
	if (a.startsWith('0x')) return a.slice(2);
	const sep = a.lastIndexOf('1');
	return sep > 0 ? a.slice(sep + 1) : a;
}

/**
 * Whether two addresses are different but look alike where people look:
 * the same first and last LOOKALIKE_CHARS characters. What address
 * poisoning makes, so that a copy from the history goes to the wrong one.
 * Two unrelated addresses share them about once in four billion.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function looksAlike(a, b) {
	const x = addressBody(a);
	const y = addressBody(b);
	const n = LOOKALIKE_CHARS;
	return (
		x !== y &&
		x.length === y.length &&
		x.length > 2 * n &&
		x.slice(0, n) === y.slice(0, n) &&
		x.slice(-n) === y.slice(-n)
	);
}

/**
 * An own wallet's incoming transfer worth less than a cent: dust, sent to be
 * seen in the history (a test, spam, or a lookalike address waiting to be
 * copied). Needs no receipt.
 *
 * @param {Record<string, any>} tx
 */
export function isDust(tx) {
	return (
		walletChain(tx.source) !== null &&
		tx.movement === 'transfer' &&
		Number(tx.amountCents) === 0 &&
		typeof tx.quantity === 'string' &&
		/^\d+$/.test(tx.quantity) &&
		BigInt(tx.quantity) > 0n
	);
}
