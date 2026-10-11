// E-invoices (issue #160): since 1 January 2025 every business in Germany
// must be able to receive B2B e-invoices – XRechnung or ZUGFeRD/Factur-X,
// both EN 16931 – and for an e-invoice the XML is the original to keep.
//
// This reads one, without a language model: the business terms of EN 16931
// mapped onto the fields the LLM extraction gives (bridge/src/llm/extract.js),
// so matching, booking and the export treat both alike. Two syntaxes:
//   - UBL 2.1: `Invoice` / `CreditNote` (urn:oasis:names:specification:ubl:…)
//   - UN/CEFACT CII: `CrossIndustryInvoice` (urn:un:unece:uncefact:…)
// Elements are found by their local name along a fixed path, so prefixes do
// not matter. Pure; DOMParser from the browser (tests pass @xmldom's). The
// browser's DOMParser loads no external entity and runs no script.

/** @typedef {Record<string, any>} Extraction the shape of bridge/src/llm/extract.js */

const UBL_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const UBL_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const CII = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';

/** Type codes of a credit note (UNTDID 1001): its amounts are booked negative. */
const CREDIT_CODES = new Set(['381', '261', '262', '296', '308', '532']);

/**
 * Whether bytes are an e-invoice, by the root element of the XML in its first
 * kilobytes: cheap, for the import's sniffing.
 *
 * @param {Uint8Array} bytes
 * @returns {'ubl' | 'cii' | null}
 */
export function sniffEInvoice(bytes) {
	const head = new TextDecoder('utf-8', { fatal: false })
		.decode((bytes ?? new Uint8Array()).subarray(0, 4096))
		.replace(/^\uFEFF/, '');
	if (!/^\s*</.test(head)) return null;
	// The first element that is not the declaration, a comment or a processing instruction.
	const root = /<(?![?!])(?:[\w.-]+:)?([\w.-]+)[\s>/]/.exec(
		head.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '')
	)?.[1];
	if (
		(root === 'Invoice' || root === 'CreditNote') &&
		/ubl:schema:xsd:(Invoice|CreditNote)-2/.test(head)
	) {
		return 'ubl';
	}
	if (root === 'CrossIndustryInvoice' && head.includes(CII)) return 'cii';
	return null;
}

/**
 * @param {Element | null | undefined} node
 * @param {string} name
 * @returns {Element[]}
 */
const kids = (node, name) =>
	node
		? /** @type {Element[]} */ (
				Array.from(node.childNodes).filter((n) => /** @type {any} */ (n).localName === name)
			)
		: [];
/** @param {Element | null | undefined} node @param {...string} path */
function at(node, ...path) {
	/** @type {Element | null} */
	let here = node ?? null;
	for (const name of path) {
		here = /** @type {Element | null} */ (kids(here, name)[0] ?? null);
		if (!here) return null;
	}
	return here;
}
/** @param {Element | null | undefined} node @param {...string} path */
const text = (node, ...path) => String(at(node, ...path)?.textContent ?? '').trim();
/** @param {Element | null | undefined} node @param {...string} path */
function amount(node, ...path) {
	const s = text(node, ...path);
	if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
	return Number(s);
}
/** `20250315` (CII format 102) or `2025-03-15` → `2025-03-15`. @param {string} s */
function day(s) {
	const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s.trim());
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** UNTDID 4461 payment means → the extraction's `payment`. @param {string} code @param {number | null} due */
function paymentOf(code, due) {
	if (due === 0) return 'paid';
	if (['49', '59'].includes(code)) return 'direct_debit';
	if (['48', '54', '55'].includes(code)) return 'card';
	if (['30', '31', '42', '58'].includes(code)) return 'bank_transfer';
	return null;
}

/**
 * The extraction of an e-invoice, as the LLM would give it, and what it is.
 *
 * @param {string} xml
 * @param {{ DOMParser?: typeof DOMParser }} [options]
 * @returns {{ syntax: 'ubl' | 'cii', profile: string, eInvoice: boolean, extraction: Extraction }}
 */
export function readEInvoice(xml, { DOMParser: Parser = globalThis.DOMParser } = {}) {
	const doc = new Parser().parseFromString(xml, 'application/xml');
	const root = doc.documentElement;
	if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
		throw new Error('not XML');
	}
	const ns = root.namespaceURI ?? '';
	if (
		(root.localName === 'Invoice' && ns === UBL_INVOICE) ||
		(root.localName === 'CreditNote' && ns === UBL_CREDIT_NOTE)
	) {
		return readUbl(root);
	}
	if (root.localName === 'CrossIndustryInvoice' && ns === CII) return readCii(root);
	throw new Error('not an e-invoice');
}

