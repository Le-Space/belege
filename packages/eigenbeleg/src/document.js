// SPDX-License-Identifier: AGPL-3.0-or-later
// What an Eigenbeleg says, before it is drawn (pdf.js) or written (csv.js).
//
// An Eigenbeleg is a receipt the payer writes for a payment that has no
// receipt from the other side. It is never an invoice, and never one written
// for somebody else: the payer issues it, for their own payments.
//
// For a blockchain, the clean case is the network fee: it goes to a
// peer-to-peer network that has no organisation to issue an invoice. A
// storage deposit to a protocol contract is the same. A transfer to another
// account may well be to a company that does invoice; it goes on the
// Eigenbeleg only when the payer says so (`includeKinds`), and is always in
// the CSV. Buying Aleph Cloud credits with a token is a payment of its own
// (kind `swap` on chain `aleph`, issue #23): its Eigenbeleg says *Kauf von
// Guthaben*; the credits it brought appear on it as the incoming movement.
//
// Two layouts, the same content:
//   collective  one Eigenbeleg for the period (Sammel-Eigenbeleg), one
//               position per transaction;
//   single      one Eigenbeleg per transaction (as Belege writes them), each
//               with its own number, counted up from the first.
// Every transaction shows its full hash, who paid whom with full addresses,
// every movement it had (the gas too, and what is not on the Eigenbeleg,
// with the reason) and its explorer link as a QR code.
// Numbers come from the payer's own range, since this service stores nothing.

import { normalize, round, sum } from '@le-space/ledger';

import {
	documentLanguage,
	enDate,
	enFixed,
	enNumber,
	localizeLabel,
	localizeSource,
	say
} from './language.js';

/* The document is German unless asked for in English (language.js): it is for German bookkeeping. */

export const NOTE =
	'Eigenbeleg. Für diese Zahlung gibt es keinen Fremdbeleg: Empfänger ist ein Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation. ' +
	'Ausgestellt vom Zahlenden auf Grundlage der öffentlichen Transaktion; jede Position ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

/** Aleph Cloud is an organisation, but the purchase of credits is a token payment on chain that gets no invoice (#23). */
export const ALEPH_NOTE =
	'Eigenbeleg. Für diese Zahlung gibt es keinen Fremdbeleg: Aleph-Cloud-Guthaben (Credits) wird per Token-Zahlung an das Aleph-Netzwerk gekauft; Aleph stellt dafür keine Rechnung aus. ' +
	'Ausgestellt vom Zahlenden auf Grundlage der öffentlichen Transaktion; jede Position ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

/** The notes in English (language.js). */
export const NOTE_EN =
	'Self-issued receipt. There is no receipt from the other side for this payment: the recipient is a peer-to-peer network without an organisation that issues invoices. ' +
	'Issued by the payer from the public transaction; every position can be checked by its transaction hash in a public block explorer.';

export const ALEPH_NOTE_EN =
	'Self-issued receipt. There is no receipt from the other side for this payment: Aleph Cloud credits are bought by a token payment to the Aleph network; Aleph issues no invoice for it. ' +
	'Issued by the payer from the public transaction; every position can be checked by its transaction hash in a public block explorer.';

