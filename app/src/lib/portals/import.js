// Invoices from a customer portal (through the bridge) into the sealed store,
// as receipts with source 'portal' and sourceRef `<portal>:<invoice id>`.
// No duplicates: an invoice whose sourceRef is on a record (a soft-deleted
// one too) is not even asked for; one whose bytes are already on a record
// (e.g. the same PDF came by mail) is a duplicate (receipts/import.js).

import { importFile } from '../receipts/import.js';

/** The portals the bridge knows, by id: the name the Belege page shows. */
export const PORTAL_NAMES = /** @type {Record<string, string>} */ ({
	vodafone: 'Vodafone MeinKabel'
});

/** @param {string} portal @param {string} invoiceId */
export const portalSourceRef = (portal, invoiceId) => `${portal}:${invoiceId}`;

/**
 * The invoice ids of a portal that are already in the books.
 *
 * @param {import('../store/repository.js').Collection} receipts
 * @param {string} portal
 */
export async function knownInvoiceIds(receipts, portal) {
	const prefix = `${portal}:`;
	return (await receipts.list({ includeDeleted: true }))
		.filter((r) => r.source === 'portal' && String(r.sourceRef ?? '').startsWith(prefix))
		.map((r) => String(r.sourceRef).slice(prefix.length));
}

/**
 * @param {object} params
 * @param {import('../store/repository.js').Collection} params.receipts
 * @param {import('../receipts/blob-store.js').BlobStore} params.blobs
 * @param {{ invoice: (portal: string, invoiceId: string) => Promise<Uint8Array> }} params.client
 * @param {string} params.portal e.g. vodafone, local-anthropic
 * @param {string} [params.name] the portal's name as the bridge lists it (a portal of your own is not in PORTAL_NAMES)
 * @param {import('./client.js').PortalInvoice[]} params.invoices from POST /portals/:id/fetch
 * @param {import('../store/repository.js').StoredRecord[]} [params.created] the new records are pushed here
 * @returns {Promise<{ new: number, known: number, duplicate: number, unsupported: number }>}
 */
export async function importPortalInvoices({
	receipts,
	blobs,
	client,
	portal,
	name: listedName,
	invoices,
	created
}) {
	const name = PORTAL_NAMES[portal] ?? listedName ?? portal;
	const all = await receipts.list({ includeDeleted: true });
	const seen = {
		sha: new Set(all.map((r) => r.sha256).filter(Boolean)),
		refs: new Set(all.map((r) => r.sourceRef).filter(Boolean))
	};
	const counts = { new: 0, known: 0, duplicate: 0, unsupported: 0 };
	for (const inv of invoices) {
		const sourceRef = portalSourceRef(portal, inv.id);
		if (seen.refs.has(sourceRef)) {
			counts.known++;
			continue;
		}
		const bytes = await client.invoice(portal, inv.id);
		const { outcome, record } = await importFile({
			receipts,
			blobs,
			bytes,
			fileName: inv.fileName,
			source: 'portal',
			sourceRef,
			fields: {
				portal,
				portalName: name,
				from: name,
				subject: [name, inv.invoiceNumber ? `Rechnung ${inv.invoiceNumber}` : 'Rechnung']
					.filter(Boolean)
					.join(' · '),
				receivedAt: inv.date,
				portalInvoice: {
					id: inv.id,
					period: inv.period,
					invoiceNumber: inv.invoiceNumber,
					amountCents: inv.amountCents
				}
			},
			seen
		});
		if (record) created?.push(record);
		if (outcome === 'new') counts.new++;
		else if (outcome === 'duplicate') counts.duplicate++;
		else counts.unsupported++;
	}
	return counts;
}
