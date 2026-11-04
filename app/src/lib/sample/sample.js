// Sample books (issue #200, step 3): made-up accounts, payments and receipts
// to try Belege with – a bank account and a second one, an exchange and a
// wallet; a receipt that matches its payment, payments still waiting for one,
// an own transfer, a bank fee, a charge with its refund, and a receipt no
// payment asks for.
//
// Nothing here is real: the names, numbers, IBAN endings, the address and the
// hashes are invented. Every record carries `sample: true`, which is how the
// banner knows, how "remove" finds them, and how the export refuses to mix them
// with real bookings. Dates are relative to today, in the month before, so a
// month's export can be tried at once.
//
// Removing is a soft delete, like every deletion in these books: the records
// leave every list, and stay in the append-only log.

/* eslint-disable belege/no-german -- made-up sample data, stored in the books like real records */

import { importTransactions, upsertAccount } from '../bank/import.js';
import { valuedFields } from '../assets/valuation.js';
import { toUnits } from '../assets/quantity.js';
import { isActive } from '../matching/engine.js';

/** @typedef {Record<string, any>} Rec */

/** @param {Rec | null | undefined} r */
export const isSample = (r) => r?.sample === true;

/**
 * Whether the books hold sample data.
 *
 * @param {{ transactions: Rec[], receipts: Rec[], accounts: Rec[] }} books
 */
export const hasSample = (books) =>
	books.transactions.some((t) => !t.deleted && isSample(t)) ||
	books.receipts.some((r) => !r.deleted && isSample(r)) ||
	books.accounts.some((a) => !a.deleted && isSample(a));

/** The made-up wallet address and hashes: recognisably no real ones. */
const WALLET = `0x${'5a'.repeat(20)}`;
const VENDOR_WALLET = `0x${'b0'.repeat(20)}`;
const hash = (/** @type {string} */ byte) => `0x${byte.repeat(32)}`;
/** Euros per ETH, made up and round. */
const RATE = '2500.00';

/**
 * What the sample books say, in the app's language: a person trying Belege in
 * English sees English names and purposes. Booking types (`Abschluss`,
 * `Basislastschrift`) stay: they are a German bank's codes, and the bank fee is
 * recognised by them.
 */
const WORDS = {
	de: {
		bank: 'Beispielkonto',
		savings: 'Beispiel-Tagesgeld',
		krakenAccount: 'Kraken ETH (Beispiel)',
		walletAccount: 'Wallet Ethereum ETH (Beispiel)',
		customer: 'Kundin Beispiel AG',
		invoice2026: 'Rechnung 2026-001',
		re1001: 'RE-1001 Kundennummer 4711',
		office: 'Büromaterial Muster GmbH',
		order778899: 'Bestellung 778899',
		own: 'Beispiel GmbH',
		toSavings: 'Umbuchung Tagesgeld',
		tools: 'Werkzeugladen Test',
		order5566: 'Bestellung 5566',
		refund5566: 'Rückerstattung Bestellung 5566',
		accountFee: 'Kontoführung',
		withdrawal: 'Auszahlung',
		node: 'Nodebetrieb Beispiel',
		networkFee: 'Netzwerkgebühr',
		hostingM: 'Hosting Paket M',
		fileHosting: 'beispiel-wolkenfabrik-RE-1001.pdf',
		filePower: 'beispiel-stromwerk-2026-77.pdf',
		electricity: 'Abschlag Strom Büro',
		excerptHosting:
			'BEISPIEL – Wolkenfabrik Hosting GmbH · Rechnung RE-1001 · Kundennummer 4711 · Hosting Paket M · netto 100,00 EUR · USt 19 % 19,00 EUR · brutto 119,00 EUR · wird per Lastschrift eingezogen',
		excerptPower:
			'BEISPIEL – Stromwerk Test AG · Rechnung 2026-77 · Abschlag Büro · netto 37,82 EUR · USt 19 % 7,18 EUR · brutto 45,00 EUR · zahlbar per Überweisung'
	},
	en: {
		bank: 'Sample account',
		savings: 'Sample savings',
		krakenAccount: 'Kraken ETH (sample)',
		walletAccount: 'Wallet Ethereum ETH (sample)',
		customer: 'Sample Customer Ltd',
		invoice2026: 'Invoice 2026-001',
		re1001: 'RE-1001 customer no. 4711',
		office: 'Sample Office Supplies Ltd',
		order778899: 'Order 778899',
		own: 'Sample Ltd',
		toSavings: 'Transfer to savings',
		tools: 'Test Tool Shop',
		order5566: 'Order 5566',
		refund5566: 'Refund order 5566',
		accountFee: 'Account fee',
		withdrawal: 'Withdrawal',
		node: 'Sample Node Operations',
		networkFee: 'Network fee',
		hostingM: 'Hosting package M',
		fileHosting: 'sample-wolkenfabrik-RE-1001.pdf',
		filePower: 'sample-stromwerk-2026-77.pdf',
		electricity: 'Electricity instalment, office',
		excerptHosting:
			'SAMPLE – Wolkenfabrik Hosting GmbH · Invoice RE-1001 · Customer no. 4711 · Hosting package M · net 100.00 EUR · VAT 19 % 19.00 EUR · gross 119.00 EUR · collected by direct debit',
		excerptPower:
			'SAMPLE – Stromwerk Test AG · Invoice 2026-77 · Instalment office · net 37.82 EUR · VAT 19 % 7.18 EUR · gross 45.00 EUR · payable by bank transfer'
	}
};

