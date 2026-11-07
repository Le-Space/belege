// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug: every booking of one own blockchain account in a period,
// laid out the way a bank lays out an account statement – opening balance,
// each booking with debit (Soll) or credit (Haben) and the running balance,
// closing balance, sums. One section per asset the account holds.
//
// It is built from public chain data by the account holder. It is no
// document of a bank or of anyone else, and says so.
//
// The closing balance is checked: opening balance plus bookings must give
// the balance the chain reports after the period (NEAR, from the archival
// node). A difference is shown, not hidden. Where a chain keeps no old
// balances (Akash, Filecoin), the balances are derived from today's balance
// less the movements since, and the statement says that instead.

import { normalize, sum } from '@le-space/ledger';
import { CHAIN_NAMES, KIND_TEXT } from './document.js';

/** Aleph Cloud credits: the same layout, as a monthly Verbrauchsauszug. */
export const USAGE_NOTE =
	'Verbrauchsauszug eines Aleph-Cloud-Kontos (Credits), erstellt vom Kontoinhaber aus der öffentlichen Aleph-API. ' +
	'Kein Dokument eines Kreditinstituts und keine Rechnung von Aleph. Verbrauch je Tag und Ressource; Euro-Wert: USD-Preis je Credit ' +
	'(letzter Kauf am oder vor dem Tag, sonst Alephs Listenpreis von 1 USD je 1.000.000 Credits) zum EZB-Referenzkurs des Tages.';

export const STATEMENT_NOTE =
	'Kontoauszug eines Blockchain-Kontos, erstellt vom Kontoinhaber aus öffentlichen Chain-Daten. ' +
	'Kein Dokument eines Kreditinstituts. Jede Buchung ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

/**
 * @typedef {object} StatementRow
 * @property {string} date YYYY-MM-DD
 * @property {string} time HH:MM:SS UTC
 * @property {string} text what happened
 * @property {string} counterparty
 * @property {string} hash
 * @property {string} explorerUrl
 * @property {string} debit amount out, positive, or ''
 * @property {string} credit amount in, positive, or ''
 * @property {string} balance running balance after it
 * @property {string} eur signed EUR value at the day's rate, or ''
 * @property {string} beleg the Eigenbeleg's number, when the booking has one
 * @property {boolean} fee
 * @property {boolean} usage consumption billed from the balance (Aleph credits)
 * @property {string} hashLabel what the hash is: `Tx`, or `Ressource` for usage
 */

/**
 * @param {object} p
 * @param {{ name: string, address: string }} p.payer the account holder
 * @param {string} p.account the own address
 * @param {string} p.chain
 * @param {string} p.network
 * @param {{ from: string, to: string }} p.period
 * @param {import('./value.js').ValuedEntry[]} p.entries this account's entries in the period
 * @param {Record<string, string>} p.opening asset → balance before the period
 * @param {Record<string, string>} p.closing asset → balance after it, as the chain or the derivation says
 * @param {'archive' | 'derived'} p.method
 * @param {{ opening: { height: number, time: string }, closing: { height: number, time: string } } | null} [p.at]
 * @param {Map<string, string>} [p.belege] hash → Eigenbeleg number
 * @param {string} [p.number]
 * @param {string} [p.issuedAt]
 */
export function buildStatement({
	payer,
	account,
	chain,
	network,
	period,
	entries,
	opening,
	closing,
	method,
	at = null,
	belege = new Map(),
	number,
	issuedAt
}) {
	const own = entries.filter((e) => e.account === account && e.success !== false);
	const assets = [
		...new Set([...Object.keys(opening), ...own.filter((e) => e.priceAs).map((e) => e.asset)])
	];
	const sections = assets.map((asset) => {
		let balance = normalize(opening[asset] ?? '0');
		/** @type {StatementRow[]} */
		const rows = [];
		for (const e of own.filter((x) => x.asset === asset)) {
			balance = sum([balance, e.amount]);
			const out = e.amount.startsWith('-');
			rows.push({
				date: e.date,
				time: e.time.slice(11, 19),
				text: `${KIND_TEXT[/** @type {keyof typeof KIND_TEXT} */ (e.kind)] ?? e.kind}${e.type === 'received' ? ' (Eingang)' : ''}`,
				counterparty: e.counterpartyLabel
					? `${e.counterpartyLabel} · ${e.counterparty}`
					: e.counterparty,
				hash: e.hash,
				explorerUrl: e.explorerUrl,
				debit: out ? e.amount.slice(1) : '',
				credit: out ? '' : e.amount,
				balance,
				eur: e.eur?.value ?? '',
				beleg: belege.get(e.hash) ?? '',
				fee: e.type === 'fee',
				usage: e.kind === 'usage',
				hashLabel: e.kind === 'usage' ? 'Ressource' : 'Tx'
			});
		}
		const debit = sum(rows.map((r) => r.debit || '0'));
		const credit = sum(rows.map((r) => r.credit || '0'));
		const reported = closing[asset];
		return {
			asset,
			opening: normalize(opening[asset] ?? '0'),
			closing: balance,
			reported: reported === undefined ? null : normalize(reported),
			difference:
				reported === undefined
					? null
					: sum([reported, balance.startsWith('-') ? balance.slice(1) : `-${balance}`]),
			debit,
			credit,
			rows,
			eurOut: sum(rows.filter((r) => r.debit && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			eurIn: sum(rows.filter((r) => r.credit && r.eur).map((r) => r.eur)),
			eurFees: sum(rows.filter((r) => r.fee && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			eurUsage: sum(rows.filter((r) => r.usage && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			unvalued: rows.filter((r) => !r.eur).length
		};
	});
	// Aleph credits: a monthly usage statement, laid out as the Kontoauszug.
	const usage = chain === 'aleph';
	return {
		kind: 'kontoauszug',
		title: usage ? 'Verbrauchsauszug' : 'Kontoauszug',
		number: number || `KA-${period.from}`,
		issuedAt: issuedAt ?? new Date().toISOString(),
		holder: { name: payer.name.trim(), address: payer.address.trim() },
		account,
		chain,
		chainName: CHAIN_NAMES[/** @type {keyof typeof CHAIN_NAMES} */ (chain)] ?? chain,
		network,
		testnet: network !== 'mainnet',
		period,
		method,
		at,
		sections,
		unlisted: entries.filter(
			(e) => e.account === account && !e.priceAs && !assets.includes(e.asset)
		).length,
		note: usage ? USAGE_NOTE : STATEMENT_NOTE
	};
}

/** @typedef {ReturnType<typeof buildStatement>} Statement */
