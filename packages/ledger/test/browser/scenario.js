// SPDX-License-Identifier: AGPL-3.0-or-later
// The ledger in a browser: bytes, decimals and entries as in Node
// (browser.test.js compares the two). Made-up values only.
import {
	entry,
	fromBase64,
	fromHex,
	fromUtf8,
	fromWalletEntry,
	multiply,
	sortEntries,
	sum,
	toBase64,
	toHex,
	toUnits,
	utf8
} from '../../src/index.js';

export default async function scenario() {
	const text = 'Wolkenfabrik Hosting GmbH – Überweisung €';
	const big = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
	const w = {
		id: 'H1:m0:e0.0:FIL',
		hash: 'H1',
		height: 7,
		time: '2026-10-05T08:00:00Z',
		date: '2026-10-05',
		type: /** @type {const} */ ('sent'),
		kind: /** @type {const} */ ('transfer'),
		asset: 'FIL',
		amount: '-0.125',
		decimals: 18,
		counterparty: 'f1example',
		counterpartyLabel: '',
		memo: '',
		success: true,
		explorerUrl: 'https://example.com/H1'
	};
	const fee = entry({
		...fromWalletEntry(w, { chain: 'filecoin', account: 'f1own', priceAs: 'FIL' }),
		id: 'filecoin:f1own:H1:fee',
		type: 'fee',
		kind: 'fee',
		amount: '-0.0001'
	});
	return {
		b64: toBase64(utf8(text)),
		back: fromUtf8(fromBase64(toBase64(utf8(text)))),
		lenient: Array.from(fromBase64('YW Jj\n')),
		hex: toHex(fromHex('00ffA0')),
		bigLength: toBase64(big).length,
		units: String(toUnits('-0.000000000000000000000001', 24)),
		sum: sum(['0.1', '0.2', '-0.05']),
		eur: multiply('-0.125', '3.8796'),
		order: sortEntries([fee, fromWalletEntry(w, { chain: 'filecoin', account: 'f1own' })]).map(
			(e) => e.id
		)
	};
}
