// "Beim Anbieter holen" and "Portal für … aufzeichnen": which portal fits a
// counterparty, the start page a mail points to (its origin only), the month
// to fetch from, which new receipt fits a booking, and a portal of your own
// named on its receipts and in the Belege page's source list.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { receipt, tx } from '../matching/fixtures.js';
import { findPortalUrl, findPortalUrls } from '../matching/portal.js';
import { fittingReceipt, mailVendorOrigin, portalForCounterparty, sinceFor } from './actions.js';
import { importPortalInvoices } from './import.js';
import { portalSources } from './sources.js';

/** @param {Partial<import('./client.js').PortalInfo>} p @returns {import('./client.js').PortalInfo} */
const portal = (p) => ({
	id: 'x',
	name: 'X',
	recipeVersion: '1',
	state: 'logged-in',
	lastLoginAt: null,
	lastRun: null,
	running: null,
	...p
});

describe('portalForCounterparty', () => {
	const portals = [
		portal({ id: 'vodafone', name: 'Vodafone MeinKabel', host: 'www.vodafone.de' }),
		portal({ id: 'local-anthropic', name: 'Anthropic', host: 'claude.ai', source: 'local' }),
		portal({ id: 'local-beispiel', name: 'Beispiel Cloud', host: 'app.wolke.example' }),
		portal({ id: 'local-neu', name: 'Neu Test', host: 'neu.example', pending: true })
	];

	it('by name, or by the main word of its host', () => {
		expect(portalForCounterparty(portals, 'ANTHROPIC, PBC')?.id).toBe('local-anthropic');
		expect(portalForCounterparty(portals, 'Vodafone West GmbH')?.id).toBe('vodafone');
		expect(portalForCounterparty(portals, 'Beispiel Cloud GmbH')?.id).toBe('local-beispiel');
		expect(portalForCounterparty(portals, 'WOLKE SERVICES')?.id).toBe('local-beispiel');
	});

	it('none for another vendor, an empty name, or a portal still being recorded', () => {
		expect(portalForCounterparty(portals, 'Stromwerk Test AG')).toBeNull();
		expect(portalForCounterparty(portals, '')).toBeNull();
		expect(portalForCounterparty(portals, 'Neu Test GmbH')).toBeNull();
	});
});

describe('mailVendorOrigin', () => {
	const mail = (/** @type {Record<string, any>} */ over) => ({
		source: 'mail',
		from: 'Anthropic <invoice+statements@mail.anthropic.com>',
		subject: 'Your receipt from Anthropic',
		excerpt: '',
		...over
	});

	it('the origin of a link, never the link with its token', () => {
		const r = mail({
			excerpt:
				'View your invoice: https://invoice.stripe.com/i/acct_1abc/live_YWNjdF8xMjM0NTY3ODkw?s=em\nQuestions? https://support.anthropic.com/help'
		});
		// The sender's own domain first.
		expect(mailVendorOrigin(r)).toEqual({
			origin: 'https://support.anthropic.com',
			host: 'support.anthropic.com'
		});
		const other = mail({ excerpt: 'Rechnung: https://invoice.stripe.com/i/acct_1abc/live_x' });
		expect(mailVendorOrigin(other)).toEqual({
			origin: 'https://invoice.stripe.com',
			host: 'invoice.stripe.com'
		});
		expect(JSON.stringify(mailVendorOrigin(other))).not.toContain('acct_');
	});

	it('only for mails, only real web addresses (an .ai host too)', () => {
		expect(
			mailVendorOrigin(mail({ excerpt: 'Log in at https://claude.ai/settings' }))?.origin
		).toBe('https://claude.ai');
		expect(mailVendorOrigin(mail({ excerpt: 'schreib an rechnung@anthropic.com' }))).toBeNull();
		expect(mailVendorOrigin(mail({ excerpt: 'Rechnung.pdf im Anhang' }))).toBeNull();
		expect(
			mailVendorOrigin({ source: 'upload', excerpt: 'https://claude.ai', subject: '' })
		).toBeNull();
		expect(mailVendorOrigin(null)).toBeNull();
	});

	it('findPortalUrls lists every address; findPortalUrl the first', () => {
		const text = 'a https://www.vodafone.de/x b https://claude.ai c';
		expect(findPortalUrls(text).map((u) => u.host)).toEqual(['www.vodafone.de', 'claude.ai']);
		expect(findPortalUrl(text)?.host).toBe('www.vodafone.de');
	});
});

describe('sinceFor', () => {
	it('the month before the booking', () => {
		expect(sinceFor('2026-09-05')).toBe('2026-08');
		expect(sinceFor('2026-01-31')).toBe('2025-12');
		expect(sinceFor(null, new Date('2026-03-15T00:00:00Z'))).toBe('2026-02');
	});
});

describe('fittingReceipt', () => {
	it('the new receipt that fits the booking by amount, date and vendor; none otherwise', () => {
		const t = tx({ bookedOn: '2026-09-05', amountCents: -2000, counterparty: 'ANTHROPIC, PBC' });
		const fits = receipt({ vendor: 'Anthropic, PBC', gross: 20, invoice_date: '2026-09-03' });
		const off = receipt({ vendor: 'Anthropic, PBC', gross: 200, invoice_date: '2026-05-03' });
		expect(fittingReceipt(t, [off, fits], [])?.receipt.id).toBe(fits.id);
		expect(fittingReceipt(t, [off], [])).toBeNull();
		// Linked to another booking already: not offered.
		const matches = [{ id: 'M', transactionId: 'T-x', receiptId: fits.id, state: 'confirmed' }];
		expect(fittingReceipt(t, [fits], matches)).toBeNull();
	});
});

describe('a portal of your own on its receipts', () => {
	it('is named by the bridge’s name, on the receipt and in the source list', async () => {
		const { collection: receipts } = memoryCollection('receipts');
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: crypto.getRandomValues(new Uint8Array(32))
		});
		/** @type {any[]} */
		const created = [];
		await importPortalInvoices({
			receipts,
			blobs,
			client: { invoice: async () => new TextEncoder().encode('%PDF-1.4\nrec\n%%EOF') },
			portal: 'local-anthropic',
			name: 'Anthropic',
			invoices: [
				{
					id: 'recorded-0123456789ab',
					date: null,
					period: null,
					amountCents: null,
					invoiceNumber: null,
					fileName: 'Anthropic-0123456789ab.pdf',
					size: 20,
					sha256: 'x'
				}
			],
			created
		});
		expect(created).toHaveLength(1);
		expect(created[0].portalName).toBe('Anthropic');
		expect(created[0].from).toBe('Anthropic');
		expect(created[0].sourceRef).toBe('local-anthropic:recorded-0123456789ab');
		expect(portalSources(await receipts.list())).toEqual([
			{ key: 'portal:local-anthropic', label: 'Anthropic', count: 1 }
		]);
	});
});
