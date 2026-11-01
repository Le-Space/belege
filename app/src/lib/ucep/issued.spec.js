import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { runMatching } from '../matching/engine.js';
import { unlinkMatch } from '../matching/actions.js';
import { receiptFacts } from '../matching/score.js';
import { vatCase } from '../vat/vat-kind.js';
import { CII_XRECHNUNG, UBL_INVOICE } from '../receipts/einvoice.fixtures.js';
import {
	centsOf,
	extractionOf,
	paymentPlan,
	receiptFieldsOf,
	sourceRefOf,
	syncIssuedInvoices
} from './issued.js';

const PDF = (/** @type {string} */ n) => new TextEncoder().encode(`%PDF-1.4\n% ${n}\n%%EOF\n`);
const b64 = (/** @type {Uint8Array} */ bytes) => btoa(String.fromCharCode(...bytes));
const hex = async (/** @type {Uint8Array} */ bytes) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes))),
		(b) => b.toString(16).padStart(2, '0')
	).join('');

/** @returns {import('./issued.js').IssuedInvoice} */
const invoice = (over = {}) => ({
	documentId: 'doc-4',
	number: 'RE-2026-0004',
	state: 'issued',
	issuedOn: '2026-09-01',
	dueOn: '2026-09-15',
	customer: { name: 'Beispiel Kunde GmbH' },
	total: { value: '119.00', currency: 'EUR' },
	paid: { value: '0.00', currency: 'EUR' },
	payments: [],
	...over
});

const XML = new TextEncoder().encode(CII_XRECHNUNG);

/**
 * The invoicing app as strict as the spec: scopes, cancelled invoices,
 * currency, a PDF only over a direct connection, and since 0.4.0 an
 * XRechnung inline while it fits the relay (`options.xmlInline`).
 */
function fakeApp({ direct = true, scopes = true, xmlInline = true } = {}) {
	const options = { xmlInline };
	/** @type {Map<string, any>} */
	const docs = new Map();
	/** @type {any[]} */
	const calls = [];
	const consumer = {
		addProvider: async () => ({ reachable: true }),
		/** @param {string} _peer @param {string} ext @param {string} cmd @param {any} args */
		async call(_peer, ext, cmd, args) {
			calls.push({ ext, cmd, args });
			if (!scopes && cmd !== 'help') throw Object.assign(new Error(cmd), { code: 'SCOPE_MISSING' });
			if (cmd === 'list-issued') {
				return { invoices: [...docs.values()].map((d) => structuredClone(d.inv)), next: null };
			}
			const d = docs.get(args.documentId);
			if (!d) throw Object.assign(new Error('documentId'), { code: 'INVALID_ARGUMENTS' });
			if (cmd === 'get-pdf') {
				return {
					mime: 'application/pdf',
					sha256: await hex(d.pdf),
					...(direct ? { base64: b64(d.pdf) } : {})
				};
			}
			if (cmd === 'get-xml') {
				if (!d.xml) throw Object.assign(new Error('no XRechnung'), { code: 'INVALID_ARGUMENTS' });
				return {
					mime: 'application/xml',
					sha256: d.xmlSha256 ?? (await hex(d.xml)),
					...(options.xmlInline ? { base64: b64(d.xml) } : {})
				};
			}
			if (cmd === 'record-payment') {
				if (d.inv.state === 'cancelled')
					throw Object.assign(new Error('x'), { code: 'INVALID_ARGUMENTS' });
				const others = d.inv.payments.filter(
					(/** @type {any} */ p) => p.reference.id !== args.reference.id
				);
				if (args.paidOn !== null) {
					if (args.amount.currency !== d.inv.total.currency) {
						throw Object.assign(new Error('currency'), { code: 'INVALID_ARGUMENTS' });
					}
					others.push({ paidOn: args.paidOn, amount: args.amount, reference: args.reference });
				}
				d.inv.payments = others;
				const paid = others.reduce(
					(/** @type {number} */ s, /** @type {any} */ p) =>
						s + /** @type {number} */ (centsOf(p.amount.value)),
					0
				);
				const total = /** @type {number} */ (centsOf(d.inv.total.value));
				d.inv.paid = { value: (paid / 100).toFixed(2), currency: 'EUR' };
				return {
					documentId: args.documentId,
					state:
						paid === 0
							? 'open'
							: paid < total
								? 'partially-paid'
								: paid === total
									? 'paid'
									: 'overpaid'
				};
			}
			throw Object.assign(new Error(cmd), { code: 'UNKNOWN_COMMAND' });
		}
	};
	return {
		consumer,
		calls,
		options,
		/**
		 * @param {import('./issued.js').IssuedInvoice} inv
		 * @param {{ xml?: Uint8Array, xmlSha256?: string }} [files] an XRechnung, and the hash the app states for it
		 */
		add: (inv, files = {}) => docs.set(inv.documentId, { inv, pdf: PDF(inv.number), ...files }),
		/** @param {string} id */
		get: (id) => docs.get(id).inv
	};
}

