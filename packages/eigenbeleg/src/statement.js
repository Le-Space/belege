// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug: every booking of one own blockchain account in a period,
// laid out the way a bank lays out an account statement – opening balance,
// each booking with debit (Soll) or credit (Haben) and the running balance,
// closing balance, sums. One section per asset the account holds. A token
// not in the chain's list (EVM, #93) has one too, named by its contract: the
// symbol and decimals are what the contract says of itself.
//
// It is built from public chain data by the account holder. It is no
// document of a bank or of anyone else, and says so.
//
// The closing balance is checked: opening balance plus bookings must give
// the balance the chain reports after the period (NEAR, from the archival
// node). A difference is shown, not hidden. Where a chain keeps no old
// balances (Akash, Filecoin), the balances are derived from today's balance
// less the movements since, and the statement says that instead.
//
// A difference below what the documents print (twelve decimals) still
// counts as reconciled, and is still shown: the NEAR reader leaves out the
// 1 yoctoNEAR a token transfer attaches as its security deposit (no payment,
// 10⁻²⁴ NEAR), so an account that moved tokens is off by a few yocto.

import { normalize, sum } from '@le-space/ledger';
import {
	CHAIN_NAMES,
	dataSourceOf,
	checkValued,
	conversionText,
	documentCurrency,
	kindText,
	sourceName
} from './document.js';
import { documentLanguage, localizeLabel, say } from './language.js';

/** Smaller than the twelve decimals the documents print (and not zero). @param {string} difference */
export const isDust = (difference) => /^-?0\.0{12}\d*$/.test(difference);

/**
 * Whether opening balance plus bookings meet the chain's balance: exactly,
 * or but for dust (isDust). null: the chain names no balance.
 *
 * @param {string | null} difference
 * @returns {boolean | null}
 */
export const reconciled = (difference) =>
	difference === null ? null : /^-?0(\.0+)?$/.test(difference) || isDust(difference);

/** Aleph Cloud credits: the same layout, as a monthly Verbrauchsauszug. */
export const USAGE_NOTE =
	'Verbrauchsauszug eines Aleph-Cloud-Kontos (Credits), erstellt vom Kontoinhaber aus der öffentlichen Aleph-API. ' +
	'Kein Dokument eines Kreditinstituts und keine Rechnung von Aleph. Verbrauch je Tag und Ressource; Euro-Wert: USD-Preis je Credit ' +
	'(letzter Kauf am oder vor dem Tag, sonst Alephs Listenpreis von 1 USD je 1.000.000 Credits) zum EZB-Referenzkurs des Tages.';

/** Filecoin Pay: a payer's balance in the payment contract, as a monthly Verbrauchsauszug. */
export const FILECOIN_PAY_USAGE_NOTE =
	'Verbrauchsauszug eines Guthabens im Zahlungsvertrag Filecoin Pay (Filecoin Onchain Cloud), erstellt vom Zahler aus öffentlichen Chain-Daten. ' +
	'Kein Dokument eines Kreditinstituts und keine Rechnung eines Speicheranbieters. Verbrauch ist jede Abrechnung einer Rail an ihren Anbieter; ' +
	'sie bezahlt bis zu dem Zeitpunkt, den sie nennt, und deckt darum nicht genau den Monat. Gelesen wird nur USDFC; was der Zahler selbst über Rails einnimmt, fehlt. ' +
	'Euro-Wert: USDFC ist an den US-Dollar gebunden und wird zum Tageskurs von USDC bewertet.';

/** The chains whose statement is a Verbrauchsauszug (consumption from a prepaid balance), with its note. */
export const USAGE_NOTES = /** @type {Record<string, string>} */ ({
	aleph: USAGE_NOTE,
	'filecoin-pay': FILECOIN_PAY_USAGE_NOTE
});

