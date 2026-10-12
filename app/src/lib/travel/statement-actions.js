// "Abrechnung erstellen" (issue #213, step 5): the statement of a traveller
// and month made, numbered (RK-YYYY-NNN), drawn as a PDF, kept as a receipt
// – the record that serves as the receipt for the payout (step 7) – and
// closed with everything it printed and the rates it used (snapshotOf). A
// closed statement is not changed: a correction is a new one that refers to
// it, and the old one stays.

import { importFile } from '../receipts/import.js';
import { recordEvent } from '../activity/events.js';
import { nextStatementNumber } from './records.js';
import { lastDayOf, snapshotOf, statementOf } from './statement.js';

/** @typedef {Record<string, any>} Rec */

export class StatementError extends Error {
	/** @param {string} message @param {'checks' | 'exists' | 'saveFailed'} code */
	constructor(message, code) {
		super(message);
		this.name = 'StatementError';
		this.code = code;
	}
}

/**
 * The closed statements of a traveller and month, newest first.
 *
 * @param {Rec[]} travel
 * @param {string} travellerId
 * @param {string} month
 */
export const closedStatements = (travel, travellerId, month) =>
	travel
		.filter(
			(r) =>
				r.kind === 'statement' &&
				!r.deleted &&
				r.state === 'closed' &&
				r.travellerId === travellerId &&
				r.month === month
		)
		.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));

/**
 * @param {object} p
 * @param {{ travel: import('../store/repository.js').Collection, receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection, transactions?: import('../store/repository.js').Collection, matches?: import('../store/repository.js').Collection }} p.store
 * @param {{ put: (bytes: Uint8Array) => Promise<string>, get?: (cid: string) => Promise<Uint8Array> }} p.blobs
 * @param {Rec} p.traveller
 * @param {string} p.month YYYY-MM
 * @param {string} [p.issuer]
 * @param {string} [p.createdBy]
 * @param {string | null} [p.corrects] the id of the closed statement this one replaces
 * @param {() => Date} [p.now]
 */
export async function createTravelStatement({
	store,
	blobs,
	traveller,
	month,
	issuer = '',
	createdBy = '',
	corrects = null,
	now = () => new Date()
}) {
	const travel = await store.travel.list({ includeDeleted: true });
	const before = closedStatements(travel, traveller.id, month);
	if (before.length && !corrects)
		throw new StatementError(`A statement for ${month} exists: ${before[0].number}`, 'exists');
	const replaced = corrects ? (before.find((r) => r.id === corrects) ?? null) : null;
	if (corrects && !replaced) throw new StatementError(`No closed statement ${corrects}`, 'exists');

	const statement = statementOf({
		travellerId: traveller.id,
		month,
		travel: travel.filter((r) => !r.deleted),
		receipts: await store.receipts.list(),
		transactions: (await store.transactions?.list()) ?? [],
		matches: (await store.matches?.list()) ?? []
	});
	if (!statement.ready) throw new StatementError('The statement has open checks.', 'checks');

	const created = now();
	const number = nextStatementNumber(travel, Number(month.slice(0, 4)));
	const { travelStatementPdf } = await import('./statement-pdf.js');
	const bytes = await travelStatementPdf({
		number,
		issuer,
		traveller: String(traveller.name ?? ''),
		role: String(traveller.role ?? ''),
		month,
		createdAt: created.toISOString(),
		corrects: replaced?.number ?? null,
		statement
	});
	const { record } = await importFile({
		receipts: store.receipts,
		blobs: /** @type {any} */ (blobs),
		bytes,
		fileName: `${number} Reisekosten ${month}.pdf`,
		source: 'eigenbeleg',
		sourceRef: `travel-statement:${number}`,
		fields: {
			confirmedByUser: true,
			vendor: `Reisekostenabrechnung ${String(traveller.name ?? '').trim() || month}`.trim(),
			documentDate: lastDayOf(month),
			amountCents: statement.totals.toPayBackCents,
			currency: 'EUR',
			selfNumber: number,
			selfReceipt: {
				kind: 'travel-statement',
				counterparty: String(traveller.name ?? ''),
				description: `Reisekosten ${month}`,
				createdAt: created.toISOString(),
				createdBy
			}
		}
	});
	if (!record) throw new StatementError('The statement could not be kept.', 'saveFailed');

	const closed = await store.travel.put({
		kind: 'statement',
		state: 'closed',
		travellerId: traveller.id,
		month,
		number,
		closedAt: created.toISOString(),
		corrects: replaced?.id ?? null,
		receiptId: record.id,
		toPayBackCents: statement.totals.toPayBackCents,
		snapshot: snapshotOf(statement)
	});
	await recordEvent(store.events, 'decision', {
		action: 'travel-statement',
		receiptId: record.id,
		number,
		month
	});
	return { statement: closed, receipt: record, number };
}