/**
 * Why there is no invoice for a payment on this chain: the recipient line and the reason, as the Eigenbeleg prints them.
 *
 * @param {string} chain
 * @param {string} chainName
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function noInvoice(chain, chainName, language = 'de') {
	if (language === 'en')
		return chain === 'aleph'
			? {
					recipient: `${chainName}: purchase of credits by a token payment to the network, without an invoice`,
					why: 'Aleph Cloud credits are bought by a token payment to the Aleph network; Aleph issues no invoice for it.',
					note: ALEPH_NOTE_EN
				}
			: {
					recipient: `${chainName}: peer-to-peer network without an organisation that issues invoices`,
					why: 'The recipient is a peer-to-peer network without an organisation that issues invoices; it issues none.',
					note: NOTE_EN
				};
	if (chain === 'aleph')
		return {
			recipient: `${chainName}: Kauf von Guthaben per Token-Zahlung an das Netzwerk, ohne Rechnung`,
			why: 'Aleph-Cloud-Guthaben (Credits) wird per Token-Zahlung an das Aleph-Netzwerk gekauft; Aleph stellt dafür keine Rechnung aus.',
			note: ALEPH_NOTE
		};
	return {
		recipient: `${chainName}: Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation`,
		why: 'Der Empfänger ist ein Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation; es stellt keine Rechnung aus.',
		note: NOTE
	};
}

export const NOT_AN_INVOICE =
	'Dies ist keine Rechnung und kein Beleg eines Dritten. Le Space stellt keine Rechnungen für andere aus.';

export const NOT_AN_INVOICE_EN =
	'This is no invoice and no receipt of a third party. Le Space issues no invoices for others.';

/**
 * The currencies a document can be kept in (Le-Space/eigenbeleg-agent#72),
 * each with the decimals its totals are rounded to (ISO 4217) and where its
 * rate against the euro comes from: the ECB's reference rate, or the Bank of
 * Russia's official rate. EUR is the default, and what every document was in
 * before. The caller's rates must be in the document's currency
 * (`valueEntries(entries, rates, { currency })`; @le-space/rates
 * `rate(asset, date, { currency })`).
 */
export const DOCUMENT_CURRENCIES = Object.freeze(
	/** @type {Record<string, { places: number, via: 'ecb' | 'cbr' | null }>} */ ({
		EUR: { places: 2, via: null },
		USD: { places: 2, via: 'ecb' },
		CHF: { places: 2, via: 'ecb' },
		GBP: { places: 2, via: 'ecb' },
		SEK: { places: 2, via: 'ecb' },
		NOK: { places: 2, via: 'ecb' },
		DKK: { places: 2, via: 'ecb' },
		PLN: { places: 2, via: 'ecb' },
		CZK: { places: 2, via: 'ecb' },
		HUF: { places: 2, via: 'ecb' },
		RON: { places: 2, via: 'ecb' },
		ISK: { places: 0, via: 'ecb' },
		TRY: { places: 2, via: 'ecb' },
		RUB: { places: 2, via: 'cbr' }
	})
);

/** The currency of a document, checked: EUR when none is given. @param {unknown} [currency] */
export function documentCurrency(currency = 'EUR') {
	if (typeof currency !== 'string' || !Object.hasOwn(DOCUMENT_CURRENCIES, currency))
		throw new Error(`currency: one of ${Object.keys(DOCUMENT_CURRENCIES).join(', ')}`);
	return currency;
}

/** The decimals a currency's totals are rounded to. @param {string} currency */
export const currencyPlaces = (currency) => DOCUMENT_CURRENCIES[documentCurrency(currency)].places;

/**
 * How a value in euro became one in the document's currency, as the documents
 * say it after naming the euro rate; '' for EUR. The rate is named for what it
 * is: the ECB's reference rate, or the Bank of Russia's official rate.
 *
 * @param {string} currency
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function conversionText(currency, language = 'de') {
	if (documentCurrency(currency) === 'EUR') return '';
	if (language === 'en')
		return DOCUMENT_CURRENCIES[currency].via === 'cbr'
			? `converted through the euro into ${currency} at the official rate of the Bank of Russia valid on the day`
			: `converted through the euro into ${currency} at the ECB's euro reference rate of the day or the last one before it`;
	const ecb = 'zum Euro-Referenzkurs der EZB des Tages oder des letzten davor';
	if (DOCUMENT_CURRENCIES[currency].via === 'cbr')
		return `über den Euro in ${currency} umgerechnet zum amtlichen Kurs der Bank von Russland, gültig am Tag`;
	return `über den Euro in ${currency} umgerechnet ${ecb}`;
}

/**
 * The currency an entry was valued in, and that it is the document's: a value
 * in francs under a head that says EUR would be a wrong booking.
 *
 * @param {import('./value.js').ValuedEntry[]} entries
 * @param {string} currency
 */
