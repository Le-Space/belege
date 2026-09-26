// "Eigenbeleg erstellen": numbers, the document, the PDF, the link. All made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from './blob-store.js';
import { createEigenbeleg, eigenbelegDraft, nextSelfNumber } from './eigenbeleg.js';

/** @type {any} */
let store;
/** @type {import('./blob-store.js').BlobStore} */
let blobs;

beforeEach(async () => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events'
	]) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
	blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
});

/** A lease payment on a made-up wallet: crypto out, no invoice from anyone. */
async function leasePayment() {
	const account = await store.accounts.put({
		source: 'akash',
		sourceAccountId: 'wallet-1',
		ibanLast4: '',
		name: 'Wallet AKT',
		currency: 'EUR',
		kind: 'wallet',
		asset: 'AKT',
		decimals: 6
	});
	const tx = await store.transactions.put({
		accountId: account.id,
		source: 'akash',
		bookedOn: '2026-09-01',
		amountCents: -1234,
		currency: 'EUR',
		counterparty: 'Stromwerk Test AG',
		purpose: 'Lease-Zahlung',
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
	return { account, tx };
}

const pdfText = async (/** @type {Uint8Array} */ bytes) =>
	(await extractText(await getDocumentProxy(bytes), { mergePages: true })).text.replace(
		/\s+/g,
		' '
	);

describe('Eigenbeleg', () => {
	it('numbers each year on its own: EB-YYYY-NNN', () => {
		const receipts = [
			{ selfNumber: 'EB-2026-001' },
			{ selfNumber: 'EB-2026-007' },
			{ selfNumber: 'EB-2025-012' },
			{ selfNumber: '2026-09-001' }
		];
		expect(nextSelfNumber(receipts, '2026')).toBe('EB-2026-008');
		expect(nextSelfNumber(receipts, '2027')).toBe('EB-2027-001');
	});

	it('starts a crypto payment with a reason; any other with none', async () => {
		const { tx } = await leasePayment();
		expect(eigenbelegDraft(tx)).toMatchObject({
			counterparty: 'Stromwerk Test AG',
			description: 'Lease-Zahlung',
			reason: expect.stringContaining('Blockchain')
		});
		expect(eigenbelegDraft({ counterparty: 'Konto B', purpose: 'Barauslage' }).reason).toBe('');
	});

	it('writes the PDF, stores it as a receipt and links it to the booking', async () => {
		const { account, tx } = await leasePayment();
		const { receipt, number } = await createEigenbeleg({
			store,
			blobs,
			tx,
			account,
			input: {
				counterparty: 'Stromwerk Test AG',
				description: 'Rechenzeit für einen Monat (Lease)',
				reason: 'Die Zahlung erfolgte auf der Blockchain; der Empfänger stellt keine Rechnung aus.'
			},
			issuer: 'Wolkenfabrik Hosting GmbH',
			createdBy: 'did:key:z6MkTest',
			now: () => new Date('2026-09-26T10:00:00Z')
		});

		expect(number).toBe('EB-2026-001');
		expect(receipt).toMatchObject({
			source: 'eigenbeleg',
			vendor: 'Eigenbeleg',
			selfNumber: 'EB-2026-001',
			amountCents: 1234,
			documentDate: '2026-09-01',
			confirmedByUser: true,
			status: 'zugeordnet'
		});
		const [match] = await store.matches.list();
		expect(match).toMatchObject({
			transactionId: tx.id,
			receiptId: receipt.id,
			state: 'confirmed'
		});
		expect(match.reasons).toEqual(['manual', 'eigenbeleg']);
		expect((await store.transactions.get(tx.id)).receiptId).toBe(receipt.id);
		const [event] = await store.events.list();
		expect(event).toMatchObject({ kind: 'decision', action: 'eigenbeleg', number: 'EB-2026-001' });

		const text = await pdfText(await blobs.get(receipt.fileCid));
		for (const part of [
			'Eigenbeleg',
			'EB-2026-001',
			'Wolkenfabrik Hosting GmbH',
			'Datum der Zahlung 01.09.2026',
			'Betrag -12,34 EUR',
			'Empfänger Stromwerk Test AG',
			'Konto Wallet AKT',
			'Menge -4,2 AKT',
			'Kurs 2,938095 EUR je AKT · CoinGecko, 01.09.2026',
			'Referenz ABC123',
			'Was wurde bezahlt Rechenzeit für einen Monat (Lease)',
			'Warum kein Fremdbeleg Die Zahlung erfolgte auf der Blockchain',
			'Erstellt 26.09.2026 von did:key:z6MkTest',
			'Unterschrift',
			'keine Rechnung'
		]) {
			expect(text).toContain(part);
		}
	});

	it('asks for what was paid and why, and makes only one per booking', async () => {
		const { account, tx } = await leasePayment();
		const input = { counterparty: '', description: 'Rechenzeit', reason: 'kurz' };
		await expect(createEigenbeleg({ store, blobs, tx, account, input })).rejects.toThrow(/Warum/);
		await expect(
			createEigenbeleg({ store, blobs, tx, account, input: { ...input, description: ' ' } })
		).rejects.toThrow(/Was wurde bezahlt/);

		const ok = { ...input, reason: 'Der Empfänger stellt keine Rechnung aus.' };
		await createEigenbeleg({ store, blobs, tx, account, input: ok });
		await expect(createEigenbeleg({ store, blobs, tx, account, input: ok })).rejects.toThrow(
			/schon den Eigenbeleg EB-2026-001/
		);
		expect(await store.receipts.list()).toHaveLength(1);
	});
});
