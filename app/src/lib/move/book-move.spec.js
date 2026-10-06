import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { COLLECTIONS } from '../store/repository.js';
import {
	MoveError,
	createMoveKey,
	generatePassphrase,
	isEmptyBooks,
	keyFingerprint,
	normalizePassphrase,
	openMoveFile,
	packBooks,
	parseMoveKey,
	readMoveHeader,
	takeOverBooks
} from './book-move.js';

/** Fast scrypt for tests; the real one takes about a second. */
const FAST = { N: 2 ** 4, r: 8, p: 1 };
const MARKER = 'Umzugsmarker-Birkenweg-9c2d';

async function books() {
	/** @type {Record<string, any>} */
	const store = {};
	for (const name of COLLECTIONS) store[name] = memoryCollection(name).collection;
	const blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
	return { store, blobs };
}

/** Made-up books: a payment, its receipt with a file, a deleted receipt, a match, settings. */
async function source() {
	const a = await books();
	const pdf = new TextEncoder().encode(`%PDF-1.4\n${MARKER}\n%%EOF`);
	const eml = new TextEncoder().encode('Subject: Quittung\r\n\r\nSumme: 23,80 EUR\r\n');
	const account = await a.store.accounts.put({
		name: 'Geschäftskonto Test',
		ledgerAccount: '1200'
	});
	const tx = await a.store.transactions.put({
		accountId: account.id,
		bookedOn: '2026-09-02',
		amountCents: -2380,
		counterparty: MARKER
	});
	const receipt = await a.store.receipts.put({
		source: 'upload',
		fileName: 'beleg.pdf',
		fileCid: await a.blobs.put(pdf)
	});
	const mail = await a.store.receipts.put({
		source: 'mail',
		fileCid: null,
		emlCid: await a.blobs.put(eml)
	});
	const gone = await a.store.receipts.put({ source: 'upload', fileCid: null, fileName: 'alt.pdf' });
	await a.store.receipts.softDelete(gone.id);
	await a.store.matches.put({ transactionId: tx.id, receiptId: receipt.id, state: 'confirmed' });
	for (const [key, value] of [
		['datev', { consultantNumber: '1001' }],
		['bridge', { url: 'http://127.0.0.1:4300', token: 'geheim-token' }],
		['device:abc', { peerId: '12D3KooTest' }],
		['backup/aleph-key', { secret: 'geheim' }]
	]) {
		await a.store.settings.put({ key, value });
	}
	return { ...a, pdf, eml, tx, receipt, mail, gone };
}

