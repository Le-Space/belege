// German formatting, grouping and search for the Zahlungen view. Pure, so it
// is tested without a database or a browser.

const DAY = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: 'numeric',
	month: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});
const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT_DATE = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'UTC'
});

/** @type {Map<string, Intl.NumberFormat>} */
const moneyFormats = new Map();

/**
 * `-22,42 EUR`, `1.439,76 EUR` (the space is a no-break space).
 *
 * @param {number} cents
 * @param {string} [currency]
 */
export function formatMoney(cents, currency = 'EUR') {
	const code = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
	let format = moneyFormats.get(code);
	if (!format) {
		format = new Intl.NumberFormat('de-DE', {
			style: 'currency',
			currency: code,
			currencyDisplay: 'code'
		});
		moneyFormats.set(code, format);
	}
	return format.format(cents / 100);
}

/**
 * A booking's euro amount; a crypto quantity worth less than a cent is
 * `< 0,01 EUR` (in) or `> -0,01 EUR` (out), not `0,00 EUR`, which reads
 * as if the value were missing.
 *
 * @param {Record<string, any>} tx
 */
export function formatTxAmount(tx) {
	const cents = Number(tx.amountCents ?? 0);
	const q = typeof tx.quantity === 'string' ? tx.quantity : '';
	if (cents === 0 && /^-?\d+$/.test(q) && BigInt(q) !== 0n) {
		return BigInt(q) > 0n
			? `< ${formatMoney(1, tx.currency)}`
			: `> ${formatMoney(-1, tx.currency)}`;
	}
	return formatMoney(cents, tx.currency);
}

const BERLIN_TIME = new Intl.DateTimeFormat('de-DE', {
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Europe/Berlin'
});
const BERLIN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' });
const BERLIN_SHORT_DAY = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	timeZone: 'Europe/Berlin'
});

/**
 * A booking's time in German time: `14:32`, or `31.08. 01:15` when that is
 * another day than the booking day (a wallet or an exchange books by the UTC
 * day). '' when the source gave no time.
 *
 * @param {Record<string, any>} tx
 */
export function formatBookingTime(tx) {
	const ms = typeof tx?.bookedAt === 'string' ? Date.parse(tx.bookedAt) : NaN;
	if (!Number.isFinite(ms)) return '';
	const time = BERLIN_TIME.format(ms);
	return BERLIN_DAY.format(ms) === tx.bookedOn ? time : `${BERLIN_SHORT_DAY.format(ms)} ${time}`;
}

/**
 * `Geschäftskonto ···1234`, or just `Kraken BTC` for an account without an IBAN.
 *
 * @param {Record<string, any>} account a stored account record
 */
export function accountLabel(account) {
	const last4 = String(account?.ibanLast4 ?? '');
	return `${account?.name ?? ''}${last4 ? ` ···${last4}` : ''}`;
}

/** `2026-09-22` → `Dienstag, 22.9.2026` */
export function formatDayHeading(/** @type {string} */ isoDate) {
	return DAY.format(new Date(`${isoDate}T00:00:00Z`));
}

/** `2026-09` → `September 2026` */
export function formatMonth(/** @type {string} */ month) {
	return /^\d{4}-\d{2}$/.test(month)
		? MONTH.format(new Date(`${month}-01T00:00:00Z`))
		: 'Ohne Datum';
}

