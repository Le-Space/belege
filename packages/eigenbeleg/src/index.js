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
	storagePurposeText,
	ALEPH_NOTE,
	noInvoice,
	CHAIN_NAMES,
	dataSourceOf,
	DATA_SOURCES,
	deNumber,
	deRate,
	deEuro,
	deFixed,
	deMoney,
	deDate,
	DOCUMENT_CURRENCIES,
	documentCurrency,
	currencyPlaces,
	conversionText,
	formats,
	NOTE_EN,
	ALEPH_NOTE_EN,
	NOT_AN_INVOICE_EN,
	KIND_TEXT_EN,
	DATA_SOURCES_EN
} from './document.js';
export { DOCUMENT_LANGUAGES, documentLanguage, localizeLabel, localizeSource } from './language.js';
export { eigenbelegCsv } from './csv.js';
export {
	buildConsumption,
	consumptionTexts,
	consumptionTitle,
	CONSUMPTION_CHAINS,
	isConsumption,
	monthName
} from './consumption.js';
/** @typedef {import('./consumption.js').ConsumptionReceipt} ConsumptionReceipt */
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
export { ISSUER_LOGO_BOX, LETTERHEAD, MARK_SIZE } from './layout.js';
// What an issuer's logo may be, and the error a file that is not gets (issuerLogo of the PDFs).
export { ImageError, IMAGE_LIMITS } from '@le-space/pdf';
/** @typedef {import('./value.js').Rate} Rate */
/** @typedef {import('./value.js').Rates} Rates */
/** @typedef {import('./value.js').ValuedEntry} ValuedEntry */
/** @typedef {import('./document.js').EigenbelegDocument} EigenbelegDocument */
/** @typedef {import('./statement.js').Statement} Statement */
/** @typedef {import('./booking.js').BookingEigenbeleg} BookingEigenbeleg */
/** @typedef {import('./booking.js').ChainDetails} ChainDetails */
