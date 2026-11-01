// "Ist das ein eigenes Konto?" (issue #256): an IBAN that sends under the
// company's name is offered as own, with the open payments to it it explains;
// saved or refused, it is offered no more. Made-up IBANs and names.
import { describe, expect, it } from 'vitest';

import { classifyTransaction, cleanMatchingSettings } from './classify.js';
import { groupIban, ownIbanSuggestionFor, ownIbanSuggestions } from './own-iban.js';
import { addOwnIban, rejectOwnIban } from './actions.js';

const WISE = 'BE00999900001111';
const OTHER = 'DE00123400005678';

/** @param {string} id @param {number} cents @param {string} iban @param {string} [name] */
const out = (id, cents, iban, name = 'Wise Europe SA') => ({
	id,
	accountId: 'gls',
	bookedOn: '2026-09-03',
	amountCents: -cents,
	counterparty: name,
	counterpartyIban: iban,
	purpose: 'Aufladung'
});
/** @param {string} id @param {number} cents @param {string} iban @param {string} [name] */
const back = (id, cents, iban, name = 'Musterfirma UG') => ({
	id,
	accountId: 'gls',
	bookedOn: '2026-09-05',
	amountCents: cents,
	counterparty: name,
	counterpartyIban: iban,
	purpose: 'Rückzahlung'
});

const transactions = [
	out('o1', 17200, WISE),
	back('b1', 17200, `BE00 9999 0000 1111`),
	out('o2', 12000, WISE),
	back('b2', 12000, WISE),
	out('o3', 8000, OTHER, 'Lieferant AG'),
	back('b3', 500, OTHER, 'Nordwind GmbH')
];
/** The rules' context, as the engine builds it. @param {string[]} [ownIbans] */
const ctx = (ownIbans = []) => ({
	companyNames: ['Musterfirma UG'],
	ownIbans: new Set(ownIbans),
	ownLast4: new Map(),
	rules: []
});
// What the rules make of them today: the way back by the company's name, the way there not at all.
const classifications = /** @type {Record<string, any>} */ (
	Object.fromEntries(
		transactions.map((t) => [t.id, classifyTransaction(t, ctx())]).filter(([, c]) => c)
	)
);

describe('own IBAN suggestions', () => {
	it('offer the IBAN that sends under our name, with the open payments to it', () => {
		expect(classifications.b1).toMatchObject({ kind: 'own-transfer', via: 'company' });
		const [s, ...rest] = ownIbanSuggestions({ transactions, classifications });
		expect(rest).toEqual([]);
		expect(s.iban).toBe(WISE);
		expect(s.sender).toBe('Musterfirma UG');
		expect(s.incoming.map((t) => t.id)).toEqual(['b1', 'b2']);
		expect(s.outgoing.map((t) => t.id)).toEqual(['o1', 'o2']);
		expect(ownIbanSuggestionFor([s], transactions[0])?.iban).toBe(WISE);
		expect(ownIbanSuggestionFor([s], transactions[4])).toBeNull();
		expect(groupIban(WISE)).toBe('BE00 9999 0000 1111');
	});

	it('offer nothing for an IBAN already own, or one a person refused', () => {
		expect(ownIbanSuggestions({ transactions, classifications, ownIbans: [WISE] })).toEqual([]);
		expect(
			ownIbanSuggestions({ transactions, classifications, notOwnIbans: ['be00 9999 0000 1111'] })
		).toEqual([]);
	});

	it('a sender whose name only looks like ours is offered, never taken: the click decides', () => {
		const similar = [...transactions, back('b4', 900, OTHER, 'Musterfirma UG Kunde')];
		const classified = /** @type {Record<string, any>} */ (
			Object.fromEntries(
				similar.map((t) => [t.id, classifyTransaction(t, ctx())]).filter(([, c]) => c)
			)
		);
		const offered = ownIbanSuggestions({ transactions: similar, classifications: classified });
		expect(offered.map((x) => x.iban)).toEqual([WISE, OTHER]);
		// Offered, and nothing more: the payment to that IBAN is still no own transfer.
		expect(classifyTransaction(similar[4], ctx())).toBeNull();
	});

	it('count only payments still open: one with a receipt is explained already', () => {
		const withReceipt = transactions.map((t) => (t.id === 'o1' ? { ...t, receiptId: 'r1' } : t));
		const [s] = ownIbanSuggestions({ transactions: withReceipt, classifications });
		expect(s.outgoing.map((t) => t.id)).toEqual(['o2']);
	});
});

describe('saving and refusing', () => {
	/** Settings and events in memory, as the store's collections. */
	const store = () => {
		/** @type {Record<string, any>[]} */
		const rows = [];
		const collection = {
			list: async (
				/** @type {{ where?: (r: Record<string, any>) => boolean }} */ { where = () => true } = {}
			) => rows.filter((r) => !r.deleted && where(r)),
			put: async (/** @type {Record<string, any>} */ r) => {
				const at = rows.findIndex((x) => x.id === r.id);
				const saved = { ...r, id: r.id ?? `s${rows.length + 1}` };
				if (at >= 0) rows[at] = saved;
				else rows.push(saved);
				return saved;
			}
		};
		return { settings: collection, events: { ...collection }, rows };
	};
	const matching = async (/** @type {any} */ s) =>
		cleanMatchingSettings(
			(await s.settings.list({ where: (/** @type {any} */ r) => r.key === 'matching' }))[0]?.value
		);

	it('a saved IBAN is own, once, and makes the payments to it own transfers', async () => {
		const s = store();
		await addOwnIban(/** @type {any} */ (s), 'be00 9999 0000 1111');
		await addOwnIban(/** @type {any} */ (s), WISE);
		const settings = await matching(s);
		expect(settings.ownIbans).toEqual([WISE]);
		expect(classifications.o1).toBeUndefined();
		const c = classifyTransaction(transactions[0], ctx(settings.ownIbans));
		expect(c).toMatchObject({ kind: 'own-transfer', via: 'iban', ibanLast4: '1111' });
	});

	it('a refused IBAN is kept as not ours, and saving it later takes that back', async () => {
		const s = store();
		await rejectOwnIban(/** @type {any} */ (s), WISE);
		expect((await matching(s)).notOwnIbans).toEqual([WISE]);
		await addOwnIban(/** @type {any} */ (s), WISE);
		const settings = await matching(s);
		expect(settings.notOwnIbans).toEqual([]);
		expect(settings.ownIbans).toEqual([WISE]);
	});
});
