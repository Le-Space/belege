// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/eigenbeleg: the Eigenbeleg and the Kontoauszug of Le Space's
// tools (Belege, the Eigenbeleg API and web UI) – what they say, as PDF/A-2b
// and CSV. Browser and Node.
export {
	buildDocument,
	nthNumber,
	NOTE,
	NOT_AN_INVOICE,
	DEFAULT_KINDS,
	KIND_TEXT,
	kindText,
	ALEPH_NOTE,
	noInvoice,
	CHAIN_NAMES,
	DATA_SOURCES,
	deNumber,
	deEuro,
	deFixed,
	deMoney,
	deDate,
	DOCUMENT_CURRENCIES,
	documentCurrency,
	currencyPlaces,
	conversionText
} from './document.js';
export { eigenbelegCsv } from './csv.js';
export { eigenbelegPdf, CREATOR, PRODUCER } from './pdf.js';
export {
	buildStatement,
	isDust,
	monthly,
	reconciled,
	STATEMENT_NOTE,
	USAGE_NOTE,
	USAGE_NOTES,
	FILECOIN_PAY_USAGE_NOTE,
	usageNote
} from './statement.js';
/** @typedef {import('./statement.js').MonthlyLine} MonthlyLine */
export { statementPdf } from './statement-pdf.js';
export { statementChart } from './statement-chart.js';
export { drawScene, sceneMeasure } from './chart-pdf.js';
export { valueEntries, fixedRates } from './value.js';
export { nextSelfNumber, bookingNote, bookingNotInvoice } from './booking.js';
export { bookingPdf } from './booking-pdf.js';
export { statementLayout } from './statement-layout.js';
export { ISSUER_LOGO_BOX } from './layout.js';
// What an issuer's logo may be, and the error a file that is not gets (issuerLogo of the PDFs).
export { ImageError, IMAGE_LIMITS } from '@le-space/pdf';
/** @typedef {import('./value.js').Rate} Rate */
/** @typedef {import('./value.js').Rates} Rates */
/** @typedef {import('./value.js').ValuedEntry} ValuedEntry */
/** @typedef {import('./document.js').EigenbelegDocument} EigenbelegDocument */
/** @typedef {import('./statement.js').Statement} Statement */
/** @typedef {import('./booking.js').BookingEigenbeleg} BookingEigenbeleg */
/** @typedef {import('./booking.js').ChainDetails} ChainDetails */
