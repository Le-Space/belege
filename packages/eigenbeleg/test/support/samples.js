// SPDX-License-Identifier: AGPL-3.0-or-later
// One of each document this package draws, from made-up data (Wolkenfabrik
// Hosting GmbH, example addresses): for the browser scenario, which compares
// them byte for byte with Node, and for veraPDF in CI (scripts/pdfa-samples.js).
// Runs in Node and in a browser: no node: import.

import { entry } from '@le-space/ledger';

import {
	bookingPdf,
	buildDocument,
	buildStatement,
	eigenbelegCsv,
	eigenbelegPdf,
	fixedRates,
	statementLayout,
	statementPdf,
	valueEntries
} from '../../src/index.js';

export const payer = {
	name: 'Wolkenfabrik Hosting GmbH',
	address: 'Musterstraße 1\n12345 Beispielstadt',
	addresses: ['wolkenfabrik.testnet', 'wolkenfabrik-ops.testnet']
};
const base = {
	chain: 'near',
	network: 'testnet',
	account: 'wolkenfabrik.testnet',
	height: 1,
	contract: 'native',
	asset: 'NEAR',
	priceAs: 'NEAR',
	decimals: 24,
	counterpartyLabel: '',
	method: '',
	memo: '',
	success: true,
	explorerUrl: 'https://testnet.nearblocks.io/txns/X'
};
/** @param {Record<string, any>} over */
const e = (over) => entry({ ...base, hash: over.id, time: '2026-10-05T10:00:00Z', ...over });

export async function nearEntries() {
	return valueEntries(
		[
			e({
				id: 'fee1',
				type: 'fee',
				kind: 'fee',
				amount: '-0.000446365125',
				counterparty: 'near',
				counterpartyLabel: 'NEAR-Netzwerk'
			}),
			e({
				id: 'sto1',
				type: 'sent',
				kind: 'storage',
				amount: '-0.00125',
				counterparty: 'usdc.fakes.testnet'
			}),
			e({
				id: 'pay1',
				type: 'sent',
				kind: 'transfer',
				amount: '-2',
				counterparty: 'stromwerk.testnet'
			}),
			e({
				id: 'in1',
				type: 'received',
				kind: 'transfer',
				amount: '5',
				counterparty: 'stromwerk.testnet'
			})
		],
		fixedRates({ NEAR: '3.8' })
	);
}

const ACCOUNT = `0x${'a1'.repeat(20)}`;
/** A month of made-up Aleph credits: a purchase, storage and an instance, valued at 0.8 EUR per USD. */
export async function alephEntries() {
	const a = {
		chain: 'aleph',
		network: 'mainnet',
		account: ACCOUNT,
		height: 0,
		contract: 'credit',
		asset: 'ALEPH-CREDIT',
		priceAs: '',
		decimals: 0,
		counterpartyLabel: '',
		method: '',
		memo: '',
		success: true,
		explorerUrl: ''
	};
	const unitPrice = { currency: 'USD', amount: '0.000002', source: 'purchase' };
	return valueEntries(
		[
			entry({
				...a,
				id: 'p1',
				hash: `0x${'ab'.repeat(32)}`,
				time: '2026-08-01T00:10:00Z',
				type: 'received',
				kind: 'transfer',
				amount: '1000000',
				counterparty: 'Aleph Cloud',
				unitPrice
			}),
			entry({
				...a,
				id: 'u1',
				hash: 'storage',
				time: '2026-08-01T00:30:00Z',
				type: 'sent',
				kind: 'usage',
				amount: '-200',
				counterparty: 'Aleph Cloud (storage)',
				unitPrice
			}),
			entry({
				...a,
				id: 'u2',
				hash: 'c3'.repeat(32),
				time: '2026-08-02T00:30:00Z',
				type: 'sent',
				kind: 'usage',
				amount: '-2000',
				counterparty: 'Aleph Cloud (wolkenfabrik-web)',
				unitPrice
			})
		],
		fixedRates({ USD: '0.8' })
	);
}

const HASH = `0x${'9f'.repeat(32)}`;
const ME = `0x${'11'.repeat(20)}`;
const ROUTER = `0x${'22'.repeat(20)}`;

