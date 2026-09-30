import { t } from '../i18n/index.js';
import { isWise, readWiseLine } from './wise.js';
// CAMT.053 (bank-to-customer statement) in the browser, with DOMParser.
//
// For banks Hibiscus cannot fetch (Revolut). Reads versions .001.02 to
// .001.08 alike by matching local element names, whatever the namespace:
//
//   Stmt/Acct/Id/IBAN, Acct/Ccy, Acct/Nm           → the account
//   Ntry/BookgDt, ValDt (Dt or DtTm)                → dates
//   Ntry/Amt + CdtDbtInd, or TxDtls/Amt             → signed cents
//   TxDtls/RltdPties/{Dbtr,Cdtr}[/Pty]/Nm, …Acct/Id/IBAN → counterparty
//     (the creditor for a debit, the debtor for a credit)
//   TxDtls/RmtInf/Ustrd (all of them)               → purpose
//   TxDtls/Refs/EndToEndId                          → end-to-end id
//   TxDtls/Refs/AcctSvcrRef, else Ntry/AcctSvcrRef  → sourceId
//   Ntry/AddtlNtryInf, else BkTxCd/Prtry/Cd         → booking type
//   Ntry/BkTxCd/Domn/{Cd, Fmly/Cd, Fmly/SubFmlyCd}  → bank code, e.g.
//     ACMT/MDOP/CHRG (ISO 20022: a charge – a bank fee, see classify.js)
//
// An account without an IBAN (issue #218, Wise): Acct/Id/Othr/Id with its
// issuer and scheme identifies it. An entry without any TxDtls takes its
// purpose from AddtlNtryInf, its sourceId from BkTxCd/Prtry/Cd, and its
// booking type from that code's kind (`CARD-123` → CARD); Wise's lines are
// read for the merchant and the fee's payment (wise.js). AmtDtls/TxAmt with
// CcyXchg is kept as the original amount, currency and rate.
//
// Only booked entries (Sts BOOK) are returned; pending ones are counted.
// An entry with several TxDtls (a batch) becomes one transaction per TxDtls.

/**
 * @typedef {object} CamtTransaction
 * @property {string | null} sourceId
 * @property {string} date YYYY-MM-DD
 * @property {string} [bookedAt] ISO 8601 with offset, when the bank gives the time (BookgDt/DtTm)
 * @property {string} valueDate
 * @property {number} amountCents
 * @property {string} currency
 * @property {string} counterpartyName
 * @property {string} counterpartyIban
 * @property {string} purpose
 * @property {string} endToEndId
 * @property {string} bookingType
 * @property {string} bankCode ISO 20022 domain/family/sub-family, '' when the bank sends none
 * @property {string} [txRef] a reference shared with another entry (a fee and its payment)
 * @property {{ amount: string, currency: string, rate?: string }} [original] the amount in the currency it was paid in
 */

/**
 * @typedef {object} CamtStatement
 * @property {string} id
 * @property {{ iban: string, otherId: string, issuer: string, scheme: string, currency: string, name: string }} account
 *   `iban`, or – without one – `otherId` with who issued it and under which scheme
 * @property {CamtTransaction[]} transactions
 * @property {number} skipped entries that were not booked
 */

/** @param {Element | null | undefined} el @param {string} name */
function child(el, name) {
	if (!el) return null;
	for (let n = el.firstChild; n; n = n.nextSibling) {
		if (n.nodeType === 1 && /** @type {Element} */ (n).localName === name)
			return /** @type {Element} */ (n);
	}
	return null;
}

/** @param {Element | null | undefined} el @param {string} name */
function children(el, name) {
	/** @type {Element[]} */
	const out = [];
	if (!el) return out;
	for (let n = el.firstChild; n; n = n.nextSibling) {
		if (n.nodeType === 1 && /** @type {Element} */ (n).localName === name)
			out.push(/** @type {Element} */ (n));
	}
	return out;
}

/** @param {Element | null | undefined} el @param {...string} path */
function at(el, ...path) {
	/** @type {Element | null | undefined} */
	let cur = el;
	for (const name of path) cur = child(cur, name);
	return cur ?? null;
}

