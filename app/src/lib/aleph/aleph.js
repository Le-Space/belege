// Aleph Cloud (issue #113): which own addresses are Aleph accounts, and a
// monthly consumption statement for each as an Eigenbeleg.
//
// Aleph issues no invoice: hosting and storage are paid in credits, bought
// from a wallet. The statement documents what the credits of one account
// were used for in one month – opening and closing balance, top-ups, and
// consumption per day (storage in one line, each instance in its own), with
// its euro value – so the tax adviser has a document per account and period.
// It is an Eigenbeleg (own number range EB-YYYY-NNN) and becomes a receipt
// like any other, not linked to a booking yet.
//
// Which addresses: those the person keeps under "Eigene Wallets" on an EVM
// chain (an Aleph account is an Ethereum address), when the scan is switched
// on – Aleph then learns that these addresses belong together – and any
// Aleph account typed in on its own. Kept in the sealed settings (`aleph`).
//
// The data comes from the bridge (bridge/src/aleph.js), read only, and is
// kept in neutral form on the receipt (`selfReceipt.aleph`), so the invoice
// app can later issue a proper invoice from the same numbers.

import { recordEvent } from '../activity/events.js';
import { getSetting, setSetting } from '../store/settings.js';
import { walletChain } from '../wallets/chains.js';
import { nextSelfNumber } from '../receipts/eigenbeleg.js';
import { importFile } from '../receipts/import.js';
import { t } from '../i18n/index.js';

/** @typedef {import('../bridge/client.js').AlephStatement} AlephStatement */

/**
 * @typedef {object} AlephSettings
 * @property {boolean} scan own EVM wallets are asked at Aleph
 * @property {string[]} extra accounts typed in, 0x…
 * @property {{ address: string, credits: number, entries: number, checkedAt: string }[]} accounts found
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<AlephSettings>} */
export async function loadAleph(settings) {
	const v = /** @type {any} */ (await getSetting(settings, 'aleph')) ?? {};
	return {
		scan: v.scan === true,
		extra: Array.isArray(v.extra)
			? v.extra.filter((/** @type {unknown} */ a) => ADDRESS.test(String(a)))
			: [],
		accounts: Array.isArray(v.accounts)
			? v.accounts.filter((/** @type {any} */ a) => ADDRESS.test(String(a?.address)))
			: []
	};
}

/** @param {import('../store/repository.js').Collection} settings @param {Partial<AlephSettings>} change */
export async function saveAleph(settings, change) {
	const next = { ...(await loadAleph(settings)), ...change };
	await setSetting(settings, 'aleph', next);
	return next;
}

/**
 * The addresses to ask at Aleph: the own EVM wallets when the scan is on,
 * and the accounts typed in; each once.
 *
 * @param {{ chain: string, address: string }[]} wallets
 * @param {AlephSettings} aleph
 */
export function candidateAddresses(wallets, aleph) {
	const from = [
		...(aleph.scan
			? wallets.filter((w) => walletChain(w.chain)?.kind === 'evm').map((w) => w.address)
			: []),
		...aleph.extra
	];
	/** @type {Map<string, string>} */
	const unique = new Map();
	for (const a of from) if (ADDRESS.test(a)) unique.set(a.toLowerCase(), a);
	return [...unique.values()];
}

/**
 * Ask the bridge which candidates are Aleph accounts, and keep those.
 *
 * @param {object} p
 * @param {{ alephAccounts: (addresses: string[]) => Promise<{ address: string, credits: number, entries: number }[]> }} p.client
 * @param {import('../store/repository.js').Collection} p.settings
 * @param {{ chain: string, address: string }[]} p.wallets
 * @param {() => Date} [p.now]
 */
export async function scanAleph({ client, settings, wallets, now = () => new Date() }) {
	const aleph = await loadAleph(settings);
	const addresses = candidateAddresses(wallets, aleph);
	const found = addresses.length ? await client.alephAccounts(addresses) : [];
	const checkedAt = now().toISOString();
	const accounts = found
		.filter((a) => a.credits > 0 || a.entries > 0)
		.map((a) => ({ ...a, checkedAt }));
	await saveAleph(settings, { accounts });
	return { asked: addresses.length, accounts };
}

