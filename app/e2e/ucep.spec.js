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