/** Belege's Eigenbeleg of one booking: a swap on an own wallet, the gas included; text in other scripts. */
export const walletBooking = /** @type {import('../../src/booking.js').BookingEigenbeleg} */ ({
	number: 'EB-2026-002',
	issuer: 'Wolkenfabrik Hosting GmbH',
	date: '2026-09-26',
	amountCents: -1234,
	account: 'Wallet ETH · Конто Б',
	counterparty: `MetaMask Swap · ${ROUTER}`,
	purpose: '',
	description: 'Tausch: 30.000 XYZ (nicht gelistet) → 0,143 ETH · فندق المثال',
	reason: 'Tausch über eine DEX, keine Rechnung.',
	txRef: HASH,
	crypto: {
		asset: 'ETH',
		quantity: '-143000000000000000',
		decimals: 18,
		rate: '2345.67',
		source: 'CoinGecko',
		at: '2026-09-26T00:00:00Z'
	},
	chain: {
		chain: 'Ethereum',
		hash: HASH,
		explorerUrl: `https://etherscan.io/tx/${HASH}`,
		at: '2026-09-26T09:12:34Z',
		from: { label: 'Wallet ETH', address: ME, own: true },
		to: { label: 'MetaMask Swap (Spender)', address: ROUTER, own: false },
		movements: [
			{ what: 'Tausch – gegeben', quantity: '-0,143 ETH', euro: '-12,34 €', booked: true },
			{ what: 'Gas (Netzwerkgebühr)', quantity: '-0,00018 ETH', euro: '-0,42 €', booked: true },
			{
				what: 'Tausch – erhalten (nicht gebucht)',
				quantity: '30.000 XYZ',
				euro: '',
				booked: false
			}
		]
	},
	createdAt: '2026-09-27T10:00:00.000Z',
	createdBy: 'did:key:z6MkTest'
});

/** A bank booking without a receipt: no chain, no issuer set. */
export const bankBooking = /** @type {import('../../src/booking.js').BookingEigenbeleg} */ ({
	number: 'EB-2026-001',
	issuer: '',
	date: '2026-09-25',
	amountCents: -1234,
	account: 'Konto A',
	counterparty: 'Stromwerk Test AG',
	purpose: 'Barauslage Beispielzweck',
	description: 'Parkgebühr am Automaten',
	reason: 'Der Automat gibt keine Quittung aus.',
	txRef: '',
	crypto: null,
	chain: null,
	createdAt: '2026-09-26T10:00:00.000Z',
	createdBy: ''
});

/** A statement Eigenbeleg over more than one page, as Belege draws Aleph's, Akash's and the travel statement. */
export async function sheet() {
	const { width, head, field, rule, heading, table, signature, save } = await statementLayout({
		title: 'Eigenbeleg EB-2026-003 – Aleph-Verbrauch 2026-08',
		created: new Date('2026-09-01T08:00:00Z'),
		continuation: 'EB-2026-003 · Aleph-Verbrauch 2026-08 (Fortsetzung)'
	});
	head('EB-2026-003', 'Wolkenfabrik Hosting GmbH', 'Verbrauchsnachweis – kein Fremdbeleg.');
	field('Konto', ACCOUNT, 'mono');
	field('Verbrauch', '2.200 Credits · 0,00 EUR', true);
	field('Übernachtungspauschalen', 'Москва · 950,00 AED فندق');
	rule();
	heading('Verbrauch je Tag');
	table(
		[
			{ title: 'Tag (UTC)', width: 70 },
			{ title: 'Ressource', width: width - 70 - 70 - 120 },
			{ title: 'Credits', width: 70, right: true },
			{ title: 'Item-Hash', width: 120, mono: true }
		],
		Array.from({ length: 70 }, (_, i) => [
			`2026-08-${String((i % 31) + 1).padStart(2, '0')}`,
			i % 2 ? 'Speicher (alle Stores)' : 'Instanz wolkenfabrik-web',
			String(100 + i),
			'c3'.repeat(32)
		])
	);
	field('Warum kein Fremdbeleg', 'Aleph stellt keine Rechnung aus.');
	signature();
	return save();
}

/** Every sample, by file name. */
export async function samples() {
	const near = await nearEntries();
	const period = { from: '2026-10-01', to: '2026-10-31' };
	const issuedAt = '2026-11-06T10:00:00.000Z';
	const collective = buildDocument({
		payer,
		chain: 'near',
		network: 'testnet',
		period,
		entries: near,
		number: 'EB-2026-007',
		issuedAt
	});
	const single = buildDocument({
		payer,
		chain: 'near',
		network: 'testnet',
		period,
		entries: near,
		number: 'EB-2026-008',
		issuedAt,
		layout: 'single'
	});
	const kontoauszug = buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'testnet',
		period,
		entries: near,
		opening: { NEAR: '10' },
		closing: { NEAR: '12.998303634875' },
		method: 'archive',
		number: 'KA-2026-10',
		issuedAt
	});
	const verbrauch = buildStatement({
		payer,
		account: ACCOUNT,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries: await alephEntries(),
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '2997800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt
	});
	return {
		/** @type {Record<string, Uint8Array>} */
		pdfs: {
			'eigenbeleg-collective.pdf': await eigenbelegPdf(collective),
			'eigenbeleg-single.pdf': await eigenbelegPdf(single),
			'kontoauszug.pdf': await statementPdf(kontoauszug),
			'verbrauchsauszug.pdf': await statementPdf(verbrauch),
			'booking-wallet.pdf': await bookingPdf(walletBooking),
			'booking-bank.pdf': await bookingPdf(bankBooking),
			'statement-sheet.pdf': await sheet()
		},
		csv: eigenbelegCsv(single)
	};
}