/** The same notes in English (language.js). */
export const USAGE_NOTES_EN = /** @type {Record<string, string>} */ ({
	aleph:
		'Usage statement of an Aleph Cloud account (credits), made by the account holder from the public Aleph API. ' +
		'No document of a bank and no invoice of Aleph. Usage per day and resource; value: the USD price per credit ' +
		"(the last purchase on or before the day, else Aleph's list price of 1 USD per 1,000,000 credits) at the ECB reference rate of the day.",
	'filecoin-pay':
		'Usage statement of a balance in the Filecoin Pay payment contract (Filecoin Onchain Cloud), made by the payer from public chain data. ' +
		'No document of a bank and no invoice of a storage provider. Usage is every settlement of a rail to its provider; ' +
		'it pays up to the time it names, so it does not cover the month exactly. Only USDFC is read; what the payer takes in through rails is missing. ' +
		'Value: USDFC is pegged to the US dollar and valued at the rate of USDC of the day.'
});

/**
 * The note of a Verbrauchsauszug in the document's currency: what its values
 * are, said for that currency. EUR: the notes above, as they were.
 *
 * @param {string} chain from USAGE_NOTES
 * @param {string} currency
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function usageNote(chain, currency, language = 'de') {
	if (language === 'en') {
		const note = USAGE_NOTES_EN[chain];
		if (currency === 'EUR') return note;
		const head = note.slice(0, note.indexOf('Value:'));
		if (chain === 'aleph') {
			const price =
				"the USD price per credit (the last purchase on or before the day, else Aleph's list price of 1 USD per 1,000,000 credits)";
			return `${head}Value in ${currency}: ${price}${currency === 'USD' ? '' : `, ${conversionText(currency, 'en')}`}.`;
		}
		return `${head}Value in ${currency}: USDFC is pegged to the US dollar and valued at the rate of USDC of the day, ${conversionText(currency, 'en')}.`;
	}
	const note = USAGE_NOTES[chain];
	if (currency === 'EUR') return note;
	const head = note.slice(0, note.indexOf('Euro-Wert:'));
	if (chain === 'aleph') {
		const price =
			'USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Alephs Listenpreis von 1 USD je 1.000.000 Credits)';
		return `${head}Wert in ${currency}: ${price}${currency === 'USD' ? '' : `, ${conversionText(currency)}`}.`;
	}
	return `${head}Wert in ${currency}: USDFC ist an den US-Dollar gebunden und wird zum Tageskurs von USDC bewertet, ${conversionText(currency)}.`;
}

/**
 * How a section's values came about: at a market rate of the day, at a
 * reference value (a rate whose first leg is a `Referenzwert`, by its name), or both.
 *
 * @param {StatementRow[]} rows
 * @returns {{ marketRate: boolean, referenceValues: string[] }}
 */
export function valuedBy(rows) {
	const legs = rows.filter((r) => r.eur).map((r) => sourceName(r.rateSource ?? '').split(' × ')[0]);
	return {
		marketRate: legs.some((l) => !l.startsWith('Referenzwert')),
		referenceValues: [...new Set(legs.filter((l) => l.startsWith('Referenzwert')))]
	};
}

/**
 * The contract of a token not in the chain's list (EVM, #93): lower case, '' for
 * the native coin, a listed token and anything else.
 *
 * @param {{ listed?: boolean, contract?: string }} e
 */
const unlistedContract = (e) =>
	e.listed === false && /^0x[0-9a-fA-F]{40}$/.test(e.contract ?? '')
		? /** @type {string} */ (e.contract).toLowerCase()
		: '';

export const STATEMENT_NOTE =
	'Kontoauszug eines Blockchain-Kontos, erstellt vom Kontoinhaber aus öffentlichen Chain-Daten. ' +
	'Kein Dokument eines Kreditinstituts. Jede Buchung ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.';

export const STATEMENT_NOTE_EN =
	'Account statement of a blockchain account, made by the account holder from public chain data. ' +
	'No document of a bank. Every booking can be checked by its transaction hash in a public block explorer.';

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
 * @property {string} eur signed value at the day's rate, in the statement's currency (EUR unless another), or ''
 * @property {string} [rateSource] where that value's rate came from (`eur.source`), '' or absent when unknown
 * @property {string} beleg the Eigenbeleg's number, when the booking has one
 * @property {boolean} fee
 * @property {boolean} usage consumption billed from the balance (Aleph credits, a Filecoin Pay settlement)
 * @property {boolean} purchase credits bought from Aleph (the payment is on another chain, with its own Eigenbeleg)
 * @property {string} label the counterparty's label alone (the resource's name, for usage)
 * @property {string} hashLabel what the hash is: `Tx`, or `Ressource` for Aleph's usage
 */