export function checkValued(entries, currency) {
	for (const e of entries) {
		const valued = e.eur ? (e.eur.currency ?? 'EUR') : currency;
		if (valued !== currency)
			throw new Error(`an entry is valued in ${valued}, the document is in ${currency}`);
	}
}

/**
 * A rate's name without its day (`… vom 2026-08-10`), each leg of it: the day
 * is each position's. A reference value (`Referenzwert von …, Stand
 * 2026-01-01 (kein Börsenkurs)`, @le-space/rates referenceRate) keeps what it
 * is and loses only its `Stand`.
 *
 * @param {string} source
 */
export const sourceName = (source) =>
	source
		.split(' × ')
		.map((leg) =>
			leg.startsWith('Referenzwert')
				? leg.replace(/, Stand \d{4}-\d{2}-\d{2}/, '')
				: leg.replace(/ \d{4}-\d{2}-\d{2}.*$/, '').replace(/ vom$/, '')
		)
		.join(' × ');

/** Kinds that go on the Eigenbeleg unless the payer chooses otherwise. */
export const DEFAULT_KINDS = ['fee', 'storage'];

export const KIND_TEXT = {
	fee: 'Netzwerkgebühr (Gas)',
	storage: 'Speicherhinterlegung (Storage Deposit)',
	transfer: 'Überweisung',
	call: 'Zahlung an Contract',
	stake: 'Staking (keine Zahlung)',
	unstake: 'Unstaking',
	reward: 'Staking-Ertrag',
	swap: 'Tausch',
	escrow: 'Hinterlegung für ein Deployment (Escrow)',
	usage: 'Verbrauch (aus Guthaben abgerechnet)'
};

export const KIND_TEXT_EN = {
	fee: 'Network fee (gas)',
	storage: 'Storage deposit',
	transfer: 'Transfer',
	call: 'Payment to a contract',
	stake: 'Staking (no payment)',
	unstake: 'Unstaking',
	reward: 'Staking reward',
	swap: 'Swap',
	escrow: 'Deposit for a deployment (escrow)',
	usage: 'Usage (billed from the balance)'
};

/** `AB12CD34…9F3C`: a transaction hash short enough for a line. @param {string} hash */
const shortHash = (hash) => (hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash);

/**
 * What a NEAR storage deposit was for (@le-space/chains near-storage.js), after
 * its kind: the swap it was made for, the transfer to the account it registered,
 * the first receipt of the token – or nothing, a storage deposit of its own.
 *
 * @param {{ partOf?: string, enables?: { hash: string, kind: string }, registration?: { account: string } }} e
 * @param {import('./language.js').DocumentLanguage} language
 */
export function storagePurposeText(e, language = 'de') {
	if (typeof e.partOf === 'string' && e.partOf)
		return say(
			language,
			` für den Tausch in Tx ${shortHash(e.partOf)}`,
			` for the swap in tx ${shortHash(e.partOf)}`
		);
	const to = e.registration?.account;
	if (e.enables?.kind === 'transfer')
		return to
			? say(
					language,
					` für die Überweisung an ${to} in Tx ${shortHash(e.enables.hash)}`,
					` for the transfer to ${to} in tx ${shortHash(e.enables.hash)}`
				)
			: say(
					language,
					` für die Überweisung in Tx ${shortHash(e.enables.hash)}`,
					` for the transfer in tx ${shortHash(e.enables.hash)}`
				);
	if (e.enables?.kind === 'receipt')
		return say(
			language,
			` für den ersten Eingang des Tokens in Tx ${shortHash(e.enables.hash)}`,
			` for the first receipt of the token in tx ${shortHash(e.enables.hash)}`
		);
	return '';
}

