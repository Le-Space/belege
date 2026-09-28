// Belege and the invoicing app over UCEP, end to end: Belege pairs with an
// invitation, asks the app for an Eigenbeleg for a payment without a receipt,
// and takes the PDF back as that payment's receipt. The app is played by a
// node that answers as Le-Space/invoice does — the PDF only over a direct
// (WebRTC) connection — reached through a relay on this machine.
import { test, expect } from '@playwright/test';
import { createProvider } from '@le-space/ucep';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { relayAddr, startProviderNode } from './relay.js';
import { openIntegration } from './integrations.js';

/** A small real PDF, as the app would make one. */
async function eigenbelegPdf(/** @type {string} */ number) {
	const pdf = await PDFDocument.create();
	pdf.setCreationDate(new Date('2026-09-26T10:00:00Z'));
	pdf.setModificationDate(new Date('2026-09-26T10:00:00Z'));
	const page = pdf.addPage([595, 842]);
	page.drawText(`Eigenbeleg ${number}`, {
		x: 56,
		y: 780,
		size: 16,
		font: await pdf.embedFont(StandardFonts.Helvetica)
	});
	return pdf.save();
}

/** @param {Uint8Array} bytes */
async function sha256(bytes) {
	const d = new Uint8Array(
		await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes))
	);
	return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