/** @type {any} */
let store;
/** @type {import('../receipts/blob-store.js').BlobStore} */
let blobs;
const paired = { peerId: 'app-peer', addrs: ['/memory/app'], pairedAt: '2026-09-01T00:00:00Z' };

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

/** An incoming payment on a made-up account. */
async function incoming(over = {}) {
	const account = await store.accounts.put({
		source: 'hibiscus',
		name: 'Konto A',
		currency: 'EUR'
	});
	return store.transactions.put({
		accountId: account.id,
		source: 'hibiscus',
		bookedOn: '2026-09-12',
		amountCents: 11900,
		currency: 'EUR',
		counterparty: 'Beispiel Kunde GmbH',
		purpose: 'Rechnung RE-2026-0004',
		...over
	});
}

const sync = (/** @type {any} */ app) =>
	syncIssuedInvoices({
		consumer: app.consumer,
		app: paired,
		store,
		blobs,
		match: () => runMatching({ store, now: new Date('2026-09-20T12:00:00Z') })
	});

describe('amounts and receipts of issued invoices', () => {
	it('decimal strings as cents, without floats', () => {
		expect(centsOf('119.00')).toBe(11900);
		expect(centsOf('0.1')).toBe(10);
		expect(centsOf('7')).toBe(700);
		expect(centsOf('-2.5')).toBe(-250);
		expect(centsOf('1.005')).toBeNull();
		expect(centsOf('abc')).toBeNull();
	});

	it('an issued invoice is ours, due when the app says, and names its customer', () => {
		const fields = receiptFieldsOf(invoice());
		expect(fields).toMatchObject({
			ownInvoice: true,
			invoiceNumber: 'RE-2026-0004',
			amountCents: 11900,
			dueOn: '2026-09-15',
			customer: 'Beispiel Kunde GmbH'
		});
		const facts = receiptFacts({ id: 'r', ...fields });
		expect(facts).toMatchObject({
			ours: true,
			direction: 'income',
			customer: 'Beispiel Kunde GmbH'
		});
	});
});

describe('the VAT of an issued invoice (#195)', () => {
	const inv = /** @type {any} */ ({
		documentId: 'd1',
		number: 'RE-2026-007',
		state: 'issued',
		issuedOn: '2026-09-01',
		customer: { name: 'Kundin Beispiel UG' },
		total: { value: '1190.00', currency: 'EUR' }
	});
	it('per rate where the app says it, none charged as an empty list, unsaid as absent', () => {
		expect(
			extractionOf({
				...inv,
				net: { value: '1000.00', currency: 'EUR' },
				vat: [{ rate: '19', amount: { value: '190.00', currency: 'EUR' } }]
			})
		).toMatchObject({ net: 1000, vat: [{ rate: 19, amount: 190 }], gross: 1190 });
		expect(extractionOf({ ...inv, vat: [] }).vat).toEqual([]);
		expect('vat' in extractionOf(inv)).toBe(false);
	});

	it('invoice 0.3.0: the category of each line and the customer’s VAT ID, for the VAT cases (#354)', () => {
		const rc = extractionOf({
			...inv,
			customer: { name: 'Kunde Beispiel GmbH', vatId: 'atu 000 000 00' },
			total: { value: '1000.00', currency: 'EUR' },
			net: { value: '1000.00', currency: 'EUR' },
			vat: [{ rate: '0', category: 'AE', amount: { value: '0.00', currency: 'EUR' } }]
		});
		expect(rc).toMatchObject({
			customer_vat_id: 'ATU00000000',
			customer_country: 'AT',
			vat: [{ rate: 0, amount: 0, category: 'reverse_charge' }]
		});
		// Sorted as a §13b service to a business in another EU country: for the ZM.
		expect(
			vatCase({ id: 'R', ownInvoice: true, amountCents: 100000, extraction: rc }, true)
		).toMatchObject({
			kind: 'intraEu',
			vatId: 'ATU00000000',
			netCents: 100000
		});
		// A small business: E, at 0 – no VAT, and why.
		expect(
			extractionOf({
				...inv,
				vat: [{ rate: '0', category: 'E', amount: { value: '0.00', currency: 'EUR' } }]
			}).vat
		).toEqual([{ rate: 0, amount: 0, category: 'exempt' }]);
		// A VAT ID that is none is not taken.
		expect(
			'customer_vat_id' in extractionOf({ ...inv, customer: { name: 'X', vatId: 'keine' } })
		).toBe(false);
	});
});

