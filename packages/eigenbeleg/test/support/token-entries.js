// SPDX-License-Identifier: AGPL-3.0-or-later
// Entries of an Ethereum wallet with a token not in the list (#93), for the
// valuation tests in Node and in Chromium. Made-up addresses and amounts.
import { entry } from '@le-space/ledger';

export const WALLET = `0x${'a1'.repeat(20)}`;
export const XYZ = `0x${'5e'.repeat(20)}`;

/** @param {Partial<import('@le-space/ledger').LedgerEntry>} f */
const e = (f) =>
	entry({
		id: `ethereum:${WALLET}:${f.id}`,
		chain: 'ethereum',
		network: 'mainnet',
		account: WALLET,
		hash: `0x${String(f.id).repeat(32).slice(0, 64)}`,
		height: 1000,
		time: '2026-10-05T12:00:00Z',
		type: 'sent',
		kind: 'transfer',
		asset: 'ETH',
		contract: 'native',
		decimals: 18,
		amount: '-1',
		counterparty: `0x${'c3'.repeat(20)}`,
		counterpartyLabel: '',
		method: '',
		memo: '',
		success: true,
		explorerUrl: '',
		priceAs: 'ETH',
		...f
	});

/** ETH sent, an unlisted token sent and received, a failed token send, and a token without a contract. */
export function tokenEntries() {
	return [
		e({ id: '01', amount: '-0.5' }),
		e({
			id: '02',
			asset: 'XYZ',
			contract: XYZ,
			listed: false,
			priceAs: '',
			amount: '-100',
			height: 1200
		}),
		e({
			id: '03',
			type: 'received',
			asset: 'XYZ',
			contract: XYZ,
			listed: false,
			priceAs: '',
			amount: '40',
			time: '2026-10-06T08:00:00Z'
		}),
		e({
			id: '04',
			asset: 'XYZ',
			contract: XYZ,
			listed: false,
			priceAs: '',
			amount: '-1',
			success: false
		}),
		// A Cosmos denom outside the list: no contract, so never asked by one.
		e({
			id: '05',
			chain: 'akash',
			asset: 'IBC-XY',
			contract: 'ibc/AB12',
			listed: false,
			priceAs: ''
		})
	];
}
