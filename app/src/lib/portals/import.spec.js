// Portal invoices into the store: source 'portal', sourceRef `<portal>:<id>`,
// known ones not even fetched, the same bytes from elsewhere a duplicate, and
// the Belege page's source list.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { importFile } from '../receipts/import.js';
import { receiptDate } from '../receipts/view.js';
import { importPortalInvoices, knownInvoiceIds, portalSourceRef } from './import.js';
import { portalSources, receiptSourceKey } from './sources.js';

const pdf = (/** @type {string} */ marker) =>
	new TextEncoder().encode(`%PDF-1.4\n${marker}\n%%EOF`);

async function setup() {
	const { collection: receipts } = memoryCollection('receipts');
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	return { receipts, blobs };
}

/** @param {string} id @param {Partial<import('./client.js').PortalInvoice>} [over] */
const invoice = (id, over = {}) => ({
	id,
	date: '2026-09-03',
	period: '2026-09',
	amountCents: 3999,
	invoiceNumber: id,
	fileName: `Vodafone-MeinKabel-${id}.pdf`,
	size: 20,
	sha256: 'x',
	...over
});

/** A bridge that serves one PDF per invoice id and counts the requests. */
function bridge(/** @type {Record<string, Uint8Array>} */ files) {
	/** @type {string[]} */
	const asked = [];
	return {
		asked,
		invoice: async (/** @type {string} */ portal, /** @type {string} */ id) => {
			asked.push(`${portal}:${id}`);
			return files[id];
		}
	};
}

describe('portal import', () => {
	it('imports as source portal, with the invoice date and a vodafone: sourceRef', async () => {
		const { receipts, blobs } = await setup();
		const client = bridge({ 'VK-1': pdf('one'), 'VK-2': pdf('two') });
		/** @type {any[]} */
		const created = [];
		const counts = await importPortalInvoices({
			receipts,
			blobs,
			client,
			portal: 'vodafone',
			invoices: [invoice('VK-1'), invoice('VK-2', { date: '2026-08-03', period: '2026-08' })],
			created
		});
		expect(counts).toEqual({ new: 2, known: 0, duplicate: 0, unsupported: 0 });
		expect(created).toHaveLength(2);
		expect(created[0]).toMatchObject({
			source: 'portal',
			portal: 'vodafone',
			sourceRef: 'vodafone:VK-1',
			from: 'Vodafone MeinKabel',
			subject: 'Vodafone MeinKabel · Rechnung VK-1',
			receivedAt: '2026-09-03',
			mime: 'application/pdf',
			status: 'neu',
			portalInvoice: { id: 'VK-1', period: '2026-09', invoiceNumber: 'VK-1', amountCents: 3999 }
		});
		expect(receiptDate(created[1])).toBe('2026-08-03');
		expect(await blobs.get(created[0].fileCid)).toEqual(pdf('one'));
		expect((await knownInvoiceIds(receipts, 'vodafone')).sort()).toEqual(['VK-1', 'VK-2']);
	});

	it('a known invoice is not fetched again, even after it was deleted', async () => {
		const { receipts, blobs } = await setup();
		const client = bridge({ 'VK-1': pdf('one') });
		const created = /** @type {any[]} */ ([]);
		await importPortalInvoices({
			receipts,
			blobs,
			client,
			portal: 'vodafone',
			invoices: [invoice('VK-1')],
			created
		});
		await receipts.softDelete(created[0].id);
		const again = await importPortalInvoices({
			receipts,
			blobs,
			client,
			portal: 'vodafone',
			invoices: [invoice('VK-1')]
		});
		expect(again).toEqual({ new: 0, known: 1, duplicate: 0, unsupported: 0 });
		expect(client.asked).toEqual(['vodafone:VK-1']);
		expect(await knownInvoiceIds(receipts, 'vodafone')).toEqual(['VK-1']);
	});

	it('the same PDF by mail first: a duplicate by sha256', async () => {
		const { receipts, blobs } = await setup();
		await importFile({
			receipts,
			blobs,
			bytes: pdf('same'),
			fileName: 'Rechnung.pdf',
			source: 'mail',
			sourceRef: 'bWFpbA#2',
			fields: { authVerdict: 'pass' }
		});
		const counts = await importPortalInvoices({
			receipts,
			blobs,
			client: bridge({ 'VK-9': pdf('same') }),
			portal: 'vodafone',
			invoices: [invoice('VK-9')]
		});
		expect(counts.duplicate).toBe(1);
		expect(await receipts.list()).toHaveLength(1);
	});

	it('bytes that are no PDF or image are refused', async () => {
		const { receipts, blobs } = await setup();
		const counts = await importPortalInvoices({
			receipts,
			blobs,
			client: bridge({ X: new TextEncoder().encode('<html>Fehler</html>') }),
			portal: 'vodafone',
			invoices: [invoice('X')]
		});
		expect(counts.unsupported).toBe(1);
		expect(await receipts.list()).toHaveLength(0);
	});

	it('the Belege page lists a portal as its own source, by name', () => {
		const receipts = [
			{ source: 'mail' },
			{ source: 'portal', portal: 'vodafone' },
			{ source: 'portal', portal: 'vodafone' },
			{ source: 'upload' }
		];
		expect(portalSources(receipts)).toEqual([
			{ key: 'portal:vodafone', label: 'Vodafone MeinKabel', count: 2 }
		]);
		expect(portalSources([{ source: 'mail' }])).toEqual([]);
		expect(receiptSourceKey({ source: 'portal', portal: 'vodafone' })).toBe('portal:vodafone');
		expect(receiptSourceKey({ source: 'mail' })).toBe('mail');
		expect(portalSourceRef('vodafone', 'VK-1')).toBe('vodafone:VK-1');
	});
});