/** `2026-09-22` → `22.09.2026` */
export function formatDate(/** @type {string} */ isoDate) {
	return SHORT_DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

/** @param {{ receiptId?: string | null }} tx */
export function hasReceipt(tx) {
	return Boolean(tx.receiptId);
}

/**
 * @typedef {{ id: string, bookedOn: string, amountCents?: number, counterparty?: string, purpose?: string, receiptId?: string | null }} TxLike
 */

/**
 * Months, newest first, with how many transactions and how many of them have
 * a receipt.
 *
 * @template {TxLike} T
 * @param {T[]} transactions
 * @param {(tx: T) => boolean} [covered] has a receipt or needs none; by default a linked receipt
 * @returns {{ month: string, label: string, count: number, withReceipt: number, coverage: number }[]}
 */
export function monthSummaries(transactions, covered = hasReceipt) {
	/** @type {Map<string, { count: number, withReceipt: number }>} */
	const months = new Map();
	for (const tx of transactions) {
		const month = String(tx.bookedOn ?? '').slice(0, 7) || 'unbekannt';
		const m = months.get(month) ?? { count: 0, withReceipt: 0 };
		m.count++;
		if (covered(tx)) m.withReceipt++;
		months.set(month, m);
	}
	return [...months.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([month, m]) => ({
			month,
			label: formatMonth(month),
			count: m.count,
			withReceipt: m.withReceipt,
			coverage: m.count ? Math.round((m.withReceipt / m.count) * 100) : 0
		}));
}

/**
 * Transactions grouped by booking day, newest day first; inside a day, the
 * order they came in (newest id first).
 *
 * @template {TxLike} T
 * @param {T[]} transactions
 * @returns {{ day: string, label: string, items: T[] }[]}
 */
export function groupByDay(transactions) {
	/** @type {Map<string, T[]>} */
	const days = new Map();
	for (const tx of transactions) {
		const day = String(tx.bookedOn ?? '');
		const items = days.get(day) ?? [];
		items.push(tx);
		days.set(day, items);
	}
	return [...days.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([day, items]) => ({
			day,
			label: /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDayHeading(day) : 'Ohne Datum',
			items: items.sort((x, y) => (x.id < y.id ? 1 : x.id > y.id ? -1 : 0))
		}));
}

/** The ways a person types an amount: `22,42`, `22.42`, `1.439,76`, `1439,76`, `-22,42`. */
function amountSpellings(/** @type {number} */ cents) {
	const abs = Math.abs(cents);
	const euros = Math.floor(abs / 100);
	const rest = String(abs % 100).padStart(2, '0');
	const grouped = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	const plain = [`${euros},${rest}`, `${euros}.${rest}`, `${grouped},${rest}`];
	return [...plain, ...plain.map((s) => (cents < 0 ? `-${s}` : `+${s}`))];
}

/** The ways a person types a date: `22.9.2026`, `22.09.2026`, `22.09.`, `2026-09-22`. */
function dateSpellings(/** @type {string} */ iso) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return [];
	const [, y, mo, d] = m;
	const dn = String(Number(d));
	const mn = String(Number(mo));
	return [iso, `${d}.${mo}.${y}`, `${dn}.${mn}.${y}`, `${d}.${mo}.`, `${dn}.${mn}.`];
}

/**
 * Does a transaction match what was typed into the search box? Name and
 * purpose by substring (case-insensitive); an amount or a date by any of the
 * usual spellings, also as a prefix (`22,4` finds `22,42`).
 *
 * @param {TxLike} tx
 * @param {string} query
 */
export function matchesSearch(tx, query) {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const texts = [tx.counterparty, tx.purpose].map((s) => String(s ?? '').toLowerCase());
	if (texts.some((t) => t.includes(q))) return true;
	const compact = q.replace(/\s|€|eur/g, '');
	if (/^[+-]?[\d.,]+$/.test(compact)) {
		if (amountSpellings(tx.amountCents ?? 0).some((s) => s.startsWith(compact))) return true;
	}
	return dateSpellings(tx.bookedOn).some((s) => s.startsWith(q));
}

// SEPA tags a bank puts into the raw purpose (DFÜ-Abkommen): `EREF+…` or `EREF: …`.
const SEPA_TAG =
	/(?:^|\s)(EREF|KREF|MREF|CRED|DEBT|COAM|OAMT|SVWZ|ABWA|ABWE|IBAN|BIC|PURP)\s*[:+]\s*/g;

// What GLS appends to an order made in its app: the TAN method, not the purpose.
const TAN_NOISE =
	/(?:^|[\s,;/|-]+)(?:TAN[- ]?(?:Verfahren)?:?\s*)?(?:SecureGo(?:\s*plus)?|pushTAN|chipTAN(?:\s*(?:QR|optisch|manuell|USB|comfort))?|smsTAN|mobileTAN|photoTAN|appTAN)(?=$|[\s,;/|-])/gi;

/** @param {string} text */
function withoutTanNoise(text) {
	return text.replace(TAN_NOISE, '').replace(/\s+/g, ' ').trim();
}

/**
 * The part of a raw purpose a person wants to read: the `SVWZ` value when the
 * bank tags it, otherwise the text in front of the first tag (GLS puts
 * "Kundennummer … Rechnungsnummer …" there and tags only EREF, MREF, CRED,
 * IBAN, BIC). The TAN method GLS appends ("SecureGo plus", "pushTAN",
 * "chipTAN") is dropped. The raw text stays stored: matching needs the
 * references.
 *
 * @param {string | null | undefined} raw
 */
export function displayPurpose(raw) {
	const text = withoutTanNoise(String(raw ?? ''));
	/** @type {{ tag: string, start: number, end: number }[]} */
	const tags = [];
	for (const m of text.matchAll(SEPA_TAG)) {
		tags.push({ tag: m[1], start: m.index, end: m.index + m[0].length });
	}
	if (!tags.length) return text;
	const svwz = tags.findIndex((t) => t.tag === 'SVWZ');
	if (svwz > -1) {
		const value = text.slice(tags[svwz].end, tags[svwz + 1]?.start ?? text.length).trim();
		if (value) return value;
	}
	return text.slice(0, tags[0].start).trim() || text;
}
