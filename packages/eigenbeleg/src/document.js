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
// the CSV.
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

export const NOT_AN_INVOICE =
	'Dies ist keine Rechnung und kein Beleg eines Dritten. Le Space stellt keine Rechnungen für andere aus.';

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

/** The chains Eigenbeleg makes documents for, by id (as @le-space/chains names them). */
export const CHAIN_NAMES = {
	near: 'NEAR Protocol',
	akash: 'Akash',
	filecoin: 'Filecoin',
	aleph: 'Aleph Cloud (Credits)',
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
 * @property {string} eurExact what is on the Eigenbeleg, in EUR, positive
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
	layout = 'collective'
}) {
	if (layout !== 'collective' && layout !== 'single')
		throw new Error('layout: collective or single');
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
				what: KIND_TEXT[/** @type {keyof typeof KIND_TEXT} */ (e.kind)] ?? e.kind,
				recipient: e.counterpartyLabel || e.counterparty
			});
	}
	const first = number || `EB-${period.to.slice(0, 4)}-001`;
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
						what: KIND_TEXT[/** @type {keyof typeof KIND_TEXT} */ (e.kind)] ?? e.kind,
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
		chainName: CHAIN_NAMES[/** @type {keyof typeof CHAIN_NAMES} */ (chain)] ?? chain,
		network,
		testnet: network !== 'mainnet',
		period,
		positions,
		excluded,
		totals: {
			quantities,
			// What was paid, as a positive amount, rounded to cents.
			eur: round(eurExact.replace(/^-/, ''), 2),
			eurExact: eurExact.replace(/^-/, '')
		},
		sources: [
			...new Set(
				positions.map((p) =>
					/** @type {any} */ (p.entry.eur).source.replace(/ \d{4}-\d{2}-\d{2}.*$/, '')
				)
			)
		],
		note: NOTE,
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

/** A euro amount with fixed decimals: `0.0017` → `0,0017 €`. @param {string} amount @param {number} places */
export function deEuro(amount, places = 2) {
	const r = round(String(amount), places);
	const [int, frac = ''] = r.replace(/^-/, '').split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${r.startsWith('-') ? '−' : ''}${grouped},${frac.padEnd(places, '0')} €`;
}

/** `2026-10-05` → `05.10.2026`. @param {string} date */
export function deDate(date) {
	const [y, m, d] = date.slice(0, 10).split('-');
	return `${d}.${m}.${y}`;
}
