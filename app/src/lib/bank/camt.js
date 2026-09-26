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
 */

/**
 * @typedef {object} CamtStatement
 * @property {string} id
 * @property {{ iban: string, currency: string, name: string }} account
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

/**
 * @param {string} xml
 * @param {{ DOMParser?: typeof DOMParser }} [options] tests pass one (Node has none)
 * @returns {CamtStatement[]}
 */
export function parseCamt053(xml, { DOMParser: Parser = globalThis.DOMParser } = {}) {
	const doc = new Parser().parseFromString(xml, 'application/xml');
	const root = doc.documentElement;
	if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
		throw new Error('Die Datei ist kein gültiges XML.');
	}
	const container = child(root, 'BkToCstmrStmt');
	if (root.localName !== 'Document' || !container) {
		throw new Error('Die Datei ist kein CAMT.053-Kontoauszug (BkToCstmrStmt fehlt).');
	}

	return children(container, 'Stmt').map((stmt) => {
		const acct = child(stmt, 'Acct');
		const iban = text(acct, 'Id', 'IBAN').replace(/\s/g, '').toUpperCase();
		const currency = text(acct, 'Ccy') || 'EUR';
		const account = {
			iban,
			currency,
			name: text(acct, 'Nm') || text(acct, 'Svcr', 'FinInstnId', 'Nm')
		};
		if (!iban) throw new Error('Der Kontoauszug nennt keine IBAN (Acct/Id/IBAN).');

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
			const bookingType = text(ntry, 'AddtlNtryInf') || text(ntry, 'BkTxCd', 'Prtry', 'Cd');
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

			txs.forEach((tx, index) => {
				const sign =
					tx && text(tx, 'CdtDbtInd') ? (text(tx, 'CdtDbtInd') === 'DBIT' ? -1 : 1) : entrySign;
				// One TxDtls: the entry's amount. Several: each its own.
				const amtEl =
					txs.length > 1 ? (child(tx, 'Amt') ?? at(tx, 'AmtDtls', 'TxAmt', 'Amt')) : entryAmt;
				if (!amtEl) throw new Error(`Buchung ohne Betrag am ${date}`);
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
						ref || (entryRef ? (txs.length > 1 ? `${entryRef}/${index + 1}` : entryRef) : null),
					date,
					...(bookedAt ? { bookedAt } : {}),
					valueDate,
					amountCents: sign * camtAmountCents(amtEl.textContent ?? ''),
					currency: amtEl.getAttribute('Ccy') || currency,
					counterpartyName: partyName(child(parties, side)),
					counterpartyIban: text(parties, `${side}Acct`, 'Id', 'IBAN')
						.replace(/\s/g, '')
						.toUpperCase(),
					purpose:
						purpose || text(tx, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref') || text(tx, 'AddtlTxInf'),
					endToEndId: endToEndId === 'NOTPROVIDED' ? '' : endToEndId,
					bookingType,
					bankCode
				});
			});
		}
		return { id: text(stmt, 'Id'), account, transactions, skipped };
	});
}