test('the invoicing app makes the Eigenbeleg, Belege links it', async ({ page }) => {
	const relay = await relayAddr();
	const node = await startProviderNode(relay);
	/** @type {any[]} */
	const asked = [];
	/** @type {boolean[]} */
	const direct = [];
	const provider = createProvider({
		libp2p: node,
		manifest: {
			id: 'invoice',
			name: 'Rechnungen',
			version: '0.1.0',
			scopes: [
				{ name: 'invoice:eigenbeleg:create', description: 'Eigenbelege' },
				{ name: 'invoice:document:read', description: 'Lesen' }
			]
		},
		commands: {
			'create-eigenbeleg': {
				scope: 'invoice:eigenbeleg:create',
				idempotent: true,
				handler: async ({ argsJson }) => {
					asked.push(argsJson);
					const bytes = await eigenbelegPdf('EB-2026-0001');
					return {
						documentId: 'doc-1',
						number: 'EB-2026-0001',
						state: 'created',
						file: { mime: 'application/pdf', size: bytes.length, sha256: await sha256(bytes) }
					};
				}
			},
			'get-pdf': {
				scope: 'invoice:document:read',
				handler: async ({ limited }) => {
					direct.push(!limited);
					const bytes = await eigenbelegPdf('EB-2026-0001');
					return {
						mime: 'application/pdf',
						size: bytes.length,
						sha256: await sha256(bytes),
						// As the app: inline only over a direct connection.
						...(limited ? {} : { base64: Buffer.from(bytes).toString('base64') })
					};
				}
			}
		}
	});
	try {
		await provider.start();
		const { uri } = await provider.createInvitation({
			scopes: ['invoice:eigenbeleg:create', 'invoice:document:read']
		});

		/** @param {string} name */
		const tab = (name) =>
			page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
		await addVirtualAuthenticator(page);
		await page.goto('/');
		await acceptConsent(page);
		await page.getByTestId('passkey-label').fill('E2E');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();

		// Pair with the invitation the app showed.
		await openIntegration(page, 'rechnungs-app');
		const card = page.getByTestId('invoice-app-card');
		// Nothing connects to the relay before the person asks for it.
		await card.getByTestId('invoice-app-start').click();
		await card.getByTestId('invoice-app-invitation').fill(uri);
		await card.getByTestId('invoice-app-pair').click();
		await expect(card.getByTestId('invoice-app-paired')).toBeVisible();
		await expect(card).toContainText(node.peerId.toString());
		expect((await provider.grants())[0]).toMatchObject({ label: 'Belege' });

		// A made-up Akash fee without any receipt.
		await page.evaluate(async () => {
			await /** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-09-01',
				counterparty: 'Stromwerk Test AG',
				purpose: 'Lease-Zahlung',
				amountCents: -1234,
				currency: 'EUR',
				movement: 'transfer',
				txRef: 'ABC123',
				asset: 'AKT',
				quantity: '-4200000',
				decimals: 6,
				valuation: {
					rate: '2.938095',
					currency: 'EUR',
					source: 'coingecko',
					at: '2026-09-01T00:00:00Z'
				}
			});
		});
		await tab('Zahlungen').click();
		await page.getByTestId('transaction').filter({ hasText: 'Stromwerk Test AG' }).click();
		// The Eigenbeleg is one of the "Kein fremder Beleg …" options.
		await page.getByTestId('tx-alt-toggle').click();
		await page.getByTestId('tx-eigenbeleg-open').click();
		await page.getByTestId('tx-eigenbeleg-description').fill('Rechenzeit für einen Monat (Lease)');
		await page.getByTestId('tx-eigenbeleg-remote').click();

		// Linked: the form gives way to the receipt, the app's number in its name.
		await expect(page.getByTestId('tx-linked-vendor')).toContainText('Eigenbeleg', {
			timeout: 60_000
		});
		await expect(page.getByRole('dialog')).toContainText('EB-2026-0001.pdf');
		await expect(page.getByTestId('tx-eigenbeleg')).toHaveCount(0);

		// What the app was asked for, and how the PDF came: directly.
		expect(asked[0]).toMatchObject({
			date: '2026-09-01',
			direction: 'outgoing',
			amount: { value: '12.34', currency: 'EUR' },
			crypto: { chain: 'cosmos:akashnet-2', symbol: 'AKT', quantity: '4.2', txRef: 'ABC123' },
			reference: { system: 'belege' }
		});
		expect(direct).toContain(true);

		// Unpaired: the app forgets the grant, and Belege goes offline again.
		await page.getByTestId('tx-detail-close').click();
		await openIntegration(page, 'rechnungs-app');
		// Belege's node: whatever the app is connected to other than the relay.
		const belege = node
			.getConnections()
			.map((/** @type {any} */ c) => c.remotePeer.toString())
			.filter((/** @type {string} */ p) => !String(relay).includes(p));
		expect(belege.length).toBeGreaterThan(0);
		await card.getByTestId('invoice-app-unpair').click();
		await expect(card.getByTestId('invoice-app-start')).toBeVisible();
		expect(await provider.grants()).toEqual([]);
		await expect
			.poll(() =>
				node
					.getConnections()
					.some((/** @type {any} */ c) => belege.includes(c.remotePeer.toString()))
			)
			.toBe(false);
	} finally {
		await provider.stop().catch(() => {});
		await node.stop().catch(() => {});
	}
});

