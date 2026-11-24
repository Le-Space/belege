// "Übernehmen": the person confirms a booking's account and BU key. Stored on
// the transaction as `booking: { account, taxKey, confirmedAt }` (sealed like
// every record); a booking whose receipt names a vendor teaches that vendor
// the account (partners.js `learnAccount`). A reward or a purchase of Aleph
// credits has no receipt to learn from: another account confirmed there
// becomes the rule's account in the settings (suggest.js `accountRuleOf`).
// One event in the Verlauf.

import { cleanPrivateShare } from './private-share.js';
import { valueCents } from '../assets/quantity.js';
import { recordEvent } from '../activity/events.js';
import { cleanMatchingSettings } from '../matching/classify.js';
import { learnAccount } from '../matching/partners.js';
import { matchesOfTx } from '../matching/view.js';
import { getSetting, setSetting } from '../store/settings.js';
import { cleanDatevSettings } from './settings.js';
import { isAccountNumber } from './skr03.js';
import { t } from '../i18n/index.js';

/** @typedef {import('../matching/engine.js').MatchingStore} MatchingStore */

/**
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {{ account: string, taxKey?: string, privateShare?: unknown }} booking
 *   `privateShare`: the part that is private use, `{ percent, account }` (private-share.js); null: none, and
 *   the vendor is remembered as booked whole; left out: none, and nothing about it is learned
 * @param {{ log?: boolean, now?: () => Date, rule?: import('./suggest.js').AccountRule | null }} [options]
 *   `rule`: the booking is one a rule of the settings suggests (suggest.js `accountRuleOf`); another
 *   account confirmed becomes that rule's account
 */
export async function confirmBooking(
	store,
	transactionId,
	{ account, taxKey = '', privateShare },
	{ log = true, now = () => new Date(), rule = null } = {}
) {
	const number = String(account ?? '').trim();
	const key = String(taxKey ?? '').trim();
	if (!isAccountNumber(number)) throw new Error(t('messages.booking.accountDigits'));
	if (!/^\d{0,4}$/.test(key)) throw new Error(t('messages.booking.taxKeyDigits'));
	const share = cleanPrivateShare(privateShare);
	// Something was given and it cannot be a share: say so, book nothing.
	if (privateShare && !share) throw new Error(t('messages.booking.privateShare'));
	if (share && share.account === number) throw new Error(t('messages.booking.privateShareSame'));
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	const record = await store.transactions.put({
		...tx,
		booking: {
			account: number,
			taxKey: key,
			...(share ? { privateShare: share } : {}),
			confirmedAt: now().toISOString()
		},
		// Confirmed again after a change on re-import: looked at.
		importChange: null
	});
	const [first] = matchesOfTx(
		transactionId,
		await store.matches.list({ where: (m) => m.transactionId === transactionId })
	);
	const receipt = first ? await store.receipts.get(first.receiptId) : null;
	let learned = false;
	if (store.partners && receipt) {
		const { companyNames } = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
		learned = Boolean(
			await learnAccount(
				store.partners,
				receipt,
				tx,
				{
					account: number,
					taxKey: key,
					...(privateShare === undefined ? {} : { privateShare: share })
				},
				{ companyNames }
			)
		);
	}
	const ruleLearned = rule ? await learnRuleAccount(store, rule, number) : false;
	if (log) {
		await recordEvent(store.events, 'decision', {
			action: 'booking',
			transactionId,
			account: number,
			taxKey: key,
			...(share ? { privateShare: share } : {}),
			learned,
			...(ruleLearned ? { rule } : {})
		});
	}
	return record;
}

/**
 * The rule's account in the settings follows what the person confirmed.
 *
 * @param {MatchingStore} store
 * @param {import('./suggest.js').AccountRule} rule
 * @param {string} number
 * @returns {Promise<boolean>} whether it changed
 */
async function learnRuleAccount(store, rule, number) {
	if (!store.settings) return false;
	const field = rule === 'reward' ? 'rewardAccount' : 'cloudCreditsAccount';
	const stored = await getSetting(store.settings, 'datev');
	if (cleanDatevSettings(stored)[field] === number) return false;
	await setSetting(store.settings, 'datev', { ...(stored ?? {}), [field]: number });
	return true;
}