describe('what the app is told', () => {
	const tx = { id: 'tx-1', bookedOn: '2026-09-12', amountCents: 11900, currency: 'EUR' };

	it('a new link is recorded; the same again is not; a gone one is removed', () => {
		expect(paymentPlan(invoice(), [{ tx, shared: false }]).record).toEqual([
			{
				paidOn: '2026-09-12',
				amount: { value: '119', currency: 'EUR' },
				reference: { system: 'belege', id: 'tx-1' }
			}
		]);
		const reported = invoice({
			payments: [
				{
					paidOn: '2026-09-12',
					amount: { value: '119.00', currency: 'EUR' },
					reference: { system: 'belege', id: 'tx-1' }
				},
				{
					paidOn: '2026-09-02',
					amount: { value: '5.00', currency: 'EUR' },
					reference: { system: 'other', id: 'x' }
				}
			]
		});
		expect(paymentPlan(reported, [{ tx, shared: false }])).toEqual({ record: [], remove: [] });
		// Only Belege's own references are Belege's to take back.
		expect(paymentPlan(reported, [])).toEqual({ record: [], remove: ['tx-1'] });
	});

	it('an outgoing booking, another currency or a transfer for several invoices', () => {
		expect(
			paymentPlan(invoice(), [{ tx: { ...tx, amountCents: -11900 }, shared: false }]).record
		).toEqual([]);
		expect(
			paymentPlan(invoice(), [{ tx: { ...tx, currency: 'USD' }, shared: false }]).record
		).toEqual([]);
		const big = { ...tx, amountCents: 30000 };
		expect(paymentPlan(invoice(), [{ tx: big, shared: true }]).record[0].amount.value).toBe('119');
		expect(paymentPlan(invoice(), [{ tx: big, shared: false }]).record[0].amount.value).toBe('300');
	});
});

