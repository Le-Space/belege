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
	CHAIN_NAMES,
	DATA_SOURCES,
	deNumber,
	deEuro,
	deDate
} from './document.js';
export { eigenbelegCsv } from './csv.js';
export { eigenbelegPdf, CREATOR, PRODUCER } from './pdf.js';
export { buildStatement, STATEMENT_NOTE, USAGE_NOTE } from './statement.js';
export { statementPdf } from './statement-pdf.js';
export { valueEntries, fixedRates } from './value.js';
export { nextSelfNumber, bookingNote, bookingNotInvoice } from './booking.js';
export { bookingPdf } from './booking-pdf.js';
export { statementLayout } from './statement-layout.js';
/** @typedef {import('./value.js').Rate} Rate */
/** @typedef {import('./value.js').Rates} Rates */
/** @typedef {import('./value.js').ValuedEntry} ValuedEntry */
/** @typedef {import('./document.js').EigenbelegDocument} EigenbelegDocument */
/** @typedef {import('./statement.js').Statement} Statement */
/** @typedef {import('./booking.js').BookingEigenbeleg} BookingEigenbeleg */
/** @typedef {import('./booking.js').ChainDetails} ChainDetails */