/**
 * Several bookings at once, each with its own values (the export page's
 * "Automatische Konten übernehmen"): one event for all.
 *
 * @param {MatchingStore} store
 * @param {{ transactionId: string, account: string, taxKey: string }[]} items
 */
export async function confirmBookings(store, items) {
	for (const item of items) {
		await confirmBooking(store, item.transactionId, item, { log: false });
	}
	if (items.length) {
		await recordEvent(store.events, 'decision', {
			action: 'bookings',
			transactionId: items[0].transactionId,
			count: items.length
		});
	}
}

/**
 * "Geprüft": a person looked at a booking that changed on re-import
 * (bank/import.js `importChange`); the mark goes, the booking stays as it is.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 */
export async function acknowledgeImportChange(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx?.importChange) return tx;
	return store.transactions.put({ ...tx, importChange: null });
}

/**
 * A typed rate as a plain decimal: `60.123,40`, `60,123.40` and `0,0042` all
 * read as they are meant, whatever the app's language – a rate is often copied
 * from somewhere else. With both marks the last one is the decimal; a mark used
 * twice groups thousands. One mark before exactly three digits (`58.123`,
 * `1,500`) could be either, a factor of 1000 apart, so it is refused rather
 * than guessed.
 *
 * @param {unknown} text
 * @returns {string} e.g. `60123.4`
 */
export function parseRateInput(text) {
	const s = String(text ?? '').replace(/[\s\u00a0\u202f]/g, '');
	const bad = () => new Error(t('messages.booking.rateFormat'));
	if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) throw bad();
	const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
	if (last < 0) return s;
	const mark = s[last];
	const other = mark === '.' ? ',' : '.';
	/** @param {string} int @param {string} group */
	const grouped = (int, group) =>
		new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(int) ? int.split(group).join('') : null;
	let int;
	let frac = '';
	if (s.includes(other)) {
		// both: the last mark is the decimal, the other groups thousands
		if (s.indexOf(mark) !== last) throw bad();
		int = grouped(s.slice(0, last), other);
		frac = s.slice(last + 1);
	} else if (s.indexOf(mark) !== last) {
		// one mark, several times: thousands only
		int = grouped(s, mark);
	} else {
		int = s.slice(0, last);
		frac = s.slice(last + 1);
		if (/^[1-9]\d{0,2}$/.test(int) && frac.length === 3) {
			throw new Error(t('messages.booking.rateAmbiguous', { value: s }));
		}
	}
	// 0 is a rate too: a token nobody trades any more is worth nothing.
	const clean = frac ? `${int}.${frac}` : `${int}`;
	if (!int || !/^\d+(\.\d{1,18})?$/.test(clean)) throw bad();
	return clean;
}

/**
 * "Kurs von Hand" (issue #162): the euro rate of one unit, for a crypto
 * booking whose rate no source knew (or a person corrects). The euro amount
 * follows from the quantity; the rate says it came by hand, and a later sync
 * leaves it as it is (bank/import.js).
 *
 * @param {{ transactions: import('../store/repository.js').Collection, events: import('../store/repository.js').Collection }} store
 * @param {string} transactionId
 * @param {string} rate EUR per whole unit, as typed (parseRateInput)
 * @param {() => Date} [now]
 */
export async function setManualRate(store, transactionId, rate, now = () => new Date()) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	const clean = parseRateInput(rate);
	if (!/^-?\d+$/.test(String(tx.quantity ?? '')) || !Number.isInteger(tx.decimals)) {
		throw new Error(t('messages.booking.rateNoQuantity'));
	}
	const amountCents = valueCents(String(tx.quantity), tx.decimals, clean);
	await store.transactions.put({
		...tx,
		amountCents,
		valuation: { rate: clean, currency: 'EUR', source: 'manual', at: now().toISOString() },
		rateMissing: null
	});
	await recordEvent(store.events, 'decision', {
		action: 'manual-rate',
		transactionId,
		rate: clean
	});
}
