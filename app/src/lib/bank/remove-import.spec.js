import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { importCamtStatements } from './import.js';
import { parseCamt053 } from './camt.js';
import { fileImportContents, isFileAccount, removeFileImport } from './remove-import.js';
import { memoryCollection } from './test-support.js';

const statements = (/** @type {string} */ name) =>
	parseCamt053(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'), {
		DOMParser: /** @type {any} */ (DOMParser)
	});

function books() {
	return {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection,
		matches: memoryCollection('matches').collection,
		questions: memoryCollection('questions').collection,
		events: memoryCollection('events').collection
	};
}

describe('removeFileImport', () => {
	it('takes the account out with its bookings, matches and questions; the other account stays', async () => {
		const store = books();
		const [kept] = await importCamtStatements(store, statements('camt053-german-bank.xml'));
		const [gone] = await importCamtStatements(store, statements('camt053-revolut.xml'));
		const [first, second] = await store.transactions.list({
			where: (t) => t.accountId === gone.account.id
		});
		await store.transactions.put({ ...first, receiptId: 'r1', booking: { confirmedAt: 'x' } });
		const match = await store.matches.put({
			transactionId: first.id,
			receiptId: 'r1',
			state: 'confirmed'
		});
		await store.questions.put({ kind: 'missing', transactionId: second.id, state: 'open' });
		const [other] = await store.transactions.list({
			where: (t) => t.accountId === kept.account.id
		});
		await store.matches.put({ transactionId: other.id, receiptId: 'r2', state: 'confirmed' });

		expect(await fileImportContents(store, gone.account.id)).toEqual({
			bookings: 2,
			withReceipt: 1,
			confirmed: 1
		});
		expect(await removeFileImport(store, gone.account.id)).toEqual({ bookings: 2, matches: 1 });

		expect((await store.accounts.list()).map((a) => a.id)).toEqual([kept.account.id]);
		expect(await store.transactions.list()).toHaveLength(4);
		expect(await store.transactions.list({ includeDeleted: true })).toHaveLength(6);
		expect(await store.questions.list()).toHaveLength(0);
		expect((await store.matches.list()).map((m) => m.receiptId)).toEqual(['r2']);
		// The receipt's side reads it as undone, not as still matched.
		expect((await store.matches.get(match.id))?.state).toBe('rejected');
		const [event] = await store.events.list();
		expect(event).toMatchObject({
			kind: 'import-removed',
			accountId: gone.account.id,
			source: 'camt',
			bookings: 2,
			matches: 1
		});
		expect(event.account).toContain('···0001');
	});

	it('the same file again makes a new account with new bookings', async () => {
		const store = books();
		const [first] = await importCamtStatements(store, statements('camt053-revolut.xml'));
		await removeFileImport(store, first.account.id);
		const [again] = await importCamtStatements(store, statements('camt053-revolut.xml'));
		expect(again.counts).toEqual({ new: 2, updated: 0, skipped: 0 });
		expect(again.account.id).not.toBe(first.account.id);
		expect(await store.transactions.list()).toHaveLength(2);
	});

	it('only an account from a file: a synced one, a removed one and an unknown id are refused', async () => {
		const store = books();
		const synced = await store.accounts.put({ source: 'hibiscus', name: 'Konto A' });
		const tx = await store.transactions.put({ accountId: synced.id, amountCents: -1234 });
		expect(isFileAccount(synced)).toBe(false);
		expect(isFileAccount({ source: 'card' })).toBe(true);
		expect(isFileAccount({ source: 'camt', deleted: true })).toBe(false);
		await expect(removeFileImport(store, synced.id)).rejects.toThrow(/file import/);
		await expect(removeFileImport(store, '01HZZZZZZZZZZZZZZZZZZZZZZZ')).rejects.toThrow();
		expect((await store.transactions.get(tx.id))?.deleted).toBe(false);
		expect(await store.events.list()).toHaveLength(0);
	});
});