/**
 * What an entry's kind is called on the documents. An Aleph credit purchase is a swap
 * of a token for credits in the ledger; for the books it is the purchase of a balance.
 * A NEAR storage deposit says what it was for (storagePurposeText), and so does the gas
 * of its transaction; one read as a fee (`purpose: 'storage'`) is a storage deposit all
 * the same.
 *
 * @param {{ chain: string, kind: string, type?: string, purpose?: string, partOf?: string, enables?: { hash: string, kind: string }, registration?: { account: string } }} e
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export const kindText = (e, language = 'de') => {
	if (e.chain === 'aleph' && e.kind === 'swap')
		return say(language, 'Kauf von Guthaben (Credits)', 'Purchase of credits');
	const texts = language === 'en' ? KIND_TEXT_EN : KIND_TEXT;
	if (e.kind === 'storage' || e.purpose === 'storage')
		return texts.storage + storagePurposeText(e, language);
	// The gas of a storage deposit's transaction names what the deposit was for.
	if (e.kind === 'fee') return texts.fee + storagePurposeText(e, language);
	return texts[/** @type {keyof typeof KIND_TEXT} */ (e.kind)] ?? e.kind;
};

/** The chains Eigenbeleg makes documents for, by id (as @le-space/chains names them). */
export const CHAIN_NAMES = {
	near: 'NEAR Protocol',
	akash: 'Akash',
	filecoin: 'Filecoin',
	aleph: 'Aleph Cloud (Credits)',
	'filecoin-pay': 'Filecoin Pay',
	ethereum: 'Ethereum',
	base: 'Base',
	bitcoin: 'Bitcoin',
	doichain: 'Doichain'
};

/**
 * Where a chain's data comes from, named in the footer of its documents.
 * Ethereum and Base: Eigenbeleg reads them through Alchemy (@le-space/chains'
 * EVM reader, with the server's key).
 */
export const DATA_SOURCES = /** @type {Record<string, string>} */ ({
	near: 'NearBlocks.io APIs, NEAR-Archiv-RPC',
	filecoin: 'Filfox',
	akash: 'Akash-RPC, Akash Console',
	aleph: 'Aleph-API (api2.aleph.im)',
	'filecoin-pay': 'Index von Filecoin Pay (Goldsky), Blockscout, Filfox',
	ethereum: 'Alchemy APIs (Ethereum Mainnet)',
	base: 'Alchemy APIs (Base Mainnet)',
	bitcoin: 'Esplora-API von mempool.space',
	doichain: 'ElectrumX-Server des Doichain-Netzes'
});

export const DATA_SOURCES_EN = /** @type {Record<string, string>} */ ({
	near: 'NearBlocks.io APIs, NEAR archival RPC',
	filecoin: 'Filfox',
	akash: 'Akash RPC, Akash Console',
	aleph: 'Aleph API (api2.aleph.im)',
	'filecoin-pay': 'Filecoin Pay index (Goldsky), Blockscout, Filfox',
	ethereum: 'Alchemy APIs (Ethereum Mainnet)',
	base: 'Alchemy APIs (Base Mainnet)',
	bitcoin: 'Esplora API of mempool.space',
	doichain: 'ElectrumX servers of the Doichain network'
});

/**
 * The data source a document names: the one the caller read from when it
 * says so (an own Esplora, say), else the chain's usual one.
 *
 * @param {string} chain
 * @param {string} chainName
 * @param {string} [given]
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export const dataSourceOf = (chain, chainName, given, language = 'de') =>
	given?.trim() || (language === 'en' ? DATA_SOURCES_EN : DATA_SOURCES)[chain] || chainName;

/**
 * @typedef {object} Payer who pays and issues the Eigenbeleg
 * @property {string} name
 * @property {string} address postal address, lines separated by \n
 * @property {string[]} addresses own payment addresses on the chain
 */

/**
 * @typedef {object} Position
 * @property {number} pos
 * @property {import('./value.js').ValuedEntry} entry
 * @property {string} what
 * @property {string} recipient
 */

