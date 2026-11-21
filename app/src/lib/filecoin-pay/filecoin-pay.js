// Filecoin Pay: which own Filecoin wallets have a balance in the payment
// contract of Filecoin Onchain Cloud, and a monthly usage statement for each
// as an Eigenbeleg – as Aleph's credits have (aleph/aleph.js).
//
// Storage there is not paid by a wallet's transfers. The wallet pays USDFC
// *into* the contract (an own transfer, matching/classify.js `payment-contract`),
// and the contract pays the storage providers out of that balance over
// "rails", settled from time to time. No provider sends an invoice. The
// statement documents what left the balance in one month – each settlement
// with its provider, service, split and euro value – with the balance before
// and after, so the tax adviser has a document per payer and period. It is
// an Eigenbeleg (own number range EB-YYYY-NNN) and becomes a receipt like
// any other, not linked to a booking: the expense is in no wallet.
//
// Which wallets: the own Filecoin wallets whose address is an account a
// contract can hold a balance for (f410f…, the form an 0x address is kept
// in). Asked only on "Prüfen" – the index's keeper and Blockscout then see
// the address. What was found is kept in the sealed settings (`filecoinPay`).
//
// The data comes from the bridge (`filecoinpay.statement`), which reads it
// with @le-space/chains/filecoin-pay, read only. The numbers are kept in
// neutral form on the receipt (`selfReceipt.filecoinPay`), so the invoice
// app can later use them.
//
// Limits, said on the card and on the PDF: only USDFC; what a payer itself
// earns over rails is not read; a settlement lags behind the usage it pays.

import { recordEvent } from '../activity/events.js';
import { lastDay } from '../aleph/aleph.js';
import { getSetting, setSetting } from '../store/settings.js';
import { nextSelfNumber } from '@le-space/eigenbeleg/booking';
import { importFile } from '../receipts/import.js';
import { t } from '../i18n/index.js';
import { issuerLogoOf } from '../settings/issuer-logo.js';

/** @typedef {import('../bridge/client.js').FilecoinPayStatement} FilecoinPayStatement */

/**
 * @typedef {object} FilecoinPayAccount a wallet with a balance or rails in Filecoin Pay
 * @property {string} address the wallet's address as the books keep it (f410f…)
 * @property {string} funds the balance when checked, USDFC as a decimal
 * @property {string} lockedUp of it, held for running rails
 * @property {number} rails how many rails the payer has
 * @property {string} checkedAt ISO
 */

/** @typedef {{ accounts: FilecoinPayAccount[] }} FilecoinPaySettings */

/** An account in a contract, in Filecoin's form. */
const PAYER = /^f410f[a-z2-7]{30,60}$/;
const DECIMAL = /^\d{1,40}(\.\d{1,18})?$/;

/** @param {unknown} address */
export const isPayerAddress = (address) => PAYER.test(String(address ?? ''));

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<FilecoinPaySettings>} */
export async function loadFilecoinPay(settings) {
	const v = /** @type {any} */ (await getSetting(settings, 'filecoinPay')) ?? {};
	return {
		accounts: Array.isArray(v.accounts)
			? v.accounts
					.filter((/** @type {any} */ a) => isPayerAddress(a?.address))
					.map((/** @type {any} */ a) => ({
						address: String(a.address),
						funds: DECIMAL.test(String(a.funds)) ? String(a.funds) : '0',
						lockedUp: DECIMAL.test(String(a.lockedUp)) ? String(a.lockedUp) : '0',
						rails: Number.isInteger(a.rails) && a.rails >= 0 ? a.rails : 0,
						checkedAt: String(a.checkedAt ?? '')
					}))
			: []
	};
}

/**
 * The own wallets that can be a payer: on Filecoin, with an address a
 * contract can hold a balance for; each once.
 *
 * @param {{ chain: string, address: string }[]} wallets
 */
export function payerWallets(wallets) {
	/** @type {Map<string, { chain: string, address: string }>} */
	const unique = new Map();
	for (const w of wallets) {
		if (w.chain === 'filecoin' && isPayerAddress(w.address)) unique.set(w.address, w);
	}
	return [...unique.values()];
}

/** The month of `now`, YYYY-MM (UTC). @param {Date} now */
const monthOf = (now) => now.toISOString().slice(0, 7);

/**
 * Ask the bridge which payer wallets have something in Filecoin Pay – a
 * balance, a rail, or a movement this month – and keep those. A wallet that
 * cannot be read keeps what was known of it, and is named in `failed`.
 *
 * @param {object} p
 * @param {{ filecoinPayStatement: (address: string, month: string) => Promise<FilecoinPayStatement> }} p.client
 * @param {import('../store/repository.js').Collection} p.settings
 * @param {{ chain: string, address: string }[]} p.wallets
 * @param {() => Date} [p.now]
 */