test('issued invoices come in, the matching links the payment, the app learns it is paid', async ({
	page
}) => {
	const relay = await relayAddr();
	const node = await startProviderNode(relay);
	const bytes = await eigenbelegPdf('RE-2026-0004');
	/** A made-up issued invoice, as the app keeps it. */
	const inv = {
		documentId: 'doc-4',
		number: 'RE-2026-0004',
		state: 'issued',
		issuedOn: '2026-09-01',
		dueOn: '2026-09-15',
		customer: { name: 'Beispiel Kunde GmbH' },
		total: { value: '119.00', currency: 'EUR' },
		paid: { value: '0.00', currency: 'EUR' },
		/** @type {any[]} */
		payments: []
	};
	/** @type {any[]} */
	const recorded = [];
	const provider = createProvider({
		libp2p: node,
		manifest: {
			id: 'invoice',
			name: 'Rechnungen',
			version: '0.2.0',
			scopes: [
				{ name: 'invoice:eigenbeleg:create', description: 'Eigenbelege' },
				{ name: 'invoice:document:read', description: 'Lesen' },
				{ name: 'invoice:issued:read', description: 'Rechnungen lesen' },
				{ name: 'invoice:payment:record', description: 'Zahlungen melden' }
			]
		},
		commands: {
			'list-issued': {
				scope: 'invoice:issued:read',
				handler: async () => ({ invoices: [structuredClone(inv)], next: null })
			},
			'get-pdf': {
				scope: 'invoice:issued:read',
				handler: async ({ argsJson, limited }) => {
					if (argsJson?.documentId !== inv.documentId) throw new Error('documentId');
					return {
						mime: 'application/pdf',
						size: bytes.length,
						sha256: await sha256(bytes),
						...(limited ? {} : { base64: Buffer.from(bytes).toString('base64') })
					};
				}
			},
			'record-payment': {
				scope: 'invoice:payment:record',
				idempotent: true,
				handler: async ({ argsJson }) => {
					recorded.push(argsJson);
					if (argsJson.documentId !== inv.documentId) throw new Error('documentId');
					if (argsJson.amount?.currency !== 'EUR') throw new Error('currency');
					inv.payments = [
						...inv.payments.filter((p) => p.reference.id !== argsJson.reference.id),
						{ paidOn: argsJson.paidOn, amount: argsJson.amount, reference: argsJson.reference }
					];
					return { documentId: inv.documentId, state: 'paid' };
				}
			}
		}
	});
	try {
		await provider.start();
		const { uri } = await provider.createInvitation({
			scopes: ['invoice:issued:read', 'invoice:payment:record']
		});
		await addVirtualAuthenticator(page);
		await page.goto('/');
		await acceptConsent(page);
		await page.getByTestId('passkey-label').fill('E2E');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();

		// The customer paid: a made-up incoming payment naming the invoice.
		await page.evaluate(async () => {
			await /** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-09-12',
				counterparty: 'Beispiel Kunde GmbH',
				purpose: 'Rechnung RE-2026-0004',
				amountCents: 11900,
				currency: 'EUR'
			});
		});

		await openIntegration(page, 'rechnungs-app');
		const card = page.getByTestId('invoice-app-card');
		await card.getByTestId('invoice-app-start').click();
		await card.getByTestId('invoice-app-invitation').fill(uri);
		await card.getByTestId('invoice-app-pair').click();
		await expect(card.getByTestId('invoice-app-paired')).toBeVisible();

		// The PDF comes only once the connection is direct: again until it did.
		await expect
			.poll(
				async () => {
					await card.getByTestId('invoice-app-sync').click();
					await expect(card.getByTestId('invoice-app-sync-result')).toBeVisible({
						timeout: 30_000
					});
					return recorded.length;
				},
				{ timeout: 90_000, intervals: [3_000] }
			)
			.toBeGreaterThan(0);
		await expect(card.getByTestId('invoice-app-sync-result')).toContainText('1 bezahlt');

		// The app learns the day and the amount, keyed by the booking – nothing of the bank.
		expect(recorded[0]).toMatchObject({
			documentId: 'doc-4',
			paidOn: '2026-09-12',
			amount: { value: '119', currency: 'EUR' },
			reference: { system: 'belege' }
		});
		expect(JSON.stringify(recorded)).not.toMatch(/Beispiel Kunde|RE-2026-0004|IBAN|purpose/i);

		// The invoice is the payment's receipt now.
		await page
			.getByRole('navigation', { name: 'Hauptnavigation' })
			.getByRole('link', { name: 'Zahlungen' })
			.click();
		// No longer among those without a receipt.
		await expect(page.getByTestId('transaction')).toHaveCount(0);
		await page.getByTestId('filter-all').click();
		await page.getByTestId('transaction').filter({ hasText: 'Beispiel Kunde GmbH' }).click();
		await expect(page.getByRole('dialog')).toContainText('RE-2026-0004.pdf');
	} finally {
		await provider.stop().catch(() => {});
		await node.stop().catch(() => {});
	}
});