describe('Rechnungen abgleichen', () => {
	it('the invoice comes in, the matching links its payment, the app learns it is paid', async () => {
		const app = fakeApp();
		app.add(invoice());
		const tx = await incoming();
		const first = await sync(app);
		expect(first).toMatchObject({ invoices: 1, added: 1, reported: 1, paid: 1 });
		const receipts = await store.receipts.list();
		expect(receipts).toHaveLength(1);
		expect(receipts[0]).toMatchObject({ source: 'invoice-app', sourceRef: sourceRefOf('doc-4') });
		expect(app.get('doc-4').payments).toEqual([
			{
				paidOn: '2026-09-12',
				amount: { value: '119', currency: 'EUR' },
				reference: { system: 'belege', id: tx.id }
			}
		]);
		// What goes to the app: never the purpose, the payer or an account.
		const sent = JSON.stringify(app.calls.filter((c) => c.cmd === 'record-payment'));
		expect(sent).not.toMatch(/Beispiel Kunde|RE-2026-0004|Konto|purpose/);

		// Again: nothing new, nothing sent twice.
		expect(await sync(app)).toMatchObject({ added: 0, reported: 0, removed: 0, paid: 1 });

		// The person unlinks it: the app hears that too.
		const match = (await store.matches.list()).find(
			(/** @type {any} */ m) => m.state !== 'rejected'
		);
		await unlinkMatch(store, match.id);
		expect(await sync(app)).toMatchObject({ removed: 1, paid: 0 });
		expect(app.get('doc-4').payments).toEqual([]);
	});

	it('a PDF only over a direct connection: that invoice comes next time', async () => {
		const app = fakeApp({ direct: false });
		app.add(invoice());
		expect(await sync(app)).toMatchObject({ invoices: 1, added: 0, pdfLater: 1 });
		expect(await store.receipts.list()).toHaveLength(0);
	});

	it('a cancelled invoice is set aside when nothing links it', async () => {
		const app = fakeApp();
		app.add(invoice());
		await sync(app);
		app.get('doc-4').state = 'cancelled';
		await sync(app);
		const [receipt] = await store.receipts.list();
		expect(receipt.setAside?.reason).toBe('not-needed');
	});

	it('an XRechnung comes beside its PDF, as the original (invoice 0.4.0)', async () => {
		const app = fakeApp();
		app.add(invoice({ formats: ['pdf', 'xrechnung'] }), { xml: XML });
		expect(await sync(app)).toMatchObject({ added: 1, xml: 1, xmlLater: 0 });
		const [receipt] = await store.receipts.list();
		// The PDF stays the file every preview opens; the XML lies beside it.
		expect(receipt).toMatchObject({ mime: 'application/pdf', status: 'ausgelesen' });
		expect(await blobs.get(receipt.xmlCid)).toEqual(XML);
		expect(new TextDecoder().decode(await blobs.get(receipt.fileCid))).toMatch(/^%PDF-/);
		// Taken: not asked again.
		await sync(app);
		expect(app.calls.filter((c) => c.cmd === 'get-xml')).toHaveLength(1);
	});

	it('an app before 0.4.0 names no formats and is not asked for XML', async () => {
		const app = fakeApp();
		app.add(invoice(), { xml: XML });
		expect(await sync(app)).toMatchObject({ added: 1, xml: 0, xmlLater: 0 });
		expect(app.calls.some((c) => c.cmd === 'get-xml')).toBe(false);
		expect((await store.receipts.list())[0].xmlCid).toBeUndefined();
	});

	it('an XRechnung too large for the relay comes at a later sync, onto the receipt taken over', async () => {
		const app = fakeApp({ xmlInline: false });
		app.add(invoice({ formats: ['pdf', 'xrechnung'] }), { xml: XML });
		expect(await sync(app)).toMatchObject({ added: 1, xml: 0, xmlLater: 1 });
		const [before] = await store.receipts.list();
		expect(before.xmlCid).toBeUndefined();

		app.options.xmlInline = true;
		expect(await sync(app)).toMatchObject({ added: 0, xml: 1, xmlLater: 0 });
		const [after] = await store.receipts.list();
		expect(await blobs.get(after.xmlCid)).toEqual(XML);
		// Nothing else of the receipt changes.
		expect({ ...after, xmlCid: undefined, updatedAt: undefined }).toEqual({
			...before,
			xmlCid: undefined,
			updatedAt: undefined
		});
	});

	it('refuses an XRechnung that is not what the app states, or no CII e-invoice', async () => {
		const wrongHash = fakeApp();
		wrongHash.add(invoice({ formats: ['pdf', 'xrechnung'] }), {
			xml: XML,
			xmlSha256: '0'.repeat(64)
		});
		await expect(sync(wrongHash)).rejects.toThrow(/XRechnung der Rechnung RE-2026-0004/);
		// Nothing half taken over: the next sync tries the whole invoice again.
		expect(await store.receipts.list()).toHaveLength(0);

		const ubl = fakeApp();
		ubl.add(invoice({ formats: ['pdf', 'xrechnung'] }), {
			xml: new TextEncoder().encode(UBL_INVOICE)
		});
		await expect(sync(ubl)).rejects.toThrow(/XRechnung der Rechnung/);
		expect(await store.receipts.list()).toHaveLength(0);
	});

	it('a pairing from before 0.2.0 says to pair again', async () => {
		const app = fakeApp({ scopes: false });
		await expect(sync(app)).rejects.toThrow(/neu koppeln/);
	});
});