/** @param {Element} root */
function readUbl(root) {
	const credit = root.localName === 'CreditNote';
	const typeCode = text(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode');
	const sign = credit || CREDIT_CODES.has(typeCode) ? -1 : 1;
	const seller = at(root, 'AccountingSupplierParty', 'Party');
	const vatId = kids(seller, 'PartyTaxScheme')
		.filter((s) => text(s, 'TaxScheme', 'ID').toUpperCase() === 'VAT')
		.map((s) => text(s, 'CompanyID'))[0];
	const totals = at(root, 'LegalMonetaryTotal');
	const gross = amount(totals, 'TaxInclusiveAmount');
	const due = amount(totals, 'PayableAmount');
	const subtotals = kids(at(root, 'TaxTotal'), 'TaxSubtotal');
	const means = kids(root, 'PaymentMeans')[0];
	const iban = text(means, 'PayeeFinancialAccount', 'ID').replace(/\s/g, '');
	const lines = kids(root, credit ? 'CreditNoteLine' : 'InvoiceLine');
	const period = at(root, 'InvoicePeriod');
	const profile = text(root, 'CustomizationID');
	return {
		syntax: /** @type {const} */ ('ubl'),
		profile,
		eInvoice: true,
		extraction: extraction({
			sign,
			vendor:
				text(seller, 'PartyLegalEntity', 'RegistrationName') || text(seller, 'PartyName', 'Name'),
			vatId,
			number: text(root, 'ID'),
			customer: text(root, 'AccountingCustomerParty', 'Party', 'PartyIdentification', 'ID'),
			issued: day(text(root, 'IssueDate')),
			due: day(text(root, 'DueDate') || text(means, 'PaymentDueDate')),
			from: day(text(period, 'StartDate')),
			to: day(text(period, 'EndDate')),
			currency: text(root, 'DocumentCurrencyCode'),
			net: amount(totals, 'TaxExclusiveAmount'),
			vat: subtotals.map((s) => ({
				rate: amount(s, 'TaxCategory', 'Percent') ?? 0,
				amount: amount(s, 'TaxAmount') ?? 0,
				category: text(s, 'TaxCategory', 'ID')
			})),
			gross,
			payable: due,
			paymentCode: text(means, 'PaymentMeansCode'),
			iban,
			lines: lines.map((l) => ({
				description: text(l, 'Item', 'Name'),
				amount: amount(l, 'LineExtensionAmount') ?? 0
			}))
		})
	};
}

/** @param {Element} root */
function readCii(root) {
	const profile = text(
		root,
		'ExchangedDocumentContext',
		'GuidelineSpecifiedDocumentContextParameter',
		'ID'
	);
	const document = at(root, 'ExchangedDocument');
	const sign = CREDIT_CODES.has(text(document, 'TypeCode')) ? -1 : 1;
	const trade = at(root, 'SupplyChainTradeTransaction');
	const seller = at(trade, 'ApplicableHeaderTradeAgreement', 'SellerTradeParty');
	const vatId = kids(seller, 'SpecifiedTaxRegistration')
		.map((r) => at(r, 'ID'))
		.filter((id) => id?.getAttribute('schemeID') === 'VA')
		.map((id) => String(id?.textContent ?? '').trim())[0];
	const settlement = at(trade, 'ApplicableHeaderTradeSettlement');
	const sums = at(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
	const currency = text(settlement, 'InvoiceCurrencyCode');
	// The VAT total in the invoice's currency (there may be a second one in the accounting currency).
	const taxTotal = kids(sums, 'TaxTotalAmount').find(
		(n) => !n.getAttribute('currencyID') || n.getAttribute('currencyID') === currency
	);
	const means = kids(settlement, 'SpecifiedTradeSettlementPaymentMeans')[0];
	const period = at(settlement, 'BillingSpecifiedPeriod');
	const net = amount(sums, 'TaxBasisTotalAmount');
	const vatSum = taxTotal ? Number(String(taxTotal.textContent).trim()) : null;
	// MINIMUM and BASIC WL carry no lines and are no EN 16931 e-invoice.
	const lean = /minimum|basicwl/i.test(profile);
	return {
		syntax: /** @type {const} */ ('cii'),
		profile,
		eInvoice: !lean,
		extraction: extraction({
			sign,
			vendor: text(seller, 'Name'),
			vatId,
			number: text(document, 'ID'),
			customer: text(trade, 'ApplicableHeaderTradeAgreement', 'BuyerTradeParty', 'ID'),
			issued: day(text(document, 'IssueDateTime', 'DateTimeString')),
			due: day(text(settlement, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString')),
			from: day(text(period, 'StartDateTime', 'DateTimeString')),
			to: day(text(period, 'EndDateTime', 'DateTimeString')),
			currency,
			net,
			vat: kids(settlement, 'ApplicableTradeTax').map((t) => ({
				rate: amount(t, 'RateApplicablePercent') ?? 0,
				amount: amount(t, 'CalculatedAmount') ?? 0,
				category: text(t, 'CategoryCode')
			})),
			gross:
				amount(sums, 'GrandTotalAmount') ?? (net !== null && vatSum !== null ? net + vatSum : null),
			payable: amount(sums, 'DuePayableAmount'),
			paymentCode: text(means, 'TypeCode'),
			iban: text(means, 'PayeePartyCreditorFinancialAccount', 'IBANID').replace(/\s/g, ''),
			lines: kids(trade, 'IncludedSupplyChainTradeLineItem').map((l) => ({
				description: text(l, 'SpecifiedTradeProduct', 'Name'),
				amount:
					amount(
						l,
						'SpecifiedLineTradeSettlement',
						'SpecifiedTradeSettlementLineMonetarySummation',
						'LineTotalAmount'
					) ?? 0
			}))
		})
	};
}

/**
 * @param {object} f
 * @param {number} f.sign -1 for a credit note
 * @param {string} f.vendor
 * @param {string | undefined} f.vatId
 * @param {string} f.number
 * @param {string} f.customer
 * @param {string | null} f.issued
 * @param {string | null} f.due
 * @param {string | null} f.from
 * @param {string | null} f.to
 * @param {string} f.currency
 * @param {number | null} f.net
 * @param {{ rate: number, amount: number, category: string }[]} f.vat
 * @param {number | null} f.gross
 * @param {number | null} f.payable
 * @param {string} f.paymentCode
 * @param {string} f.iban
 * @param {{ description: string, amount: number }[]} f.lines
 * @returns {Extraction}
 */
function extraction(f) {
	const signed = (/** @type {number | null} */ n) => (n === null ? null : round2(f.sign * n));
	const items = f.lines.filter((l) => l.description);
	return {
		document_type: 'invoice',
		vendor: f.vendor || null,
		vendor_vat_id: f.vatId || null,
		invoice_number: f.number || null,
		customer_number: f.customer || null,
		invoice_date: f.issued,
		due_or_debit_date: f.due,
		service_period: f.from && f.to ? { from: f.from, to: f.to } : null,
		currency: /^[A-Z]{3}$/.test(f.currency) ? f.currency : 'EUR',
		net: signed(f.net),
		vat: f.vat
			.filter((v) => v.amount !== 0 || v.rate !== 0)
			.map((v) => ({ rate: v.rate, amount: /** @type {number} */ (signed(v.amount)) })),
		gross: signed(f.gross),
		payment: paymentOf(f.paymentCode, f.payable),
		iban_last4: /^[A-Z]{2}\d{2}[A-Z0-9]{4,}$/.test(f.iban) ? f.iban.slice(-4) : null,
		// AE: VAT reverse charge (§13b UStG).
		reverse_charge: f.vat.some((v) => v.category === 'AE'),
		travel: null,
		summary: items
			.map((l) => l.description)
			.join(', ')
			.split(/\s+/)
			.slice(0, 12)
			.join(' '),
		line_items: items.length
			? items
					.slice(0, 20)
					.map((l) => ({ description: l.description, amount: round2(f.sign * l.amount) }))
			: null,
		no_payment_request: f.payable === 0
	};
}

/**
 * What a receipt record keeps of an e-invoice it was read from: the summary
 * the list shows, the extraction, and that no model read it (`extractionModel`
 * names the syntax). Null where the bytes are no e-invoice or there is no
 * DOMParser (a test without one).
 *
 * @param {Uint8Array} bytes the XML, the original
 * @param {{ DOMParser?: typeof DOMParser, now?: () => Date }} [options]
 * @returns {Record<string, any> | null}
 */
export function eInvoiceFields(
	bytes,
	{ DOMParser: Parser = globalThis.DOMParser, now = () => new Date() } = {}
) {
	if (!Parser) return null;
	let read;
	try {
		read = readEInvoice(new TextDecoder().decode(bytes), { DOMParser: Parser });
	} catch {
		return null;
	}
	const x = read.extraction;
	return {
		vendor: x.vendor,
		amountCents: typeof x.gross === 'number' ? Math.round(x.gross * 100) : null,
		currency: x.currency,
		documentDate: x.invoice_date,
		invoiceNumber: x.invoice_number,
		extraction: x,
		extractionModel: `e-invoice (${read.syntax.toUpperCase()})`,
		extractionError: null,
		extractedAt: now().toISOString(),
		// What it is: EN 16931 or not (Factur-X MINIMUM / BASIC WL), and its profile.
		eInvoice: { syntax: read.syntax, profile: read.profile, en16931: read.eInvoice }
	};
}
