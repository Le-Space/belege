// The monthly Akash usage statement (issue #305, step 2): an Eigenbeleg per
// Akash wallet and month, as Aleph's (aleph/aleph.js). Akash has no supplier
// who invoices – compute comes from decentralised providers and is paid on
// chain – so the statement documents what the wallet paid in the month: its
// network fees, AKT burnt for ACT, and what its deployments used (usage.js).
//
// It becomes a receipt (source `eigenbeleg`, own number EB-YYYY-NNN) and is
// linked to the month's network fee bookings of the wallet, one receipt for
// all of them (as an invoice paid in instalments, #258): they are covered by
// it, and the export can book them as one (#305). Its amount is the fees'
// sum, as booked; the deployments' usage is shown, not booked here.

import { recordEvent } from '../activity/events.js';
import { lastDay } from '../aleph/aleph.js';
import { confirmMatch } from '../matching/actions.js';
import { isActive } from '../matching/engine.js';
import { nextSelfNumber } from '../receipts/eigenbeleg.js';
import { importFile } from '../receipts/import.js';
import { t } from '../i18n/index.js';
import { akashMonth } from './usage.js';

/** @param {string} address @param {string} month */
export const akashStatementRef = (address, month) => `akash:${address}:${month}`;

/**
 * The statement of a wallet and month, when there is one.
 *
 * @param {Record<string, any>[]} receipts
 * @param {string} address
 * @param {string} month
 */
export const findAkashStatement = (receipts, address, month) =>
	receipts.find(
		(r) =>
			!r.deleted && r.source === 'eigenbeleg' && r.sourceRef === akashStatementRef(address, month)
	) ?? null;

export const AKASH_REASON =
	// eslint-disable-next-line belege/no-german -- text of the Eigenbeleg, a German document (#192)
	'Akash stellt keine Rechnung aus: Rechenleistung kommt von dezentralen Anbietern und wird auf der Chain bezahlt – Netzwerkgebühren in AKT, Deployments in ACT, das durch Verbrennen von AKT entsteht. Dieser Eigenbeleg weist aus, was die Wallet im Monat dafür gezahlt hat.';

/**
 * @typedef {object} AkashStatementDocument what the PDF shows
 * @property {string} number
 * @property {string} issuer
 * @property {string} walletName
 * @property {import('./usage.js').AkashMonth} data
 * @property {string} reason
 * @property {string} createdAt
 * @property {string} createdBy
 */

/**
 * Make the statement of a wallet and month, store it as a receipt, link the
 * month's network fees to it.
 *
 * @param {object} p
 * @param {any} p.store receipts, transactions, accounts, matches, events
 * @param {import('../receipts/blob-store.js').BlobStore} p.blobs
 * @param {{ akashDeployments: (body: { address: string, endpoints?: Record<string, string> }) => Promise<{ deployments: any[] }>, rate: (asset: string, date: string) => Promise<any> }} p.client
 * @param {{ address: string, name?: string, endpoints?: Record<string, string> }} p.wallet
 * @param {string} p.month YYYY-MM
 * @param {string} [p.issuer]
 * @param {string} [p.createdBy]
 * @param {() => Date} [p.now]
 */
export async function createAkashStatement({
	store,
	blobs,
	client,
	wallet,
	month,
	issuer = '',
	createdBy = '',
	now = () => new Date()
}) {
	const all = await store.receipts.list({ includeDeleted: true });
	const existing = findAkashStatement(all, wallet.address, month);
	if (existing) throw new Error(t('messages.akash.exists', { number: existing.selfNumber }));

	const { deployments } = await client.akashDeployments({
		address: wallet.address,
		endpoints: wallet.endpoints ?? {}
	});
	const day = lastDay(month);
	const today = now().toISOString().slice(0, 10);
	/** @type {{ rate: string, date: string } | null} */
	let eurPerUsd = null;
	try {
		const r = await client.rate('USD', day < today ? day : today);
		if (Number(r?.rate) > 0)
			eurPerUsd = { rate: String(r.rate), date: String(r.at ?? day).slice(0, 10) };
	} catch {
		eurPerUsd = null;
	}
	const data = akashMonth({
		month,
		address: wallet.address,
		accounts: await store.accounts.list(),
		transactions: await store.transactions.list(),
		deployments,
		eurPerUsd
	});
	if (!data.fees.length && !data.topUps.length && !data.usage.length) {
		throw new Error(t('messages.akash.nothing'));
	}

	const created = now();
	const number = nextSelfNumber(all, month.slice(0, 4));
	/** @type {AkashStatementDocument} */
	const doc = {
		number,
		issuer,
		walletName: wallet.name ?? '',
		data,
		reason: AKASH_REASON,
		createdAt: created.toISOString(),
		createdBy
	};
	const { akashStatementPdf } = await import('./statement-pdf.js');
	const bytes = await akashStatementPdf(doc);
	const { record } = await importFile({
		receipts: store.receipts,
		blobs,
		bytes,
		fileName: `${number} Akash ${month}.pdf`,
		source: 'eigenbeleg',
		sourceRef: akashStatementRef(wallet.address, month),
		fields: {
			confirmedByUser: true,
			vendor: 'Akash Network (Eigenbeleg)',
			documentDate: day,
			amountCents: data.totals.feesEurCents,
			currency: 'EUR',
			selfNumber: number,
			selfReceipt: {
				kind: 'akash-statement',
				counterparty: 'Akash Network',
				// eslint-disable-next-line belege/no-german -- text of the Eigenbeleg, a German document (#192)
				description: `Netzwerkgebühren und Verbrauch Akash ${month}`,
				reason: AKASH_REASON,
				createdAt: doc.createdAt,
				createdBy,
				akash: {
					address: wallet.address,
					month,
					fees: data.fees.length,
					feesAkt: data.totals.feesAkt,
					feesEurCents: data.totals.feesEurCents,
					topUpsAkt: data.totals.topUpsAkt,
					usageAct: data.totals.usageAct,
					usageEurCents: data.totals.usageEurCents
				}
			}
		}
	});
	if (!record) throw new Error(t('messages.akash.saveFailed'));

	// The month's network fees, covered by it – those not linked to anything else.
	const matches = await store.matches.list();
	let linked = 0;
	for (const fee of data.fees) {
		if (matches.some((/** @type {any} */ m) => m.transactionId === fee.id && isActive(m))) continue;
		await confirmMatch(
			store,
			{
				receiptId: record.id,
				transactionId: fee.id,
				reasons: ['akash-statement'],
				alongside: true
			},
			{ log: false }
		);
		linked++;
	}
	await recordEvent(store.events, 'decision', {
		action: 'akash-statement',
		receiptId: record.id,
		number,
		month,
		count: linked
	});
	return { receipt: record, number, data, linked };
}
