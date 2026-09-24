// From Hibiscus's shapes to the one the app imports.
//
// Hibiscus sends amounts both as German strings (`-22,42`, `1.439,76`) and
// with a decimal point (`1439.76`), dates as ISO (`2026-09-22`, sometimes with
// a time) — see docs/phase-0.md. Money becomes integer cents here, with string
// arithmetic, never through a float.

import { createHash } from 'node:crypto';

/**
 * @param {unknown} value `-22,42`, `1.439,76`, `1439.76`, `1,439.76`, `-5`, or a number
 * @returns {number} integer cents, sign preserved
 */
export function parseAmountCents(value) {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`Not an amount: ${value}`);
		// Through its shortest decimal spelling, so 0.1 + 0.2 style noise cannot creep in.
		return parseAmountCents(String(value));
	}
	let s = String(value ?? '')
		.trim()
		.replace(/[\s ']/g, '')
		.replace(/^\+/, '');
	if (!s) throw new Error('Empty amount');
	let negative = false;
	if (s.startsWith('-') || s.startsWith('−')) {
		negative = true;
		s = s.slice(1);
	} else if (s.endsWith('-')) {
		negative = true;
		s = s.slice(0, -1);
	}
	if (!/^[\d.,]+$/.test(s)) throw new Error(`Not an amount: ${value}`);

	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	/** @type {string} */ let whole;
	/** @type {string} */ let fraction = '';
	if (lastComma > -1 && lastDot > -1) {
		// Both: the later one is the decimal separator.
		const decimal = lastComma > lastDot ? ',' : '.';
		const at = s.lastIndexOf(decimal);
		whole = s.slice(0, at).replace(/[.,]/g, '');
		fraction = s.slice(at + 1);
	} else if (lastComma > -1 || lastDot > -1) {
		const sep = lastComma > -1 ? ',' : '.';
		const parts = s.split(sep);
		// One separator: `22,42`, `1439.76` are decimals. Only a repeated one
		// (`1.439.000`) is grouping; `1.439` stays ambiguous and is refused below.
		if (parts.length > 2) {
			if (!parts.slice(1).every((p) => p.length === 3)) throw new Error(`Not an amount: ${value}`);
			whole = parts.join('');
		} else {
			whole = parts[0];
			fraction = parts[1];
		}
	} else {
		whole = s;
	}
	if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error(`Not an amount: ${value}`);
	if (fraction.length > 2) {
		if (/[1-9]/.test(fraction.slice(2))) throw new Error(`More than cents: ${value}`);
		fraction = fraction.slice(0, 2);
	}
	const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
	if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: ${value}`);
	return negative && cents !== 0 ? -cents : cents;
}

/**
 * @param {unknown} value `2026-09-22`, `2026-09-22 00:00:00`, `20260922T00:00:00`, `22.09.2026`
 * @returns {string | null} `YYYY-MM-DD`
 */
export function parseDate(value) {
	const s = String(value ?? '').trim();
	if (!s) return null;
	let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
	if (!m) m = /^(\d{4})(\d{2})(\d{2})(?:T|$)/.exec(s);
	if (m) return checkedDate(m[1], m[2], m[3], value);
	const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
	if (de) return checkedDate(de[3], de[2].padStart(2, '0'), de[1].padStart(2, '0'), value);
	throw new Error(`Not a date: ${value}`);
}

/** @param {string} y @param {string} m @param {string} d @param {unknown} original */
function checkedDate(y, m, d, original) {
	const iso = `${y}-${m}-${d}`;
	const date = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
		throw new Error(`Not a date: ${original}`);
	}
	return iso;
}

/** @param {unknown} iban */
export function compactIban(iban) {
	return String(iban ?? '')
		.replace(/\s/g, '')
		.toUpperCase();
}

/** @param {unknown} iban */
export function maskIban(iban) {
	const s = compactIban(iban);
	if (s.length <= 8) return s ? '****' : '';
	return `${s.slice(0, 4)} **** ${s.slice(-4)}`;
}

/**
 * @param {unknown} iban
 * @param {string[]} suffixes
 */
export function ibanAllowed(iban, suffixes) {
	const s = compactIban(iban);
	if (!s) return false;
	return suffixes.some((x) => {
		const suffix = compactIban(x);
		return suffix.length > 0 && s.endsWith(suffix);
	});
}

/** Collapse whitespace, so a line break in the purpose does not change the fingerprint. */
function canonical(/** @type {unknown} */ s) {
	return String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * A stable fingerprint for deduplication when the source has no id (or it
 * changed): SHA-256 over account, booking date, amount, purpose and
 * counterparty. The app computes the same for CAMT files (src/lib/bank/fingerprint.js).
 *
 * @param {{ account: string, date: string | null, amountCents: number, purpose?: string, counterpartyName?: string }} tx
 */
export function fingerprint({ account, date, amountCents, purpose, counterpartyName }) {
	const input = [
		'v1',
		account,
		date ?? '',
		String(amountCents),
		canonical(purpose),
		canonical(counterpartyName)
	].join('\u001f');
	return `fp1:${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

/** @param {string} text @param {string} tag e.g. `EREF` */
function sepaField(text, tag) {
	// `EREF+abc MREF+…` or `EREF: abc`; up to the next known tag.
	const m = new RegExp(
		`(?:^|\\s)${tag}[+:]\\s*(.+?)(?=\\s+(?:EREF|MREF|CRED|IBAN|BIC|SVWZ|ABWA|ABWE|KREF|PURP)[+:]|$)`,
		's'
	).exec(text);
	return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * @param {Record<string, any>} account a Hibiscus `konto`
 */
export function normalizeAccount(account) {
	const iban = compactIban(account.iban);
	return {
		id: String(account.id),
		ibanMasked: maskIban(iban),
		ibanLast4: iban.slice(-4),
		name: String(account.bezeichnung || account.name || '').trim(),
		currency: String(account.waehrung || 'EUR').trim() || 'EUR',
		balanceCents:
			account.saldo === undefined || account.saldo === '' ? null : parseAmountCents(account.saldo),
		balanceDate: parseDate(account.saldo_datum)
	};
}

/**
 * @param {Record<string, any>} u a Hibiscus `umsatz`
 * @param {{ id: string, currency?: string }} account
 */
export function normalizeTransaction(u, account) {
	const date = parseDate(u.datum);
	const amountCents = parseAmountCents(u.betrag);
	const purpose = String(u.zweck_raw || [u.zweck, u.zweck2].filter(Boolean).join(' ') || '').trim();
	const counterpartyName = String(u.empfaenger_name ?? '').trim();
	const counterpartyIban =
		compactIban(u.empfaenger_konto) || sepaField(purpose, 'IBAN').replace(/\s/g, '').toUpperCase();
	const endToEndId = String(u.endtoendid ?? '').trim() || sepaField(purpose, 'EREF');
	return {
		sourceId: String(u.id),
		date,
		valueDate: parseDate(u.valuta) ?? date,
		amountCents,
		currency: account.currency || 'EUR',
		counterpartyName,
		counterpartyIban: /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(counterpartyIban)
			? counterpartyIban
			: '',
		purpose,
		endToEndId: endToEndId === 'NOTPROVIDED' ? '' : endToEndId,
		bookingType: String(u.art ?? '').trim(),
		fingerprint: fingerprint({
			account: `hibiscus:${account.id}`,
			date,
			amountCents,
			purpose,
			counterpartyName
		})
	};
}
