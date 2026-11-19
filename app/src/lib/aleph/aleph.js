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
// The data comes from the bridge, which reads it with @le-space/chains
// (packages/chains/src/aleph.js), read only, and is
// kept in neutral form on the receipt (`selfReceipt.aleph`), so the invoice
// app can later issue a proper invoice from the same numbers.

import { recordEvent } from '../activity/events.js';
import { getSetting, setSetting } from '../store/settings.js';
import { walletChain } from '../wallets/chains.js';
import { nextSelfNumber } from '@le-space/eigenbeleg/booking';
import { importFile } from '../receipts/import.js';
import { t } from '../i18n/index.js';

/** @typedef {import('../bridge/client.js').AlephStatement} AlephStatement */

/**
 * @typedef {object} AlephSettings
 * @property {boolean} scan own EVM wallets are asked at Aleph
 * @property {string[]} extra accounts typed in, 0x…
 * @property {{ address: string, credits: number, entries: number, checkedAt: string }[]} accounts found
 * @property {AlephPurchase[]} purchases the credit purchases of these accounts, with the paying transaction
 */

/**
 * A purchase of credits as Aleph lists it, kept so that the booking of its
 * payment – on an own wallet or an exchange – is known by its hash
 * (matching/classify.js).
 *
 * @typedef {object} AlephPurchase
 * @property {string} address the Aleph account that got the credits
 * @property {string} txHash the paying transaction, as Aleph names it
 * @property {string} time ISO
 * @property {number} credits
 * @property {string | null} chain Aleph's code of the chain it was paid on
 * @property {string | null} token
 */

/** A transaction hash or id as a chain names it; nothing else is kept. */
const TX_HASH = /^[A-Za-z0-9]{32,128}$/;
/** More purchases than anyone makes; the oldest go first. */
const MAX_PURCHASES = 1000;

/** @param {unknown} list @returns {AlephPurchase[]} */
function cleanPurchases(list) {
	if (!Array.isArray(list)) return [];
	return list
		.filter((p) => ADDRESS.test(String(p?.address)) && TX_HASH.test(String(p?.txHash)))
		.map((p) => ({
			address: String(p.address),
			txHash: String(p.txHash),
			time: String(p.time ?? ''),
			credits: Number(p.credits) || 0,
			chain: p.chain ? String(p.chain).slice(0, 20) : null,
			token: p.token ? String(p.token).slice(0, 20) : null
		}));
}

/**
 * The purchases a statement names: every one up to its month's end from a
 * bridge that lists them, else the month's own.
 *
 * @param {AlephStatement} statement
 * @returns {AlephPurchase[]}
 */
export function purchasesOf(statement) {
	const listed = /** @type {any} */ (statement).purchases;
	const rows = Array.isArray(listed)
		? listed
		: (statement.topUps ?? []).filter((t) => t.how === 'purchase');
	return cleanPurchases(rows.map((/** @type {any} */ r) => ({ ...r, address: statement.address })));
}

/**
 * Keep the purchases a statement names, each once (by its hash).
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {AlephStatement} statement
 * @returns {Promise<number>} how many were new
 */
export async function rememberPurchases(settings, statement) {
	const found = purchasesOf(statement);
	if (!found.length) return 0;
	const aleph = await loadAleph(settings);
	const known = new Map(aleph.purchases.map((p) => [p.txHash.toLowerCase(), p]));
	let added = 0;
	for (const p of found) {
		if (!known.has(p.txHash.toLowerCase())) added++;
		known.set(p.txHash.toLowerCase(), p);
	}
	if (!added) return 0;
	const purchases = [...known.values()]
		.sort((a, b) => a.time.localeCompare(b.time))
		.slice(-MAX_PURCHASES);
	await saveAleph(settings, { purchases });
	return added;
}

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
			: [],
		purchases: cleanPurchases(v.purchases)
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
 * @param {{ alephAccounts: (addresses: string[]) => Promise<{ address: string, credits: number, entries: number }[]>, alephStatement?: (address: string, month: string) => Promise<AlephStatement> }} p.client
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
	// The accounts' credit purchases, so that the bookings that paid them are
	// known (matching/classify.js). The running month's statement lists every
	// purchase up to now; an account that cannot be read is left for next time.
	let purchases = 0;
	if (client.alephStatement) {
		const month = checkedAt.slice(0, 7);
		for (const a of accounts) {
			try {
				purchases += await rememberPurchases(
					settings,
					await client.alephStatement(a.address, month)
				);
			} catch {
				// asked again at the next scan
			}
		}
	}
	return { asked: addresses.length, accounts, purchases };
}

/**
 * After own wallets were synced: the credit purchases of the books' Aleph
 * accounts are read again, so that a payment that just came into the books is
 * known as the purchase it paid, without a visit to the Aleph page. Only when
 * Aleph is in use here (the scan is on, or an account is kept), and never an
 * error of the sync: what cannot be read now is read at the next sync.
 *
 * @param {Parameters<typeof scanAleph>[0]} p
 * @returns {Promise<number>} the purchases newly known
 */
export async function learnAlephPurchases(p) {
	try {
		const aleph = await loadAleph(p.settings);
		if (!aleph.scan && !aleph.extra.length && !aleph.accounts.length) return 0;
		return (await scanAleph(p)).purchases;
	} catch {
		return 0;
	}
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
	// eslint-disable-next-line belege/no-german -- text of the Eigenbeleg, a German document (#192)
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
	await rememberPurchases(store.settings, statement);
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
