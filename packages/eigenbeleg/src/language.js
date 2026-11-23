// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The language of a document (Le-Space/eigenbeleg-agent: English documents).
// German is the default and stays what it was, word for word: the documents
// are made for German bookkeeping. English is for people whose books are kept
// in English, or who need to read what a German document would say; a German
// tax office may ask for a translation of a document in another language
// (§ 87 AO).
//
// English documents keep the German names of the document types beside the
// English ones (Eigenbeleg, Kontoauszug, Verbrauchsauszug): they are what the
// documents are, and what a German bookkeeper looks for.
//
// Numbers in English: a decimal point and thousands commas (`1,234.5`), the
// currency's code after the amount (`12.34 EUR`); dates as ISO (`2026-10-05`),
// which no reader can mistake.

import { normalize, round } from '@le-space/ledger';

/** The languages a document can be written in. */
export const DOCUMENT_LANGUAGES = Object.freeze(/** @type {const} */ (['de', 'en']));

/** @typedef {'de' | 'en'} DocumentLanguage */

/**
 * The language of a document, checked: German when none is given.
 *
 * @param {unknown} [language]
 * @returns {DocumentLanguage}
 */
export function documentLanguage(language = 'de') {
	if (language !== 'de' && language !== 'en') throw new Error('language: de or en');
	return language;
}

/**
 * The German text, or the English one.
 *
 * @param {DocumentLanguage | undefined} language
 * @param {string} de
 * @param {string} en
 */
export const say = (language, de, en) => (language === 'en' ? en : de);

// ---- English formats ----------------------------------------------------------

/** `-1234.5` → `−1,234.5`; keeps every decimal. @param {string} amount */
export function enNumber(amount) {
	const s = normalize(String(amount));
	const neg = s.startsWith('-');
	const [int, frac] = s.replace(/^-/, '').split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${neg ? '−' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** An amount with fixed decimals and no unit: `0.0017` → `0.0017`. @param {string} amount @param {number} places */
export function enFixed(amount, places = 2) {
	const r = round(String(amount), places);
	const [int, frac = ''] = r.replace(/^-/, '').split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${r.startsWith('-') ? '−' : ''}${grouped}${places ? `.${frac.padEnd(places, '0')}` : ''}`;
}

/** `2026-10-05` stays `2026-10-05`. @param {string} date */
export const enDate = (date) => date.slice(0, 10);

// ---- the rates' sources ---------------------------------------------------------

/**
 * A rate's source in the document's language. The sources come as German text
 * (the caller's rates, @le-space/rates' reference value, value.js); an English
 * document names them in English. Each rule matches one known wording; what no
 * rule knows (a name, a contract) stays as it is.
 *
 * @param {string} text
 * @param {DocumentLanguage | undefined} language
 */
export function localizeSource(text, language) {
	if (language !== 'en' || !text) return text;
	return text
		.replace(/(\S+), Kurs (\d{4}-\d{2}-\d{2}) 00:00 UTC/g, '$1, rate of $2 00:00 UTC')
		.replace(/(\S+), Kurs 00:00 UTC/g, '$1, rate at 00:00 UTC')
		.replace(
			/EZB-Referenzkurs ([A-Z]{3})\/([A-Z]{3}) vom (\d{4}-\d{2}-\d{2})/g,
			'ECB reference rate $1/$2 of $3'
		)
		.replace(/EZB-Referenzkurs ([A-Z]{3})\/([A-Z]{3})/g, 'ECB reference rate $1/$2')
		.replace(
			/amtlicher Kurs EUR\/([A-Z]{3}) der Bank von Russland vom (\d{4}-\d{2}-\d{2})/g,
			'official rate EUR/$1 of the Bank of Russia of $2'
		)
		.replace(
			/amtlicher Kurs EUR\/([A-Z]{3}) der Bank von Russland/g,
			'official rate EUR/$1 of the Bank of Russia'
		)
		.replace(
			/Uniswap v(\d), Pool (\S+) bei Block (\d+), gegen den Tageskurs (\d{4}-\d{2}-\d{2}) 00:00 UTC/g,
			"Uniswap v$1, pool $2 at block $3, against the day's rate of $4 00:00 UTC"
		)
		.replace(
			/Uniswap v(\d), Pool (\S+) bei Block (\d+), gegen den Tageskurs/g,
			"Uniswap v$1, pool $2 at block $3, against the day's rate"
		)
		.replace(/Token-Vertrag/g, 'token contract')
		.replace(/Referenzwert von (.+?) \(Standardwert\)/g, 'reference value of $1 (default)')
		.replace(/Referenzwert des Ausstellers/g, "the issuer's reference value")
		.replace(/Referenzwert von /g, 'reference value of ')
		.replace(/, Stand (\d{4}-\d{2}-\d{2})/g, ', as of $1')
		.replace(/\(kein Börsenkurs\)/g, '(no market rate)')
		.replace(/Aleph Kaufpreis ([\d.]+) USD je Credit/g, 'Aleph purchase price $1 USD per credit')
		.replace(/Aleph Listenpreis ([\d.]+) USD je Credit/g, 'Aleph list price $1 USD per credit')
		.replace(/fester Testkurs/g, 'fixed test rate');
}

/**
 * A counterparty's label or a booking's memo in the document's language. The
 * chain readers (@le-space/chains) name the network, an escrow or a purchase in
 * German; an English document names them in English. What no rule knows (an
 * account's own name, a service's name) stays as it is.
 *
 * @param {string} text
 * @param {DocumentLanguage | undefined} language
 */
export function localizeLabel(text, language) {
	if (language !== 'en' || !text) return text;
	return text
		.replace(/^(\S+)-Netzwerk \(Gebühr an Validatoren\)$/, '$1 network (fee to validators)')
		.replace(/^(\S+)-Netzwerk \(Miner-Gebühr\)$/, '$1 network (miner fee)')
		.replace(
			/^(\S+)-Netzwerk \(Miner-Tip und verbrannte Gebühr\)$/,
			'$1 network (miner tip and burnt fee)'
		)
		.replace(/^(.+)-Netzwerk \(Gas\)$/, '$1 network (gas)')
		.replace(/^(\S+)-Netzwerk$/, '$1 network')
		.replace(/^Gebührensammler der Chain$/, "the chain's fee collector")
		.replace(/^Governance-Einlage$/, 'governance deposit')
		.replace(/^Staking \(gebunden\)$/, 'staking (bonded)')
		.replace(/^Staking \(ungebunden\)$/, 'staking (unbonded)')
		.replace(/^Einzahlung in Filecoin Pay$/, 'deposit into Filecoin Pay')
		.replace(/^Auszahlung aus Filecoin Pay$/, 'withdrawal from Filecoin Pay')
		.replace(/^Akash-Escrow \(Deployment\)$/, 'Akash escrow (deployment)')
		.replace(/^IBC-Transfer$/, 'IBC transfer')
		.replace(/^Aleph Cloud \(Kauf von (\S+) Credits/, 'Aleph Cloud (purchase of $1 credits')
		.replace(/^Aleph Cloud \(Kauf /, 'Aleph Cloud (purchase ')
		.replace(/ mit (\S+) auf (\S+)\)$/, ' with $1 on $2)')
		.replace(/ mit (\S+)\)$/, ' with $1)')
		.replace(/; bezahlt mit /, '; paid with ')
		.replace(/^bezahlt bis (\d{4}-\d{2}-\d{2})$/, 'paid up to $1')
		.replace(/^Einmalzahlung$/, 'one-off payment')
		.replace(/^(\d+) Abrechnungen$/, '$1 settlements');
}