/**
 * @typedef {object} Movement one movement of a transaction
 * @property {import('./value.js').ValuedEntry} entry
 * @property {string} what
 * @property {boolean} onIt on the Eigenbeleg
 * @property {string} why why not, when not
 */

/**
 * @typedef {object} Transaction one position: a transaction with a payment on the Eigenbeleg
 * @property {number} pos
 * @property {string} number its own number in the single layout ('' in the collective one)
 * @property {string} hash
 * @property {string} time
 * @property {string} explorerUrl
 * @property {{ address: string, label: string }} from the own address that paid
 * @property {{ address: string, label: string }} to who received the payment
 * @property {Movement[]} movements every movement of the transaction the period has
 * @property {string} eurExact what is on the Eigenbeleg, in the document's currency, positive
 */

/**
 * @param {object} p
 * @param {Payer} p.payer
 * @param {string} p.chain
 * @param {string} p.network
 * @param {{ from: string, to: string }} p.period
 * @param {import('./value.js').ValuedEntry[]} p.entries every entry of the period, all own addresses
 * @param {string} [p.number] the Eigenbeleg's number in the payer's range, e.g. EB-2026-007
 * @param {string[]} [p.includeKinds]
 * @param {string} [p.issuedAt] ISO; now when not given
 * @param {'collective' | 'single'} [p.layout]
 * @param {string} [p.dataSource] where the entries were read from, when not the chain's usual source
 * @param {string} [p.currency] the document's currency (DOCUMENT_CURRENCIES), EUR when not
 *   given; the entries are valued in it. The fields named `eur…` hold the values in this
 *   currency: they keep the name they had when every document was in euro.
 * @param {import('./language.js').DocumentLanguage} [p.language] `de` (the default) or `en` (language.js)
 */