/** @param {Element | null | undefined} el @param {...string} path */
function text(el, ...path) {
	return (at(el, ...path)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** `12.34` (CAMT always uses a point) → 1234 */
export function camtAmountCents(/** @type {string} */ value) {
	const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!m) throw new Error(`Not a CAMT amount: ${value}`);
	const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
	if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: ${value}`);
	return cents;
}

/** @param {Element | null} dateEl BookgDt / ValDt */
function dateOf(dateEl) {
	const s = text(dateEl, 'Dt') || text(dateEl, 'DtTm');
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
	return m ? m[1] : '';
}

/**
 * The booking time, when the bank gives one with its offset: `DtTm`
 * (Revolut, for card payments to the second). A time without an offset says
 * nothing sure and is left out.
 *
 * @param {Element | null} dateEl BookgDt
 */
function timeOf(dateEl) {
	const s = text(dateEl, 'DtTm');
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) ? s : '';
}

/** A party's name: `Cdtr/Nm` (.02) or `Cdtr/Pty/Nm` (.08). */
function partyName(/** @type {Element | null} */ party) {
	return text(party, 'Nm') || text(party, 'Pty', 'Nm');
}

/** An IBAN's shape, after spaces are gone. */
const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/**
 * The other side's IBAN: `Acct/Id/IBAN`, or – some banks put it there –
 * `Acct/Id/Othr/Id` when that has an IBAN's shape (issue #176).
 *
 * @param {Element | null} parties
 * @param {string} side `Dbtr` or `Cdtr`
 */
function counterpartyIbanOf(parties, side) {
	const clean = (/** @type {string} */ s) => s.replace(/\s/g, '').toUpperCase();
	const iban = clean(text(parties, `${side}Acct`, 'Id', 'IBAN'));
	if (iban) return iban;
	const other = clean(text(parties, `${side}Acct`, 'Id', 'Othr', 'Id'));
	return IBAN_SHAPE.test(other) ? other : '';
}

/**
 * @param {string} xml
 * @param {{ DOMParser?: typeof DOMParser }} [options] tests pass one (Node has none)
 * @returns {CamtStatement[]}
 */
export function parseCamt053(xml, { DOMParser: Parser = globalThis.DOMParser } = {}) {
	const doc = new Parser().parseFromString(xml, 'application/xml');
	const root = doc.documentElement;
	if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
		throw new Error(t('messages.camt.notXml'));
	}
	const container = child(root, 'BkToCstmrStmt');
	if (root.localName !== 'Document' || !container) {
		throw new Error(t('messages.camt.notCamt'));
	}

	return children(container, 'Stmt').map((stmt) => {
		const acct = child(stmt, 'Acct');
		const iban = text(acct, 'Id', 'IBAN').replace(/\s/g, '').toUpperCase();
		const otherId = iban ? '' : text(acct, 'Id', 'Othr', 'Id').replace(/\s/g, '');
		const currency = text(acct, 'Ccy') || 'EUR';
		const servicer = text(acct, 'Svcr', 'FinInstnId', 'Nm');
		const account = {
			iban,
			otherId,
			issuer: text(acct, 'Id', 'Othr', 'Issr'),
			scheme:
				text(acct, 'Id', 'Othr', 'SchmeNm', 'Prtry') || text(acct, 'Id', 'Othr', 'SchmeNm', 'Cd'),
			currency,
			// Without an IBAN one servicer may keep several accounts: name the currency too.
			name: text(acct, 'Nm') || (iban ? servicer : [servicer, currency].filter(Boolean).join(' '))
		};
		if (!iban && !otherId) throw new Error(t('messages.camt.noIban'));
		const wise = isWise(servicer);

		/** @type {CamtTransaction[]} */
		const transactions = [];
		let skipped = 0;
		for (const ntry of children(stmt, 'Ntry')) {
			const status = text(ntry, 'Sts', 'Cd') || text(ntry, 'Sts');
			if (status && status !== 'BOOK') {
				skipped++;
				continue;
			}
			const entryAmt = child(ntry, 'Amt');
			const entrySign = text(ntry, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
			const date = dateOf(child(ntry, 'BookgDt'));
			const bookedAt = timeOf(child(ntry, 'BookgDt'));
			const valueDate = dateOf(child(ntry, 'ValDt')) || date;
			const code = text(ntry, 'BkTxCd', 'Prtry', 'Cd');
			const info = text(ntry, 'AddtlNtryInf');
			const bare = children(ntry, 'NtryDtls').length === 0;
			// `CARD-123`: the kind before the number; a bare id has none.
			const kind = /^([A-Z][A-Z_]*)-/.exec(code)?.[1] ?? '';
			const bookingType = bare ? kind || info || code : info || code;
			const exchange = at(ntry, 'AmtDtls', 'TxAmt');
			const bankCode = [
				text(ntry, 'BkTxCd', 'Domn', 'Cd'),
				text(ntry, 'BkTxCd', 'Domn', 'Fmly', 'Cd'),
				text(ntry, 'BkTxCd', 'Domn', 'Fmly', 'SubFmlyCd')
			]
				.filter(Boolean)
				.join('/');
			const entryRef = text(ntry, 'AcctSvcrRef') || text(ntry, 'NtryRef');
			const details = children(ntry, 'NtryDtls').flatMap((d) => children(d, 'TxDtls'));
			const txs = details.length ? details : [null];

			// An entry without details: its line of text is all there is to say.
			const line = bare ? (wise ? readWiseLine({ purpose: info, code }) : {}) : null;
			// The amount in the currency it was paid in: TxAmt where that is another
			// currency than the entry's, else what the line says (Wise gives TxAmt in
			// the account's currency and names the paid amount in its text).
			const paid = child(exchange, 'Amt');
			const entryCcy = entryAmt?.getAttribute('Ccy') || currency;
			const rate = text(exchange, 'CcyXchg', 'XchgRate');
			const foreign =
				paid && (paid.getAttribute('Ccy') || entryCcy) !== entryCcy
					? { amount: (paid.textContent ?? '').trim(), currency: paid.getAttribute('Ccy') ?? '' }
					: (line?.original ?? null);
			const original =
				foreign && foreign.currency && foreign.currency !== entryCcy
					? { ...foreign, ...(rate ? { rate } : {}) }
					: null;

			txs.forEach((tx, index) => {
				const sign =
					tx && text(tx, 'CdtDbtInd') ? (text(tx, 'CdtDbtInd') === 'DBIT' ? -1 : 1) : entrySign;
				// One TxDtls: the entry's amount. Several: each its own.
				const amtEl =
					txs.length > 1 ? (child(tx, 'Amt') ?? at(tx, 'AmtDtls', 'TxAmt', 'Amt')) : entryAmt;
				if (!amtEl) throw new Error(t('messages.camt.noAmount', { date }));
				const parties = child(tx, 'RltdPties');
				const side = sign < 0 ? 'Cdtr' : 'Dbtr';
				const endToEndId = text(tx, 'Refs', 'EndToEndId');
				const ref = text(tx, 'Refs', 'AcctSvcrRef') || text(tx, 'Refs', 'TxId');
				const purpose = children(child(tx, 'RmtInf'), 'Ustrd')
					.map((u) => (u.textContent ?? '').replace(/\s+/g, ' ').trim())
					.filter(Boolean)
					.join(' ');
				transactions.push({
					sourceId:
						ref ||
						(entryRef ? (txs.length > 1 ? `${entryRef}/${index + 1}` : entryRef) : null) ||
						(bare && code ? code : null),
					date,
					...(bookedAt ? { bookedAt } : {}),
					valueDate,
					amountCents: sign * camtAmountCents(amtEl.textContent ?? ''),
					currency: amtEl.getAttribute('Ccy') || currency,
					counterpartyName: partyName(child(parties, side)) || line?.counterpartyName || '',
					counterpartyIban: counterpartyIbanOf(parties, side),
					purpose:
						purpose ||
						text(tx, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref') ||
						text(tx, 'AddtlTxInf') ||
						(bare ? info : ''),
					endToEndId: endToEndId === 'NOTPROVIDED' ? '' : endToEndId,
					bookingType: line?.bookingType ?? bookingType,
					bankCode,
					...(line?.txRef ? { txRef: line.txRef } : {}),
					...(original ? { original } : {})
				});
			});
		}
		return { id: text(stmt, 'Id'), account, transactions, skipped };
	});
}
