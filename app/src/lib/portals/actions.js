// What the portal card, the payment detail ("Beim Anbieter holen") and the
// receipt detail ("Portal für … aufzeichnen") share: which portal fits a
// counterparty, fetching and importing its invoices (read by the LLM when the
// bridge has one), the start page a mail points to, and which new receipt
// fits a booking. Pure except for the calls it is handed.

import { createBridgeClient } from '../bridge/client.js';
import { sameVendor, vendorWords } from '../matching/normalize.js';
import { findPortalUrls } from '../matching/portal.js';
import { receiptChoices } from '../matching/view.js';
import { extractReceipt, extractable } from '../receipts/extract.js';
import { importPortalInvoices, knownInvoiceIds } from './import.js';

/** @typedef {import('./client.js').PortalInfo} PortalInfo */
/** @typedef {import('../store/repository.js').StoredRecord} StoredRecord */

/**
 * The main word of a host: claude.ai → claude, www.vodafone.de → vodafone.
 *
 * @param {string | undefined} host
 */
const hostWord = (host) => {
	const labels = String(host ?? '')
		.toLowerCase()
		.replace(/:\d+$/, '')
		.split('.');
	return labels.length >= 2 ? (labels.at(-2) ?? '') : '';
};

/**
 * The portal (bundled or your own) whose name, or whose host's main word,
 * names this counterparty; none for a portal still being recorded.
 *
 * @param {PortalInfo[]} portals
 * @param {unknown} counterparty
 * @returns {PortalInfo | null}
 */
export function portalForCounterparty(portals, counterparty) {
	const name = String(counterparty ?? '').trim();
	if (!name) return null;
	const words = new Set(vendorWords(name));
	return (
		portals.find(
			(p) =>
				!p.pending &&
				(sameVendor(p.name, name) || (hostWord(p.host).length > 2 && words.has(hostWord(p.host))))
		) ?? null
	);
}

/**
 * A mail's link to a vendor site → its origin only (the link itself may carry
 * a token). A link on the sender's own domain first.
 *
 * @param {Record<string, any> | null | undefined} receipt
 * @returns {{ origin: string, host: string } | null}
 */
export function mailVendorOrigin(receipt) {
	if (receipt?.source !== 'mail') return null;
	const urls = findPortalUrls(`${receipt.subject ?? ''}\n${receipt.excerpt ?? ''}`);
	if (urls.length === 0) return null;
	const sender = /@([a-z0-9.-]+)/i.exec(String(receipt.from ?? ''))?.[1]?.toLowerCase() ?? '';
	const root = (/** @type {string} */ h) => h.split('.').slice(-2).join('.');
	const pick = urls.find((u) => sender && root(u.host) === root(sender)) ?? urls[0];
	return { origin: `https://${pick.host}`, host: pick.host };
}

/**
 * The month from which to fetch for a booking: the month before it.
 *
 * @param {string | null | undefined} bookedOn YYYY-MM-DD
 * @param {Date} [now]
 */
export function sinceFor(bookedOn, now = new Date()) {
	const d = /^\d{4}-\d{2}/.test(String(bookedOn ?? ''))
		? new Date(`${String(bookedOn).slice(0, 7)}-01T00:00:00Z`)
		: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	d.setUTCMonth(d.getUTCMonth() - 1);
	return d.toISOString().slice(0, 7);
}

/**
 * Of the given receipts, the one that fits this booking best (a suggestion:
 * 40 points or more), or null.
 *
 * @template {{ id: string } & Record<string, any>} R
 * @param {{ id: string } & Record<string, any>} tx
 * @param {R[]} receipts
 * @param {Record<string, any>[]} matches
 * @param {{ companyNames?: string[] }} [ctx]
 */
export function fittingReceipt(tx, receipts, matches, ctx = {}) {
	return receiptChoices(tx, receipts, matches, ctx).find((c) => c.suggested) ?? null;
}

/**
 * Portal invoices (fetched, or the one from a recording) into the sealed
 * store as receipts, then read when the bridge has an LLM.
 *
 * @param {object} params
 * @param {string} params.url the bridge
 * @param {string | null} params.token
 * @param {{ invoice: (portal: string, invoiceId: string) => Promise<Uint8Array> }} params.client
 * @param {string} params.portal
 * @param {string} [params.name]
 * @param {import('./client.js').PortalInvoice[]} params.invoices
 * @param {{ receipts: import('../store/repository.js').Collection }} params.store
 * @param {import('../receipts/blob-store.js').BlobStore} params.blobs
 */
export async function importInvoices({ url, token, client, portal, name, invoices, store, blobs }) {
	/** @type {StoredRecord[]} */
	const created = [];
	const counts = await importPortalInvoices({
		receipts: store.receipts,
		blobs,
		client,
		portal,
		name,
		invoices,
		created
	});
	let read = 0;
	if (created.length) {
		const bridge = createBridgeClient({ url, token });
		const health = await bridge.health().catch(() => null);
		if (health?.llm?.configured) {
			for (const record of extractable(created)) {
				await extractReceipt({ client: bridge, receipts: store.receipts, blobs, record })
					.then(() => read++)
					.catch(() => {});
			}
		}
	}
	return { counts, created, read };
}

/**
 * "Rechnungen holen": the new invoices from `since` on, imported and read.
 *
 * @param {Omit<Parameters<typeof importInvoices>[0], 'invoices' | 'client'> & { client: import('./client.js').PortalClient, since: string }} params
 */
export async function fetchPortal(params) {
	const known = await knownInvoiceIds(params.store.receipts, params.portal);
	const answer = await params.client.fetch(params.portal, params.since, known);
	return { answer, ...(await importInvoices({ ...params, invoices: answer.invoices })) };
}
