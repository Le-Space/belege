// SPDX-License-Identifier: AGPL-3.0-or-later
// The monthly consumption Eigenbeleg (Le-Space/eigenbeleg-agent#116): what a
// prepaid balance paid for in one finished month, where nobody invoices it –
// Aleph Cloud credits used, Filecoin Pay's settlements with storage
// providers, Akash's lease payouts from a deployment's escrow.
//
// Buying the balance (Aleph credits, a deposit into Filecoin Pay, an Akash
// escrow deposit) is a transfer into a prepaid asset; the expense is the
// consumption. So the consumption gets the Eigenbeleg – one per account and
// month, in sums per resource, rail or deployment – and the details (per day,
// per settlement) stay on the usage statement it names. The values are the
// entries' own (valueEntries): the same as the statement's.
//
// Built by buildDocument (`consumption`), numbered after the payments' own
// Eigenbelege, drawn by eigenbelegPdf and written by eigenbelegCsv.

import { normalize, round, sum } from '@le-space/ledger';

import { say } from './language.js';

/** The chains whose consumption gets a monthly Eigenbeleg. */
export const CONSUMPTION_CHAINS = Object.freeze(['aleph', 'filecoin-pay', 'akash']);

const MONTHS_DE = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember'
];
const MONTHS_EN = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** `2026-08` → `August 2026`. @param {string} month @param {import('./language.js').DocumentLanguage} [language] */
export const monthName = (month, language = 'de') =>
	`${(language === 'en' ? MONTHS_EN : MONTHS_DE)[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/**
 * The receipt's subtitle: `Verbrauch August 2026 – kein Rechnungssteller`.
 *
 * @param {string} month @param {import('./language.js').DocumentLanguage} [language]
 */
export const consumptionTitle = (month, language = 'de') =>
	say(
		language,
		`Verbrauch ${monthName(month, 'de')} – kein Rechnungssteller`,
		`Consumption ${monthName(month, 'en')} – no invoicing party`
	);

/**
 * Who was paid and why nobody invoices it, per chain: the recipient line, the reason, what the
 * lines are (a resource, a rail, a deployment) and the note in the box on top.
 *
 * @param {string} chain
 * @param {import('./language.js').DocumentLanguage} [language]
 */
export function consumptionTexts(chain, language = 'de') {
	const en = language === 'en';
	const prepaid = en
		? 'Buying the balance was a prepayment (a transfer into a prepaid asset, on the account statement); the expense is the consumption.'
		: 'Der Kauf des Guthabens war eine Vorauszahlung (eine Umbuchung in ein vorausbezahltes Guthaben, im Kontoauszug); Aufwand ist der Verbrauch.';
	const note = (/** @type {string} */ why) =>
		en
			? `Self-issued receipt for consumption from a prepaid balance. ${why} ${prepaid} Issued by the account holder from the public data the usage statement names.`
			: `Eigenbeleg für Verbrauch aus vorausbezahltem Guthaben. ${why} ${prepaid} Ausgestellt vom Kontoinhaber auf Grundlage der öffentlichen Daten, die der Verbrauchsnachweis nennt.`;
	if (chain === 'aleph') {
		const why = en
			? 'Aleph Cloud bills the use of its resources from the prepaid credits and issues no invoice for it.'
			: 'Aleph Cloud rechnet die Nutzung seiner Ressourcen aus dem vorausbezahlten Guthaben (Credits) ab und stellt dafür keine Rechnung aus.';
		return {
			recipient: en
				? 'Aleph Cloud: consumption billed from the credits, without an invoice'
				: 'Aleph Cloud: Verbrauch aus dem Guthaben (Credits) abgerechnet, ohne Rechnung',
			why,
			line: en ? 'Resource' : 'Ressource',
			note: note(why)
		};
	}
	if (chain === 'filecoin-pay') {
		const why = en
			? "Filecoin Pay's payment contract pays the storage providers from the prepaid balance (USDFC) over rails; no provider issues an invoice."
			: 'Der Zahlungs-Contract von Filecoin Pay zahlt die Speicheranbieter über Rails aus dem vorausbezahlten Guthaben (USDFC); kein Anbieter stellt eine Rechnung aus.';
		return {
			recipient: en
				? 'Storage providers of Filecoin Onchain Cloud, paid by the Filecoin Pay contract, without an invoice'
				: 'Speicheranbieter von Filecoin Onchain Cloud, bezahlt vom Filecoin-Pay-Contract, ohne Rechnung',
			why,
			line: 'Rail',
			note: note(why)
		};
	}
	if (chain === 'akash') {
		const why = en
			? "Akash's providers are paid from each deployment's escrow in ACT (lease payouts); no provider issues an invoice. The chain keeps a deployment's payouts in all, not per month: they are spread evenly over its time up to its last settlement."
			: 'Die Anbieter von Akash werden aus dem Escrow des Deployments in ACT bezahlt (Lease-Auszahlungen); kein Anbieter stellt eine Rechnung aus. Die Chain führt die Auszahlungen je Deployment nur insgesamt, nicht je Monat: Sie sind gleichmäßig auf seine Laufzeit bis zur letzten Abrechnung verteilt.';
		return {
			recipient: en
				? 'Akash providers, paid from the deployments’ escrow, without an invoice'
				: 'Anbieter im Akash-Netzwerk, bezahlt aus dem Escrow der Deployments, ohne Rechnung',
			why,
			line: 'Deployment',
			note: note(why)
		};
	}
	throw new Error(`no consumption Eigenbeleg for chain ${chain}`);
}

/**
 * @typedef {object} ConsumptionLine one resource, rail or deployment in sums
 * @property {string} label what it is (the entries' counterparty label)
 * @property {string} recipient who was paid (the entries' counterparty)
 * @property {number} count how many usage entries (days, settlements) it sums
 * @property {string} first YYYY-MM-DD
 * @property {string} last YYYY-MM-DD
 * @property {Record<string, string>} quantities per asset, positive
 * @property {string} eurExact what it is worth, positive, in the document's currency (only the valued entries)
 * @property {number} unvalued entries without a rate
 * @property {string} detail what the share was taken from (Akash: term, total, share), '' when none
 * @property {import('./value.js').ValuedEntry[]} entries
 */

/**
 * @typedef {object} ConsumptionReceipt one account's consumption in one month
 * @property {string} number
 * @property {string} chain
 * @property {string} account
 * @property {string} month YYYY-MM
 * @property {{ from: string, to: string }} period
 * @property {string} statementNumber the usage statement (or Kontoauszug) the details are on, '' when none
 * @property {ConsumptionLine[]} lines
 * @property {{ quantities: Record<string, string>, eur: string, eurExact: string }} totals
 * @property {number} unvalued
 * @property {string[]} sources the rates' names, without their day
 * @property {string} title `Verbrauch August 2026 – kein Rechnungssteller`
 * @property {string} recipient
 * @property {string} why
 * @property {string} lineName what a line is: Ressource, Rail, Deployment
 * @property {string} note
 */

/** Usage of an account in a month: what a consumption Eigenbeleg sums. @param {import('./value.js').ValuedEntry} e @param {string} account @param {string} month */
export const isConsumption = (e, account, month) =>
	e.kind === 'usage' &&
	e.type === 'sent' &&
	e.success &&
	e.account === account &&
	e.date.startsWith(month);

/** The last day of a month: `2026-02` → `2026-02-28`. @param {string} month */
export const lastDayOf = (month) => {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * One account's consumption in one month, in sums per resource, rail or deployment.
 *
 * @param {object} p
 * @param {string} p.chain aleph, filecoin-pay or akash
 * @param {string} p.account
 * @param {string} p.month YYYY-MM, a finished one
 * @param {import('./value.js').ValuedEntry[]} p.entries valued; those of other accounts, months and kinds are left aside
 * @param {string} p.number
 * @param {string} [p.statementNumber]
 * @param {number} p.places the document currency's decimals
 * @param {(source: string) => string} p.sourceOf a rate's name as the document prints it
 * @param {import('./language.js').DocumentLanguage} [p.language]
 * @returns {ConsumptionReceipt}
 */
export function buildConsumption({
	chain,
	account,
	month,
	entries,
	number,
	statementNumber = '',
	places,
	sourceOf,
	language = 'de'
}) {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('consumption: month as YYYY-MM');
	const texts = consumptionTexts(chain, language);
	const mine = entries.filter((e) => isConsumption(e, account, month));
	/** @type {Map<string, import('./value.js').ValuedEntry[]>} */
	const groups = new Map();
	for (const e of mine) {
		// As the usage statement sums them (statement.js `monthly`): by what was used.
		const key = `${e.counterparty}\u0000${e.counterpartyLabel}`;
		groups.set(key, [...(groups.get(key) ?? []), e]);
	}
	/** @param {import('./value.js').ValuedEntry[]} es */
	const quantities = (es) => {
		/** @type {Record<string, string>} */
		const q = {};
		for (const asset of new Set(es.map((e) => e.asset)))
			q[asset] = normalize(
				sum(es.filter((e) => e.asset === asset).map((e) => e.amount)).replace(/^-/, '')
			);
		return q;
	};
	/** @param {import('./value.js').ValuedEntry[]} es */
	const worth = (es) => {
		const valued = es.filter((e) => e.eur);
		return valued.length
			? sum(valued.map((e) => /** @type {any} */ (e.eur).value)).replace(/^-/, '')
			: '0';
	};
	/** @type {ConsumptionLine[]} */
	const lines = [...groups.values()].map((es) => {
		const dates = es.map((e) => e.date).sort();
		const memos = [...new Set(es.map((e) => e.memo).filter(Boolean))];
		return {
			label: es[0].counterpartyLabel || es[0].counterparty,
			recipient: es[0].counterparty,
			count: es.length,
			first: dates[0],
			last: /** @type {string} */ (dates.at(-1)),
			quantities: quantities(es),
			eurExact: worth(es),
			unvalued: es.filter((e) => !e.eur).length,
			// Akash: one entry per deployment, its memo says how its share was taken.
			detail: chain === 'akash' && memos.length === 1 ? memos[0] : '',
			entries: es
		};
	});
	lines.sort((a, b) => a.label.localeCompare(b.label) || a.recipient.localeCompare(b.recipient));
	const eurExact = worth(mine);
	return {
		number,
		chain,
		account,
		month,
		period: { from: `${month}-01`, to: lastDayOf(month) },
		statementNumber,
		lines,
		totals: { quantities: quantities(mine), eur: round(eurExact, places), eurExact },
		unvalued: mine.filter((e) => !e.eur).length,
		sources: [
			...new Set(mine.filter((e) => e.eur).map((e) => sourceOf(/** @type {any} */ (e.eur).source)))
		],
		title: consumptionTitle(month, language),
		recipient: texts.recipient,
		why: texts.why,
		lineName: texts.line,
		note: texts.note
	};
}