/** `2026-08` → `2026-08-31`. @param {string} month */
export const lastDay = (month) => {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The month before the one of `now`, YYYY-MM. @param {Date} now */
export const previousMonth = (now) => {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	return d.toISOString().slice(0, 7);
};

/** @param {string} address @param {string} month */
export const statementRef = (address, month) => `aleph:${address.toLowerCase()}:${month}`;

/**
 * The statement of an account and month, when there is one.
 *
 * @param {Record<string, any>[]} receipts
 * @param {string} address
 * @param {string} month
 */
export const findStatement = (receipts, address, month) =>
	receipts.find(
		(r) => !r.deleted && r.source === 'eigenbeleg' && r.sourceRef === statementRef(address, month)
	) ?? null;

export const REASON =
	'Aleph Cloud stellt keine Rechnung aus: Hosting und Speicher werden mit Credits bezahlt, die vorher von einer eigenen Wallet gekauft oder von einem eigenen Konto übertragen wurden. Dieser Eigenbeleg weist aus, wofür die Credits des Kontos im Monat verbraucht wurden.';

/**
 * @typedef {object} StatementDocument what the PDF shows
 * @property {string} number EB-YYYY-NNN
 * @property {string} issuer
 * @property {string} accountName
 * @property {AlephStatement} statement
 * @property {string} reason
 * @property {string} createdAt ISO
 * @property {string} createdBy
 */

/**
 * Make the statement of an account and month, store it as a receipt.
 *
 * @param {object} p
 * @param {import('../matching/engine.js').MatchingStore} p.store
 * @param {import('../receipts/blob-store.js').BlobStore} p.blobs
 * @param {{ alephStatement: (address: string, month: string) => Promise<AlephStatement> }} p.client
 * @param {string} p.address
 * @param {string} p.month YYYY-MM
 * @param {string} [p.accountName] the wallet's name, when it has one
 * @param {string} [p.issuer]
 * @param {string} [p.createdBy]
 * @param {() => Date} [p.now]
 */
export async function createAlephStatement({
	store,
	blobs,
	client,
	address,
	month,
	accountName = '',
	issuer = '',
	createdBy = '',
	now = () => new Date()
}) {
	const all = await store.receipts.list({ includeDeleted: true });
	const existing = findStatement(all, address, month);
	if (existing) {
		throw new Error(t('messages.aleph.exists', { number: existing.selfNumber }));
	}
	const statement = await client.alephStatement(address, month);
	if (!statement.usage.length && !statement.topUps.length && !statement.transfersOut.length) {
		throw new Error(t('messages.aleph.nothing'));
	}
	const created = now();
	const number = nextSelfNumber(all, month.slice(0, 4));
	/** @type {StatementDocument} */
	const doc = {
		number,
		issuer,
		accountName,
		statement,
		reason: REASON,
		createdAt: created.toISOString(),
		createdBy
	};
	const { statementPdf } = await import('./statement-pdf.js');
	const bytes = await statementPdf(doc);
	const { record } = await importFile({
		receipts: store.receipts,
		blobs,
		bytes,
		fileName: `${number} Aleph ${month}.pdf`,
		source: 'eigenbeleg',
		sourceRef: statementRef(address, month),
		fields: {
			confirmedByUser: true,
			vendor: 'Aleph Cloud (Eigenbeleg)',
			documentDate: lastDay(month),
			amountCents: statement.totals.eurCents ?? 0,
			currency: 'EUR',
			selfNumber: number,
			selfReceipt: {
				kind: 'aleph-statement',
				counterparty: 'Aleph Cloud',
				description: `Verbrauch von Aleph-Credits ${month}`,
				reason: REASON,
				createdAt: doc.createdAt,
				createdBy,
				// The numbers, for the invoice app later (issue #113, stage 2).
				aleph: {
					address,
					month,
					opening: statement.opening,
					closing: statement.closing,
					usage: statement.totals.usage,
					topUps: statement.totals.topUps,
					transfersOut: statement.totals.transfersOut,
					eurCents: statement.totals.eurCents,
					difference: statement.difference
				}
			}
		}
	});
	if (!record) throw new Error(t('messages.aleph.saveFailed'));
	await recordEvent(store.events, 'decision', {
		action: 'aleph-statement',
		receiptId: record.id,
		number,
		month
	});
	return { receipt: record, number, statement };
}