describe('the move file (#328)', () => {
	it('x25519: moved into empty books, ids, links and times kept, files sealed anew', async () => {
		const a = await source();
		const b = await books();
		const key = createMoveKey();
		expect(parseMoveKey(key.text)).toEqual(key.publicKey);
		const { file, header } = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { to: parseMoveKey(key.text) ?? new Uint8Array() },
			appVersion: '0.0.0-test'
		});
		// Nothing readable: the header says only what it is and how much.
		expect(new TextDecoder('latin1').decode(file)).not.toContain(MARKER);
		expect(new TextDecoder('latin1').decode(file)).not.toContain('geheim');
		expect(readMoveHeader(file).header).toEqual(header);
		expect(header.counts).toMatchObject({
			transactions: 1,
			receipts: 3,
			matches: 1,
			settings: 1,
			files: 2
		});
		expect(header.leftOut).toEqual(['backup/aleph-key', 'bridge', 'device:…']);
		expect(header.seal).toMatchObject({ kind: 'x25519', to: keyFingerprint(key.publicKey) });

		const opened = await openMoveFile(file, key);
		const done = await takeOverBooks({ store: b.store, blobs: b.blobs, opened });
		expect(done).toEqual({ records: 7, files: 2 });

		const [tx] = await b.store.transactions.list();
		expect(tx).toMatchObject({ id: a.tx.id, createdAt: a.tx.createdAt, counterparty: MARKER });
		const [match] = await b.store.matches.list();
		expect(match).toMatchObject({ transactionId: a.tx.id, receiptId: a.receipt.id });
		const receipt = /** @type {any} */ (await b.store.receipts.get(a.receipt.id));
		expect(receipt.fileCid).not.toBe(a.receipt.fileCid);
		expect(await b.blobs.get(receipt.fileCid)).toEqual(a.pdf);
		const mail = /** @type {any} */ (await b.store.receipts.get(a.mail.id));
		expect(await b.blobs.get(mail.emlCid)).toEqual(a.eml);
		expect((await b.store.receipts.get(a.gone.id))?.deleted).toBe(true);
		// What belongs to the old passkey stayed behind.
		const keys = (await b.store.settings.list()).map((/** @type {any} */ r) => r.key);
		expect(keys).toEqual(['datev']);
		const [event] = await b.store.events.list();
		expect(event).toMatchObject({ kind: 'books-moved', records: 7, files: 2 });
		// The old books are untouched.
		expect((await a.store.settings.list()).length).toBe(4);
	});

	it('passphrase: generated, typed loosely, opens the same books', async () => {
		const a = await source();
		const b = await books();
		const passphrase = generatePassphrase();
		expect(passphrase).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
		const { file, header } = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { passphrase },
			appVersion: '0.0.0-test',
			scrypt: FAST
		});
		expect(header.seal).toMatchObject({ kind: 'passphrase', kdf: 'scrypt', N: FAST.N });
		const typed = passphrase.toLowerCase().replace(/-/g, ' ');
		expect(normalizePassphrase(typed)).toBe(normalizePassphrase(passphrase));
		const opened = await openMoveFile(file, { passphrase: typed });
		await takeOverBooks({ store: b.store, blobs: b.blobs, opened });
		expect((await b.store.transactions.list())[0].id).toBe(a.tx.id);
	});

	it('another key, a wrong passphrase or a changed byte opens nothing', async () => {
		const a = await source();
		const key = createMoveKey();
		const { file } = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { to: key.publicKey },
			appVersion: '0.0.0-test'
		});
		const other = createMoveKey();
		await expect(openMoveFile(file, other)).rejects.toMatchObject({ code: 'key' });
		await expect(openMoveFile(file, { passphrase: generatePassphrase() })).rejects.toMatchObject({
			code: 'key'
		});
		const changed = file.slice();
		changed[changed.length - 20] ^= 1;
		await expect(openMoveFile(changed, key)).rejects.toMatchObject({ code: 'key' });

		const byPassphrase = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { passphrase: generatePassphrase() },
			appVersion: '0.0.0-test',
			scrypt: FAST
		});
		await expect(
			openMoveFile(byPassphrase.file, { passphrase: generatePassphrase() })
		).rejects.toMatchObject({ code: 'key' });
		await expect(openMoveFile(new TextEncoder().encode('kein Umzug'), key)).rejects.toBeInstanceOf(
			MoveError
		);
		await expect(
			packBooks({ store: a.store, blobs: a.blobs, seal: { passphrase: 'kurz' }, appVersion: 'x' })
		).rejects.toMatchObject({ code: 'key' });
	});

	it('books that are not empty take nothing over, and nothing is written', async () => {
		const a = await source();
		const key = createMoveKey();
		const { file } = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { to: key.publicKey },
			appVersion: '0.0.0-test'
		});
		const b = await books();
		await b.store.transactions.put({ bookedOn: '2026-09-01', amountCents: -100 });
		expect(await isEmptyBooks(b.store)).toBe(false);
		const opened = await openMoveFile(file, key);
		await expect(takeOverBooks({ store: b.store, blobs: b.blobs, opened })).rejects.toMatchObject({
			code: 'not-empty'
		});
		expect(await b.store.receipts.list({ includeDeleted: true })).toEqual([]);
		// A second take-over into books that took one over already is refused the same way.
		const c = await books();
		await takeOverBooks({ store: c.store, blobs: c.blobs, opened });
		await expect(takeOverBooks({ store: c.store, blobs: c.blobs, opened })).rejects.toMatchObject({
			code: 'not-empty'
		});
	});

	it('a receipt file missing on this device stops the packing, rather than move half', async () => {
		const a = await source();
		await a.store.receipts.put({ source: 'upload', fileCid: 'bafy-nicht-da' });
		await expect(
			packBooks({
				store: a.store,
				blobs: a.blobs,
				seal: { to: createMoveKey().publicKey },
				appVersion: '0.0.0-test'
			})
		).rejects.toMatchObject({ code: 'missing-file' });
	});

	it('a setting the fresh session wrote gives way to the moved one', async () => {
		const a = await source();
		const key = createMoveKey();
		const { file } = await packBooks({
			store: a.store,
			blobs: a.blobs,
			seal: { to: key.publicKey },
			appVersion: '0.0.0-test'
		});
		const b = await books();
		await b.store.settings.put({ key: 'datev', value: { consultantNumber: '9999' } });
		await takeOverBooks({ store: b.store, blobs: b.blobs, opened: await openMoveFile(file, key) });
		const datev = await b.store.settings.list({
			where: (/** @type {any} */ r) => r.key === 'datev'
		});
		expect(datev.map((/** @type {any} */ r) => r.value.consultantNumber)).toEqual(['1001']);
	});
});