/**
 * The sample books, as the imports would bring them.
 *
 * @param {string} today YYYY-MM-DD
 * @param {string} [lang] the app's language: `en` for English, German otherwise
 * @returns {{
 *   accounts: { input: Rec, ledgerAccount: string, fingerprintAccount: string, incoming: Rec[] }[],
 *   receipts: Rec[]
 * }}
 */
export function sampleBooks(today, lang = 'de') {
	const w = lang === 'en' ? WORDS.en : WORDS.de;
	// The month before today's, so its export can be tried.
	const [y, m] = today.split('-').map(Number);
	const month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
	const day = (/** @type {number} */ d) => `${month}-${String(d).padStart(2, '0')}`;
	/** @param {string} eth @param {number} d */
	const crypto = (eth, d) => {
		const { amountCents, asset, quantity, decimals, valuation } = valuedFields({
			asset: 'ETH',
			units: toUnits(eth, 18),
			rate: { rate: RATE, source: 'manual', at: `${day(d)}T12:00:00Z` }
		});
		return { amountCents, crypto: { asset, quantity, decimals, valuation } };
	};

	return {
		accounts: [
			{
				input: {
					source: 'camt',
					sourceAccountId: 'sample-bank-1',
					ibanLast4: '0000',
					name: w.bank,
					currency: 'EUR'
				},
				ledgerAccount: '1200',
				fingerprintAccount: 'sample-bank-1',
				incoming: [
					{
						sourceId: 'sample-1',
						date: day(3),
						amountCents: 2380_00,
						counterpartyName: w.customer,
						counterpartyIban: 'DE00000000000000001111',
						purpose: w.invoice2026
					},
					{
						sourceId: 'sample-2',
						date: day(5),
						amountCents: -119_00,
						counterpartyName: 'Wolkenfabrik Hosting GmbH',
						counterpartyIban: 'DE00000000000000002222',
						purpose: w.re1001,
						bookingType: 'Basislastschrift'
					},
					{
						sourceId: 'sample-3',
						date: day(8),
						amountCents: -59_50,
						counterpartyName: w.office,
						counterpartyIban: 'DE00000000000000003333',
						purpose: w.order778899
					},
					{
						sourceId: 'sample-4',
						date: day(10),
						amountCents: -500_00,
						counterpartyName: w.own,
						counterpartyIban: 'DE00000000000000000001',
						purpose: w.toSavings
					},
					{
						sourceId: 'sample-5',
						date: day(12),
						amountCents: -80_00,
						counterpartyName: w.tools,
						counterpartyIban: 'DE00000000000000004444',
						purpose: w.order5566
					},
					{
						sourceId: 'sample-6',
						date: day(16),
						amountCents: 80_00,
						counterpartyName: w.tools,
						counterpartyIban: 'DE00000000000000004444',
						purpose: w.refund5566
					},
					{
						sourceId: 'sample-7',
						date: day(28),
						amountCents: -4_90,
						counterpartyName: '',
						purpose: w.accountFee,
						bookingType: 'Abschluss'
					}
				]
			},
			{
				input: {
					source: 'camt',
					sourceAccountId: 'sample-bank-2',
					ibanLast4: '0001',
					name: w.savings,
					currency: 'EUR'
				},
				ledgerAccount: '1210',
				fingerprintAccount: 'sample-bank-2',
				incoming: [
					{
						sourceId: 'sample-8',
						date: day(10),
						amountCents: 500_00,
						counterpartyName: w.own,
						counterpartyIban: 'DE00000000000000000000',
						purpose: w.toSavings
					}
				]
			},
			{
				input: {
					source: 'kraken',
					sourceAccountId: 'sample:ETH',
					ibanLast4: '',
					name: w.krakenAccount,
					currency: 'EUR',
					kind: 'exchange',
					asset: 'ETH',
					decimals: 18
				},
				ledgerAccount: '1220',
				fingerprintAccount: 'kraken:sample:ETH',
				incoming: [
					{
						sourceId: 'sample-9',
						date: day(18),
						counterpartyName: 'Kraken',
						purpose: w.withdrawal,
						movement: 'transfer',
						txRef: 'SAMPLE-WITHDRAWAL',
						chainTxRef: hash('a1'),
						...crypto('-0.1', 18)
					}
				]
			},
			{
				input: {
					source: 'ethereum',
					sourceAccountId: `sample:ETH:${WALLET}`,
					ibanLast4: '',
					name: w.walletAccount,
					currency: 'EUR',
					kind: 'wallet',
					asset: 'ETH',
					decimals: 18
				},
				ledgerAccount: '1230',
				fingerprintAccount: `ethereum:sample:${WALLET}`,
				incoming: [
					{
						sourceId: 'sample-10',
						date: day(18),
						counterpartyName: 'Kraken',
						purpose: `Tx ${hash('a1').slice(0, 10)}…`,
						movement: 'transfer',
						txRef: hash('a1'),
						...crypto('0.1', 18)
					},
					{
						sourceId: 'sample-11',
						date: day(20),
						counterpartyName: w.node,
						counterpartyAddress: VENDOR_WALLET,
						purpose: `Tx ${hash('b2').slice(0, 10)}…`,
						movement: 'transfer',
						txRef: hash('b2'),
						...crypto('-0.02', 20)
					},
					{
						sourceId: 'sample-11:fee',
						date: day(20),
						counterpartyName: '',
						purpose: `${w.networkFee} · Tx ${hash('b2').slice(0, 10)}…`,
						movement: 'fee',
						txRef: hash('b2'),
						...crypto('-0.0005', 20)
					}
				]
			}
		],
		receipts: [
			{
				source: 'upload',
				fileName: w.fileHosting,
				status: 'ausgelesen',
				vendor: 'Wolkenfabrik Hosting GmbH',
				amountCents: 119_00,
				currency: 'EUR',
				documentDate: day(2),
				invoiceNumber: 'RE-1001',
				excerpt: w.excerptHosting,
				extraction: {
					document_type: 'invoice',
					vendor: 'Wolkenfabrik Hosting GmbH',
					vendor_vat_id: 'DE000000000',
					invoice_number: 'RE-1001',
					customer_number: '4711',
					invoice_date: day(2),
					currency: 'EUR',
					net: 100,
					vat: [{ rate: 19, amount: 19 }],
					gross: 119,
					payment: 'direct_debit',
					reverse_charge: false,
					summary: w.hostingM
				}
			},
			{
				source: 'upload',
				fileName: w.filePower,
				status: 'ausgelesen',
				vendor: 'Stromwerk Test AG',
				amountCents: 45_00,
				currency: 'EUR',
				documentDate: day(22),
				invoiceNumber: '2026-77',
				excerpt: w.excerptPower,
				extraction: {
					document_type: 'invoice',
					vendor: 'Stromwerk Test AG',
					vendor_vat_id: 'DE000000001',
					invoice_number: '2026-77',
					customer_number: null,
					invoice_date: day(22),
					currency: 'EUR',
					net: 37.82,
					vat: [{ rate: 19, amount: 7.18 }],
					gross: 45,
					payment: 'bank_transfer',
					reverse_charge: false,
					summary: w.electricity
				}
			}
		]
	};
}