export function buildDocument({
	payer,
	chain,
	network,
	period,
	entries,
	number,
	includeKinds = DEFAULT_KINDS,
	issuedAt,
	layout = 'collective',
	dataSource,
	currency: asked,
	language: askedLanguage
}) {
	if (layout !== 'collective' && layout !== 'single')
		throw new Error('layout: collective or single');
	const currency = documentCurrency(asked);
	const L = documentLanguage(askedLanguage);
	checkValued(entries, currency);
	checkPayer(payer);
	const kinds = new Set(includeKinds);
	const own = new Set(payer.addresses);
	/** @type {Position[]} */
	const positions = [];
	/** @type {{ entry: import('./value.js').ValuedEntry, why: string }[]} */
	const excluded = [];
	for (const e of entries) {
		const why =
			e.type === 'received'
				? say(L, 'Eingang, keine Zahlung', 'incoming, no payment')
				: !e.success
					? say(L, 'fehlgeschlagen, nichts gezahlt', 'failed, nothing paid')
					: own.has(e.counterparty)
						? say(L, 'Umbuchung zwischen eigenen Adressen', 'transfer between own addresses')
						: !kinds.has(e.kind)
							? e.kind === 'transfer' || e.kind === 'call'
								? say(
										L,
										'Zahlung an ein Konto: Fremdbeleg anfordern oder bewusst einbeziehen',
										'payment to an account: ask for its receipt or include it on purpose'
									)
								: e.kind === 'escrow'
									? say(
											L,
											'Hinterlegung (Escrow), noch kein Endbetrag',
											'deposit (escrow), no final amount yet'
										)
									: e.kind === 'usage'
										? say(
												L,
												'Verbrauch aus Guthaben: steht im Verbrauchsauszug',
												'usage from a balance: on the usage statement'
											)
										: say(L, 'keine Zahlung an das Netzwerk', 'no payment to the network')
							: !e.eur
								? say(
										L,
										'kein verlässlicher Kurs (unbekannter Token)',
										'no reliable rate (unknown token)'
									)
								: '';
		if (why) excluded.push({ entry: e, why });
		else
			positions.push({
				pos: 0,
				entry: e,
				what: kindText(e, L),
				recipient: localizeLabel(e.counterpartyLabel, L) || e.counterparty
			});
	}
	const first = number || `EB-${period.to.slice(0, 4)}-001`;
	const chainName = CHAIN_NAMES[/** @type {keyof typeof CHAIN_NAMES} */ (chain)] ?? chain;
	/** @type {Transaction[]} */
	const transactions = [];
	for (const p of positions) {
		let t = transactions.find((x) => x.hash === p.entry.hash);
		if (!t) {
			const all = entries.filter((e) => e.hash === p.entry.hash);
			// The payment, not the gas, says to whom; a transaction with only gas paid the network.
			const main = all.find((e) => e.type === 'sent') ?? p.entry;
			t = {
				pos: transactions.length + 1,
				number: layout === 'single' ? nthNumber(first, transactions.length) : '',
				hash: p.entry.hash,
				time: p.entry.time,
				explorerUrl: p.entry.explorerUrl,
				from: { address: p.entry.account, label: say(L, 'eigene Adresse', 'own address') },
				to: { address: main.counterparty, label: localizeLabel(main.counterpartyLabel, L) },
				movements: all.map((e) => {
					const x = excluded.find((y) => y.entry === e);
					return {
						entry: e,
						what: kindText(e, L),
						onIt: !x,
						why: x?.why ?? ''
					};
				}),
				eurExact: '0'
			};
			transactions.push(t);
		}
		p.pos = t.pos;
	}
	for (const t of transactions)
		t.eurExact = sum(
			t.movements.filter((m) => m.onIt).map((m) => /** @type {any} */ (m.entry.eur).value)
		).replace(/^-/, '');
	/** @type {Record<string, string>} */
	const quantities = {};
	for (const asset of new Set(positions.map((p) => p.entry.asset)))
		quantities[asset] = normalize(
			sum(positions.filter((p) => p.entry.asset === asset).map((p) => p.entry.amount)).replace(
				/^-/,
				''
			)
		);
	const eurExact = positions.length
		? sum(positions.map((p) => /** @type {any} */ (p.entry.eur).value))
		: '0';
	return {
		number:
			layout === 'single' && transactions.length > 1
				? `${first} – ${transactions.at(-1)?.number}`
				: first,
		layout,
		transactions,
		issuedAt: issuedAt ?? new Date().toISOString(),
		payer: {
			name: payer.name.trim(),
			address: payer.address.trim(),
			addresses: [...payer.addresses]
		},
		chain,
		chainName,
		dataSource: dataSourceOf(chain, chainName, dataSource, L),
		network,
		testnet: network !== 'mainnet',
		period,
		currency,
		language: L,
		positions,
		excluded,
		totals: {
			quantities,
			// What was paid, as a positive amount, rounded to cents (the currency's smallest unit).
			eur: round(eurExact.replace(/^-/, ''), currencyPlaces(currency)),
			eurExact: eurExact.replace(/^-/, '')
		},
		// The rate's name without its day (`… vom 2026-08-10`): the day is each position's.
		sources: [
			...new Set(
				positions.map((p) => localizeSource(sourceName(/** @type {any} */ (p.entry.eur).source), L))
			)
		],
		note: noInvoice(chain, chainName, L).note,
		notInvoice: L === 'en' ? NOT_AN_INVOICE_EN : NOT_AN_INVOICE
	};
}

/** @typedef {ReturnType<typeof buildDocument>} EigenbelegDocument */

/**
 * The n-th number counted up from the first: EB-2026-007 → EB-2026-008 …
 * A number without digits at its end gets -1, -2 …
 *
 * @param {string} first @param {number} n
 */
export function nthNumber(first, n) {
	if (n === 0) return first;
	const m = /^(.*?)(\d+)$/.exec(first);
	if (!m) return `${first}-${n + 1}`;
	return `${m[1]}${String(Number(m[2]) + n).padStart(m[2].length, '0')}`;
}

