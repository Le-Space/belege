import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { runMatching } from '../matching/engine.js';
import { unlinkMatch } from '../matching/actions.js';
import { receiptFacts } from '../matching/score.js';
import {
	centsOf,
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

/**
 * The invoicing app as strict as the spec: scopes, cancelled invoices,
 * currency, and a PDF only over a direct connection.
 */
function fakeApp({ direct = true, scopes = true } = {}) {
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
		/** @param {import('./issued.js').IssuedInvoice} inv */
		add: (inv) => docs.set(inv.documentId, { inv, pdf: PDF(inv.number) }),
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

	it('a pairing from before 0.2.0 says to pair again', async () => {
		const app = fakeApp({ scopes: false });
		await expect(sync(app)).rejects.toThrow(/neu koppeln/);
	});
});