/**
 * Write the sample books through the imports' own path, each record marked.
 *
 * @param {{ accounts: any, transactions: any, receipts: any, events: any }} store
 * @param {string} today YYYY-MM-DD
 * @param {string} [lang] the app's language (`sampleBooks`)
 * @returns {Promise<{ accounts: number, transactions: number, receipts: number }>}
 */
export async function addSample(store, today, lang = 'de') {
	const books = sampleBooks(today, lang);
	let transactions = 0;
	for (const a of books.accounts) {
		const record = await upsertAccount(store.accounts, /** @type {any} */ (a.input));
		await store.accounts.put({ ...record, ledgerAccount: a.ledgerAccount, sample: true });
		await importTransactions({
			transactions: store.transactions,
			events: store.events,
			account: {
				id: record.id,
				source: a.input.source,
				fingerprintAccount: a.fingerprintAccount
			},
			incoming: /** @type {any[]} */ (a.incoming)
		});
		const written = await store.transactions.list({
			where: (/** @type {Rec} */ t) => t.accountId === record.id && !isSample(t)
		});
		for (const t of written) await store.transactions.put({ ...t, sample: true });
		transactions += written.length;
	}
	for (const r of books.receipts) await store.receipts.put({ ...r, sample: true });
	return { accounts: books.accounts.length, transactions, receipts: books.receipts.length };
}

/**
 * Take the sample books out again: every marked record, and the matches and
 * questions that point at one.
 *
 * @param {{ accounts: any, transactions: any, receipts: any, matches: any, questions: any }} store
 * @returns {Promise<number>} how many records were removed
 */
export async function removeSample(store) {
	let removed = 0;
	/** @type {Set<string>} */
	const ids = new Set();
	for (const name of /** @type {const} */ (['transactions', 'receipts', 'accounts'])) {
		for (const r of await store[name].list({ where: isSample })) {
			ids.add(String(r.id));
			await store[name].softDelete(r.id);
			removed++;
		}
	}
	const points = (/** @type {Rec} */ r) =>
		ids.has(String(r.receiptId ?? '')) || ids.has(String(r.transactionId ?? ''));
	for (const m of await store.matches.list({ where: points })) {
		if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
		await store.matches.softDelete(m.id);
	}
	for (const q of await store.questions.list({ where: points })) {
		await store.questions.softDelete(q.id);
	}
	return removed;
}