/** @param {Payer} payer */
function checkPayer(payer) {
	if (!payer || typeof payer !== 'object') throw new Error('payer is required');
	if (typeof payer.name !== 'string' || payer.name.trim().length < 2 || payer.name.length > 200)
		throw new Error('payer.name is required');
	if (
		typeof payer.address !== 'string' ||
		payer.address.trim().length < 5 ||
		payer.address.length > 500
	)
		throw new Error('payer.address (postal) is required');
	if (
		!Array.isArray(payer.addresses) ||
		payer.addresses.length === 0 ||
		payer.addresses.length > 20
	)
		throw new Error('payer.addresses: one to twenty own addresses');
}

// ---- German formats ---------------------------------------------------------

/** `-1234.5` → `-1.234,5`; keeps every decimal. @param {string} amount */
export function deNumber(amount) {
	const s = normalize(String(amount));
	const neg = s.startsWith('-');
	const [int, frac] = s.replace(/^-/, '').split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${neg ? '−' : ''}${grouped}${frac ? ',' + frac : ''}`;
}

/**
 * A rate for the table, rounded to `digits` significant digits: `0.012345678901234567` → `0,0123457`,
 * `0.00000072500003` → `0,000000725`. Read, not recomputed: the values stay at the full rate,
 * which the CSV keeps; a rate with every decimal does not fit its column.
 *
 * @param {string} rate @param {number} [digits]
 */
export function deRate(rate, digits = 6) {
	const s = normalize(String(rate)).replace(/^-/, '');
	const [int, frac = ''] = s.split('.');
	const places =
		int !== '0'
			? Math.max(0, digits - int.length)
			: frac.length - frac.replace(/^0+/, '').length + digits;
	return deNumber(normalize(round(String(rate), places)));
}

/** An amount with fixed decimals and no unit: `0.0017` → `0,0017`. @param {string} amount @param {number} places */
export function deFixed(amount, places = 2) {
	const r = round(String(amount), places);
	const [int, frac = ''] = r.replace(/^-/, '').split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${r.startsWith('-') ? '−' : ''}${grouped}${places ? `,${frac.padEnd(places, '0')}` : ''}`;
}

/** A euro amount with fixed decimals: `0.0017` → `0,0017 €`. @param {string} amount @param {number} places */
export function deEuro(amount, places = 2) {
	return `${deFixed(amount, places)} €`;
}

/**
 * An amount in a document's currency: `12,34 €`, and for every other currency
 * its code (`12,34 CHF`) – kr and $ are several currencies' signs.
 *
 * @param {string} amount
 * @param {string} currency
 * @param {number} [places] the currency's own when not given
 */
export function deMoney(amount, currency, places = currencyPlaces(currency)) {
	return `${deFixed(amount, places)} ${currency === 'EUR' ? '€' : currency}`;
}

/** `2026-10-05` → `05.10.2026`. @param {string} date */
export function deDate(date) {
	const [y, m, d] = date.slice(0, 10).split('-');
	return `${d}.${m}.${y}`;
}

// ---- the formats of a document's language -------------------------------------

/**
 * The number and date formats of a document's language: German as above, or
 * English (language.js). Same names, so a drawing reads `f.money(…)` either way.
 *
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function formats(language = 'de') {
	if (language !== 'en')
		return { number: deNumber, rate: deRate, fixed: deFixed, money: deMoney, date: deDate };
	/** @param {string} rate @param {number} [digits] */
	const rate = (rate, digits = 6) => {
		const s = normalize(String(rate)).replace(/^-/, '');
		const [int, frac = ''] = s.split('.');
		const places =
			int !== '0'
				? Math.max(0, digits - int.length)
				: frac.length - frac.replace(/^0+/, '').length + digits;
		return enNumber(normalize(round(String(rate), places)));
	};
	/** @param {string} amount @param {string} currency @param {number} [places] */
	const money = (amount, currency, places = currencyPlaces(currency)) =>
		`${enFixed(amount, places)} ${currency}`;
	return { number: enNumber, rate, fixed: enFixed, money, date: enDate };
}