export async function scanFilecoinPay({ client, settings, wallets, now = () => new Date() }) {
	const before = await loadFilecoinPay(settings);
	const candidates = payerWallets(wallets);
	const checkedAt = now().toISOString();
	/** @type {FilecoinPayAccount[]} */
	const accounts = [];
	/** @type {{ address: string, error: string }[]} */
	const failed = [];
	let keyed = false;
	for (const w of candidates) {
		try {
			const s = await client.filecoinPayStatement(w.address, monthOf(now()));
			keyed ||= s.blockscoutKey === true;
			if (Number(s.now.funds) > 0 || s.railCount > 0 || s.entries > 0) {
				accounts.push({
					address: w.address,
					funds: s.now.funds,
					lockedUp: s.now.lockedUp,
					rails: s.railCount,
					checkedAt
				});
			}
		} catch (e) {
			failed.push({ address: w.address, error: e instanceof Error ? e.message : String(e) });
			const known = before.accounts.find((a) => a.address === w.address);
			if (known) accounts.push(known);
		}
	}
	await setSetting(settings, 'filecoinPay', { accounts });
	return { asked: candidates.length, accounts, failed, keyed };
}

/** @param {string} address the payer, 0x… as the statement names it @param {string} month */
export const filecoinPayRef = (address, month) => `filecoin-pay:${address.toLowerCase()}:${month}`;

/**
 * The statement of a payer and month, when there is one. The payer by either
 * of its addresses: a receipt keeps both.
 *
 * @param {Record<string, any>[]} receipts
 * @param {string} address f410f… or 0x…
 * @param {string} month
 */
export const findFilecoinPayStatement = (receipts, address, month) =>
	receipts.find((r) => {
		const kept = r.selfReceipt?.filecoinPay;
		return (
			!r.deleted &&
			r.source === 'eigenbeleg' &&
			r.selfReceipt?.kind === 'filecoin-pay-statement' &&
			kept?.month === month &&
			[kept?.address, kept?.filecoinAddress].some(
				(a) => typeof a === 'string' && a.toLowerCase() === address.toLowerCase()
			)
		);
	}) ?? null;

export const FILECOIN_PAY_REASON =
	// eslint-disable-next-line belege/no-german -- text of the Eigenbeleg, a German document (#192)
	'Für Speicher in der Filecoin Onchain Cloud stellt niemand eine Rechnung aus: Die Wallet zahlt USDFC auf ein eigenes Guthaben im Zahlungsvertrag Filecoin Pay ein, und der Vertrag rechnet daraus von Zeit zu Zeit mit den Speicheranbietern ab. Die Einzahlung ist eine eigene Umbuchung; der Aufwand entsteht mit jeder Abrechnung. Dieser Eigenbeleg weist aus, was im Monat aus dem Guthaben an welche Anbieter abgerechnet wurde.';

/** 18 decimals as smallest units. @param {string} amount a non-negative decimal */
const toUnits = (amount) => {
	const [whole, frac = ''] = String(amount).split('.');
	return BigInt((whole || '0') + frac.padEnd(18, '0').slice(0, 18));
};
/** @param {bigint} units */
const fromUnits = (units) => {
	const s = units.toString().padStart(19, '0');
	const frac = s.slice(-18).replace(/0+$/, '');
	return `${s.slice(0, -18)}${frac ? `.${frac}` : ''}`;
};

/**
 * The month by rail: how many settlements, how much, and its euro value
 * (null when a line of it has no rate). In the order of the rails' numbers.
 *
 * @param {FilecoinPayStatement} s
 * @returns {{ railId: string, payee: string, service: string, lines: number, amount: string, eurCents: number | null }[]}
 */
export function byRail(s) {
	/** @type {Map<string, { railId: string, payee: string, service: string, lines: number, units: bigint, eurCents: number | null }>} */
	const rails = new Map();
	for (const u of s.usage) {
		const r = rails.get(u.railId) ?? {
			railId: u.railId,
			payee: u.payee,
			service: u.service,
			lines: 0,
			units: 0n,
			eurCents: /** @type {number | null} */ (0)
		};
		r.lines++;
		r.units += toUnits(u.amount);
		r.eurCents = r.eurCents === null || u.eurCents === null ? null : r.eurCents + u.eurCents;
		rails.set(u.railId, r);
	}
	return [...rails.values()]
		.sort((a, b) => a.railId.localeCompare(b.railId, 'en', { numeric: true }))
		.map(({ units, ...r }) => ({ ...r, amount: fromUnits(units) }));
}

