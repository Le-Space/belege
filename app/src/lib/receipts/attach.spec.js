// "Beleg hochladen und dieser Zahlung zuordnen", and the folder check.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { tx } from '../matching/fixtures.js';
import { createBlobStore } from './blob-store.js';
import { attachUpload, contradictions } from './attach.js';
import { checkFolder, watchFolder } from './folder-watch.js';

const pdf = (/** @type {string} */ marker) =>
	new TextEncoder().encode(`%PDF-1.4\n${marker}\n%%EOF`);

/** @type {Record<string, any>} */
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

/** @param {Record<string, any>} answer */
const bridge = (answer) => ({
	extract: async () => ({
		extraction: { currency: 'EUR', ...answer },
		model: 'deepseek-flash',
		usage: { prompt: 10, completion: 10, reasoning: 0 },
		ms: 100,
		attempts: [],
		redactions: { terms: 0, iban: 0, email: 0, street: 0, postcode: 0, link: 0, total: 0 },
		sentText: 'x'
	})
});
const pdfText = async () => ({ text: 'Anbieter: Kabel Test GmbH, Brutto 39,99 EUR' });

async function booking() {
	/** @type {Record<string, any>} */
	const rest = {
		...tx({
			bookedOn: '2026-09-02',
			amountCents: -3999,
			counterparty: 'Kabel Test GmbH',
			purpose: 'Rechnung KT-2026-0901'
		})
	};
	delete rest.id;
	return store.transactions.put(rest);
}

describe('attachUpload', () => {
	it('stores, reads and links to this booking as confirmed; the points are kept', async () => {
		const t = await booking();
		const r = await attachUpload({
			store: /** @type {any} */ (store),
			blobs,
			client: bridge({ vendor: 'Kabel Test GmbH', gross: 39.99, invoice_number: 'KT-2026-0901' }),
			tx: t,
			file: { name: 'rechnung.pdf', bytes: pdf('A') },
			pdfText
		});
		expect(r).toMatchObject({ outcome: 'linked', duplicate: false, warnings: [] });
		expect(r.score).toBeGreaterThanOrEqual(90);
		const [m] = await store.matches.list();
		expect(m).toMatchObject({
			transactionId: t.id,
			receiptId: r.receipt?.id,
			state: 'confirmed',
			score: r.score
		});
		expect(m.reasons).toContain('manual');
		expect((await store.transactions.get(t.id)).receiptId).toBe(r.receipt?.id);
		expect((await store.receipts.get(r.receipt?.id)).source).toBe('upload');
		const kinds = (await store.events.list()).map((/** @type {any} */ e) => e.action ?? e.kind);
		expect(kinds).toContain('upload-link');
		expect(kinds).toContain('extract');
	});

	it('low points still link, with the contradictions named; the same file again is that receipt', async () => {
		const t = await booking();
		const first = await attachUpload({
			store: /** @type {any} */ (store),
			blobs,
			client: bridge({ vendor: 'Anderer Laden', gross: 12.5, invoice_number: 'AL-777777' }),
			tx: t,
			file: { name: 'falsch.pdf', bytes: pdf('B') },
			pdfText
		});
		expect(first.outcome).toBe('linked');
		expect(first.warnings).toEqual(['amount', 'invoice-number']);
		expect((await store.matches.list())[0].state).toBe('confirmed');
		const again = await attachUpload({
			store: /** @type {any} */ (store),
			blobs,
			client: null,
			tx: t,
			file: { name: 'nochmal.pdf', bytes: pdf('B') }
		});
		expect(again).toMatchObject({ outcome: 'linked', duplicate: true });
		expect(again.receipt?.id).toBe(first.receipt?.id);
		expect(await store.receipts.list()).toHaveLength(1);
	});

	it('not a receipt file: refused, nothing linked; without a bridge: linked, but unread', async () => {
		const t = await booking();
		const bad = await attachUpload({
			store: /** @type {any} */ (store),
			blobs,
			client: null,
			tx: t,
			file: { name: 'x.txt', bytes: new TextEncoder().encode('hello') }
		});
		expect(bad.outcome).toBe('unsupported');
		expect(await store.matches.list()).toHaveLength(0);
		const unread = await attachUpload({
			store: /** @type {any} */ (store),
			blobs,
			client: null,
			tx: t,
			file: { name: 'scan.pdf', bytes: pdf('C') }
		});
		expect(unread).toMatchObject({ outcome: 'linked', warnings: ['unread'], score: null });
	});

	it('contradictions: another amount, an invoice number not in the purpose', () => {
		const t = { amountCents: -3999, purpose: 'Rechnung KT-2026-0901', endToEndId: '' };
		expect(contradictions({ amountCents: 3999, invoiceNumber: 'KT 2026 0901' }, t)).toEqual([]);
		expect(contradictions({ amountCents: 4000, invoiceNumber: 'XY-99999' }, t)).toEqual([
			'amount',
			'invoice-number'
		]);
		expect(contradictions({ amountCents: null, invoiceNumber: '12' }, t)).toEqual([]);
	});
});

describe('checkFolder and watchFolder', () => {
	/** @param {Record<string, string>} files path → marker */
	const folder = (files, permission = 'granted') => ({
		reads: /** @type {string[]} */ ([]),
		queryPermission: async () => permission,
		requestPermission: async () => 'granted',
		files
	});
	/** @param {ReturnType<typeof folder>} f */
	const list = async (f) =>
		Object.entries(f.files).map(([path, marker]) => ({
			name: path.split('/').at(-1) ?? path,
			path,
			bytes: async () => {
				f.reads.push(path);
				return pdf(marker);
			}
		}));

	it('imports new paths only, reading no file twice; one event when something was new', async () => {
		const f = folder({ 'a.pdf': 'A', 'sub/b.pdf': 'B' });
		const first = await checkFolder({ store: /** @type {any} */ (store), blobs, handle: f, list });
		expect(first).toMatchObject({ permitted: true, counts: { new: 2, known: 0 } });
		expect(first.created).toHaveLength(2);
		f.files['c.pdf'] = 'C';
		const second = await checkFolder({ store: /** @type {any} */ (store), blobs, handle: f, list });
		expect(second.counts).toMatchObject({ new: 1, known: 2 });
		expect(f.reads).toEqual(['a.pdf', 'sub/b.pdf', 'c.pdf']);
		const third = await checkFolder({ store: /** @type {any} */ (store), blobs, handle: f, list });
		expect(third.counts).toMatchObject({ new: 0, known: 3 });
		const imports = (await store.events.list()).filter(
			(/** @type {any} */ e) => e.kind === 'file-import'
		);
		expect(imports).toHaveLength(2);
	});

	it('without permission the timer does nothing; a click may ask', async () => {
		const f = folder({ 'a.pdf': 'A' }, 'prompt');
		expect(
			(await checkFolder({ store: /** @type {any} */ (store), blobs, handle: f, list })).permitted
		).toBe(false);
		expect(f.reads).toEqual([]);
		const asked = await checkFolder({
			store: /** @type {any} */ (store),
			blobs,
			handle: f,
			list,
			prompt: true
		});
		expect(asked.counts?.new).toBe(1);
	});

	it('watchFolder runs only while visible', async () => {
		let visible = false;
		let runs = 0;
		const stop = watchFolder(async () => void runs++, { intervalMs: 5, visible: () => visible });
		await new Promise((r) => setTimeout(r, 30));
		expect(runs).toBe(0);
		visible = true;
		await new Promise((r) => setTimeout(r, 30));
		stop();
		expect(runs).toBeGreaterThan(0);
	});
});
