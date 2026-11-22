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

/* The document is German: it is for German bookkeeping. */

export const NOTE =
	'Eigenbeleg. Für diese Zahlung gibt es keinen Fremdbeleg: Empfänger ist ein Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation. ' +
	'Ausgestellt vom Zahlenden auf Grundlage der öffentlichen Transaktion; jede Position ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

/** Aleph Cloud is an organisation, but the purchase of credits is a token payment on chain that gets no invoice (#23). */
export const ALEPH_NOTE =
	'Eigenbeleg. Für diese Zahlung gibt es keinen Fremdbeleg: Aleph-Cloud-Guthaben (Credits) wird per Token-Zahlung an das Aleph-Netzwerk gekauft; Aleph stellt dafür keine Rechnung aus. ' +
	'Ausgestellt vom Zahlenden auf Grundlage der öffentlichen Transaktion; jede Position ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

/**
 * Why there is no invoice for a payment on this chain: the recipient line and the reason, as the Eigenbeleg prints them.
 *
 * @param {string} chain
 * @param {string} chainName
 */
export function noInvoice(chain, chainName) {
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
 */
export function conversionText(currency) {
	const ecb = 'zum Euro-Referenzkurs der EZB des Tages oder des letzten davor';
	if (documentCurrency(currency) === 'EUR') return '';
	if (DOCUMENT_CURRENCIES[currency].via === 'cbr')
		return `über den Euro in ${currency} umgerechnet zum amtlichen Kurs der Bank von Russland, gültig am Tag (bis 01.03.2022 ${ecb})`;
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
 * is each position's.
 *
 * @param {string} source
 */
export const sourceName = (source) =>
	source
		.split(' × ')
		.map((leg) => leg.replace(/ \d{4}-\d{2}-\d{2}.*$/, '').replace(/ vom$/, ''))
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

/**
 * What an entry's kind is called on the documents. An Aleph credit purchase is a swap
 * of a token for credits in the ledger; for the books it is the purchase of a balance.
 *
 * @param {{ chain: string, kind: string }} e
 */
export const kindText = (e) =>
	e.chain === 'aleph' && e.kind === 'swap'
		? 'Kauf von Guthaben (Credits)'
		: (KIND_TEXT[/** @type {keyof typeof KIND_TEXT} */ (e.kind)] ?? e.kind);

/** The chains Eigenbeleg makes documents for, by id (as @le-space/chains names them). */
export const CHAIN_NAMES = {
	near: 'NEAR Protocol',
	akash: 'Akash',
	filecoin: 'Filecoin',
	aleph: 'Aleph Cloud (Credits)',
	'filecoin-pay': 'Filecoin Pay',
	ethereum: 'Ethereum',
	base: 'Base'
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
	base: 'Alchemy APIs (Base Mainnet)'
});

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
 * @param {string} [p.currency] the document's currency (DOCUMENT_CURRENCIES), EUR when not
 *   given; the entries are valued in it. The fields named `eur…` hold the values in this
 *   currency: they keep the name they had when every document was in euro.
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
	currency: asked
}) {
	if (layout !== 'collective' && layout !== 'single')
		throw new Error('layout: collective or single');
	const currency = documentCurrency(asked);
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
				? 'Eingang, keine Zahlung'
				: !e.success
					? 'fehlgeschlagen, nichts gezahlt'
					: own.has(e.counterparty)
						? 'Umbuchung zwischen eigenen Adressen'
						: !kinds.has(e.kind)
							? e.kind === 'transfer' || e.kind === 'call'
								? 'Zahlung an ein Konto: Fremdbeleg anfordern oder bewusst einbeziehen'
								: e.kind === 'escrow'
									? 'Hinterlegung (Escrow), noch kein Endbetrag'
									: e.kind === 'usage'
										? 'Verbrauch aus Guthaben: steht im Verbrauchsauszug'
										: 'keine Zahlung an das Netzwerk'
							: !e.eur
								? 'kein verlässlicher Kurs (unbekannter Token)'
								: '';
		if (why) excluded.push({ entry: e, why });
		else
			positions.push({
				pos: 0,
				entry: e,
				what: kindText(e),
				recipient: e.counterpartyLabel || e.counterparty
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
				from: { address: p.entry.account, label: 'eigene Adresse' },
				to: { address: main.counterparty, label: main.counterpartyLabel },
				movements: all.map((e) => {
					const x = excluded.find((y) => y.entry === e);
					return {
						entry: e,
						what: kindText(e),
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
		network,
		testnet: network !== 'mainnet',
		period,
		currency,
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
			...new Set(positions.map((p) => sourceName(/** @type {any} */ (p.entry.eur).source)))
		],
		note: noInvoice(chain, chainName).note,
		notInvoice: NOT_AN_INVOICE
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