/**
 * A token amount for reading: at most `places` decimals (cut, not rounded –
 * the full number stays on the receipt's record), with a decimal comma.
 *
 * @param {string} amount @param {number} [places]
 */
export function shortAmount(amount, places = 6) {
	const [whole, frac = ''] = String(amount).split('.');
	const cut = frac.slice(0, places).replace(/0+$/, '');
	return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${cut ? `,${cut}` : ''}`;
}

/**
 * @typedef {object} FilecoinPayDocument what the PDF shows
 * @property {string} number EB-YYYY-NNN
 * @property {string} issuer
 * @property {string} walletName
 * @property {FilecoinPayStatement} statement
 * @property {string} reason
 * @property {string} createdAt ISO
 * @property {string} createdBy
 */

/**
 * Make the statement of a payer and month, store it as a receipt.
 *
 * @param {object} p
 * @param {import('../matching/engine.js').MatchingStore} p.store
 * @param {import('../receipts/blob-store.js').BlobStore} p.blobs
 * @param {{ filecoinPayStatement: (address: string, month: string) => Promise<FilecoinPayStatement> }} p.client
 * @param {string} p.address the wallet, f410f… or 0x…
 * @param {string} p.month YYYY-MM
 * @param {FilecoinPayStatement | null} [p.statement] the month as just shown, so it is not asked twice
 * @param {string} [p.walletName] the wallet's name, when it has one
 * @param {string} [p.issuer]
 * @param {string} [p.createdBy]
 * @param {() => Date} [p.now]
 */
export async function createFilecoinPayStatement({
	store,
	blobs,
	client,
	address,
	month,
	statement: shown = null,
	walletName = '',
	issuer = '',
	createdBy = '',
	now = () => new Date()
}) {
	const all = await store.receipts.list({ includeDeleted: true });
	const existing = findFilecoinPayStatement(all, address, month);
	if (existing) {
		throw new Error(t('messages.filecoinPay.exists', { number: existing.selfNumber }));
	}
	const statement =
		shown && shown.month === month ? shown : await client.filecoinPayStatement(address, month);
	if (!statement.usage.length && !statement.deposits.length && !statement.withdrawals.length) {
		throw new Error(t('messages.filecoinPay.nothing'));
	}
	// Asked by one address, answered with the other: the same payer, once.
	const again = findFilecoinPayStatement(all, statement.address, month);
	if (again) throw new Error(t('messages.filecoinPay.exists', { number: again.selfNumber }));

	const created = now();
	const number = nextSelfNumber(all, month.slice(0, 4));
	/** @type {FilecoinPayDocument} */
	const doc = {
		number,
		issuer,
		walletName,
		statement,
		reason: FILECOIN_PAY_REASON,
		createdAt: created.toISOString(),
		createdBy
	};
	const { filecoinPayPdf } = await import('./statement-pdf.js');
	const bytes = await filecoinPayPdf(doc, { issuerLogo: await issuerLogoOf(store) });
	const { record } = await importFile({
		receipts: store.receipts,
		blobs,
		bytes,
		fileName: `${number} Filecoin Pay ${month}.pdf`,
		source: 'eigenbeleg',
		sourceRef: filecoinPayRef(statement.address, month),
		fields: {
			confirmedByUser: true,
			vendor: 'Filecoin Pay (Eigenbeleg)',
			documentDate: lastDay(month),
			amountCents: statement.totals.eurCents ?? 0,
			currency: 'EUR',
			selfNumber: number,
			selfReceipt: {
				kind: 'filecoin-pay-statement',
				counterparty: 'Filecoin Pay',
				description: `Abrechnungen aus dem Filecoin-Pay-Guthaben ${month}`,
				reason: FILECOIN_PAY_REASON,
				createdAt: doc.createdAt,
				createdBy,
				// The numbers, for the invoice app later.
				filecoinPay: {
					address: statement.address,
					filecoinAddress: statement.filecoinAddress,
					month,
					asset: statement.asset,
					opening: statement.opening,
					closing: statement.closing,
					deposits: statement.totals.deposits,
					withdrawals: statement.totals.withdrawals,
					usage: statement.totals.usage,
					eurCents: statement.totals.eurCents,
					settlements: statement.usage.length,
					rails: byRail(statement),
					rateSource: statement.rateSource,
					source: statement.source,
					movementsFrom: statement.movementsFrom
				}
			}
		}
	});
	if (!record) throw new Error(t('messages.filecoinPay.saveFailed'));
	await recordEvent(store.events, 'decision', {
		action: 'filecoin-pay-statement',
		receiptId: record.id,
		number,
		month
	});
	return { receipt: record, number, statement };
}