/**
 * @typedef {object} MonthlyLine one line of the month's summary
 * @property {string} label
 * @property {string} amount in the asset, positive
 * @property {string} eur positive, '' when a row had no rate
 * @property {number} rows how many bookings it sums
 */

/**
 * The month in sums, as the books take it (issue #24): consumption per resource and in all,
 * credits bought, transfers in and out, fees. One booking each instead of the day's rows below.
 *
 * @param {StatementRow[]} rows
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function monthly(rows, language = 'de') {
	/** @param {string} de @param {string} en */
	const t = (de, en) => say(language, de, en);
	/** @param {StatementRow[]} rs @param {string} label @param {'debit' | 'credit'} side @returns {MonthlyLine} */
	const line = (rs, label, side) => ({
		label,
		amount: sum(rs.map((r) => r[side] || '0')),
		eur: rs.some((r) => !r.eur) ? '' : sum(rs.map((r) => r.eur.replace(/^-/, ''))),
		rows: rs.length
	});
	/** Usage rows by resource, in the order they first appear. */
	const byResource = [...new Set(rows.filter((r) => r.usage).map((r) => r.label))].map((label) =>
		line(
			rows.filter((r) => r.usage && r.label === label),
			`${t('Verbrauch', 'Usage')} ${label.replace(/^Aleph Cloud \((.*)\)$/, '$1').replace(/^storage$/, t('Speicher (storage)', 'storage'))}`,
			'debit'
		)
	);
	const usage = rows.filter((r) => r.usage);
	const purchases = rows.filter((r) => r.purchase);
	const transfersIn = rows.filter((r) => r.credit && !r.purchase);
	const transfersOut = rows.filter((r) => r.debit && !r.usage && !r.fee);
	const fees = rows.filter((r) => r.fee);
	return {
		usage: byResource,
		usageTotal: usage.length
			? line(usage, t('Verbrauch gesamt (Aufwand)', 'Usage in all (expense)'), 'debit')
			: null,
		purchases: purchases.length
			? line(
					purchases,
					t(
						'Käufe von Guthaben (Vorauszahlung; Eigenbeleg je Kauf)',
						'Purchases of credits (prepayment; a self-issued receipt per purchase)'
					),
					'credit'
				)
			: null,
		transfersIn: transfersIn.length
			? line(
					transfersIn,
					t('Eingänge von anderen Konten', 'Incoming from other accounts'),
					'credit'
				)
			: null,
		transfersOut: transfersOut.length
			? line(transfersOut, t('Ausgänge an andere Konten', 'Outgoing to other accounts'), 'debit')
			: null,
		fees: fees.length
			? line(fees, t('Netzwerkgebühren (Aufwand)', 'Network fees (expense)'), 'debit')
			: null
	};
}

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
 * @param {string} [p.dataSource] where the entries were read from, when not the chain's usual source
 * @param {string} [p.currency] the statement's currency (DOCUMENT_CURRENCIES), EUR when not
 *   given; the entries are valued in it, and the fields named `eur…` hold values in it
 * @param {Record<string, string>} [p.contracts] asset → contract of a token not in the
 *   chain's list whose balance is in `opening`/`closing` (the reader's balances, #93);
 *   for one that moved in the period its entries name it already
 * @param {import('./language.js').DocumentLanguage} [p.language] `de` (the default) or `en` (language.js)
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
	issuedAt,
	dataSource,
	currency: asked,
	contracts = {},
	language: askedLanguage
}) {
	const currency = documentCurrency(asked);
	const L = documentLanguage(askedLanguage);
	checkValued(entries, currency);
	// An Aleph credit purchase (kind `swap`) is the payment on another chain; the
	// credits it bought are the incoming row. Only that row belongs on the statement.
	const mine = entries.filter(
		(e) => e.account === account && !(e.chain === 'aleph' && e.kind === 'swap')
	);
	const own = mine.filter((e) => e.success !== false);
	// A token not in the list (#93) has no priceAs, but its contract: it gets a section too.
	const assets = [
		...new Set([
			...Object.keys(opening),
			...own.filter((e) => e.priceAs || unlistedContract(e)).map((e) => e.asset)
		])
	];
	const sections = assets.map((asset) => {
		const contract =
			unlistedContract(own.find((e) => e.asset === asset && unlistedContract(e)) ?? {}) ||
			unlistedContract({ listed: false, contract: contracts[asset] });
		let balance = normalize(opening[asset] ?? '0');
		/** @type {StatementRow[]} */
		const rows = [];
		for (const e of own.filter((x) => x.asset === asset)) {
			balance = sum([balance, e.amount]);
			const out = e.amount.startsWith('-');
			rows.push({
				date: e.date,
				time: e.time.slice(11, 19),
				// Filecoin Pay: up to when a settlement paid its rail (the entry's memo).
				text: `${kindText(e, L)}${e.type === 'received' ? say(L, ' (Eingang)', ' (incoming)') : ''}${e.chain === 'filecoin-pay' && e.kind === 'usage' && e.memo ? `, ${localizeLabel(e.memo, L)}` : ''}`,
				counterparty: e.counterpartyLabel
					? `${localizeLabel(e.counterpartyLabel, L)} · ${e.counterparty}`
					: e.counterparty,
				hash: e.hash,
				explorerUrl: e.explorerUrl,
				debit: out ? e.amount.slice(1) : '',
				credit: out ? '' : e.amount,
				balance,
				eur: e.eur?.value ?? '',
				rateSource: e.eur?.value ? e.eur.source : '',
				beleg: belege.get(e.hash) ?? '',
				fee: e.type === 'fee',
				usage: e.kind === 'usage',
				purchase: e.type === 'received' && e.counterparty === 'aleph',
				label: e.counterpartyLabel,
				// Aleph's usage names a resource; a Filecoin Pay settlement is a transaction.
				hashLabel:
					e.kind === 'usage' && e.chain === 'aleph' ? say(L, 'Ressource', 'Resource') : 'Tx'
			});
		}
		const debit = sum(rows.map((r) => r.debit || '0'));
		const credit = sum(rows.map((r) => r.credit || '0'));
		const reported = closing[asset];
		return {
			asset,
			// A token not in the list: its contract, which names it; the symbol is the token's own claim.
			contract,
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
			monthly: monthly(rows, L),
			eurOut: sum(rows.filter((r) => r.debit && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			eurIn: sum(rows.filter((r) => r.credit && r.eur).map((r) => r.eur)),
			eurFees: sum(rows.filter((r) => r.fee && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			eurUsage: sum(rows.filter((r) => r.usage && r.eur).map((r) => r.eur.replace(/^-/, ''))),
			unvalued: rows.filter((r) => !r.eur).length,
			...valuedBy(rows),
			// A token not in the list: each source of its values by name, without its day – no
			// market rate of the usual feeds (CoinGecko by contract, a DEX pool, a reference value).
			...(contract
				? {
						sources: [
							...new Set(rows.filter((r) => r.eur).map((r) => sourceName(r.rateSource ?? '')))
						]
					}
				: {})
		};
	});
	// Aleph credits, Filecoin Pay: a monthly usage statement, laid out as the Kontoauszug.
	const usage = Object.hasOwn(USAGE_NOTES, chain);
	return {
		kind: 'kontoauszug',
		// The German name stays the document's name; an English one adds what it is.
		title: usage
			? say(L, 'Verbrauchsauszug', 'Usage Statement')
			: say(L, 'Kontoauszug', 'Account Statement'),
		usage,
		language: L,
		number: number || `KA-${period.from}`,
		issuedAt: issuedAt ?? new Date().toISOString(),
		holder: { name: payer.name.trim(), address: payer.address.trim() },
		account,
		chain,
		chainName: CHAIN_NAMES[/** @type {keyof typeof CHAIN_NAMES} */ (chain)] ?? chain,
		dataSource: dataSourceOf(
			chain,
			CHAIN_NAMES[/** @type {keyof typeof CHAIN_NAMES} */ (chain)] ?? chain,
			dataSource,
			L
		),
		network,
		testnet: network !== 'mainnet',
		period,
		currency,
		method,
		at,
		sections,
		unlisted: mine.filter((e) => !e.priceAs && !assets.includes(e.asset)).length,
		note: usage ? usageNote(chain, currency, L) : L === 'en' ? STATEMENT_NOTE_EN : STATEMENT_NOTE
	};
}

/** @typedef {ReturnType<typeof buildStatement>} Statement */
