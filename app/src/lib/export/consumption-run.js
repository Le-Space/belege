// The consumption Eigenbelege of a month's close (#1034), made: read each
// account's month from the bridge, as its card does, keep only those with
// consumption (@le-space/eigenbeleg `needsEigenbeleg`), make the card's
// document – the same function, so the same PDF and the same number range –
// and link it to the month's top-ups it covers (consumption.js). A document
// made before is reused: only the top-ups not linked to it yet are linked.
//
// Every document is an ordinary receipt, stored sealed through the
// repository like an upload (receipts/import.js), and linked as the person's
// decision: they confirmed the list on the export page, or pressed "create
// now" on a booking.

import { needsEigenbeleg } from '@le-space/eigenbeleg/needs';
import { createAlephStatement, loadAleph } from '../aleph/aleph.js';
import { createAkashStatement, readAkashMonth } from '../akash/statement.js';
import { createFilecoinPayStatement, loadFilecoinPay } from '../filecoin-pay/filecoin-pay.js';
import { confirmMatch } from '../matching/actions.js';
import { loadWallets } from '../wallets/wallet-sync.js';
import { consumptionSources } from './consumption.js';
import { recordEvent } from '../activity/events.js';

/** @typedef {import('./consumption.js').ConsumptionItem} ConsumptionItem */

/**
 * @typedef {object} ConsumptionRead an account's month as the bridge answered it
 * @property {boolean} due it holds consumption: an Eigenbeleg is made
 * @property {number} usage how many usage lines (days, settlements, deployments)
 * @property {number | null} eurCents what the consumption is worth, null when a rate is missing
 * @property {boolean} complete the account's history adds up (Aleph's `difference`); false: not made automatically
 * @property {any} data what the card's function takes, so the bridge is not asked twice
 */

/**
 * @typedef {object} ConsumptionClient the bridge calls the cards use
 * @property {(address: string, month: string) => Promise<any>} alephStatement
 * @property {(address: string, month: string) => Promise<any>} filecoinPayStatement
 * @property {(body: { address: string, endpoints?: Record<string, string> }) => Promise<{ deployments: any[] }>} akashDeployments
 * @property {(asset: string, date: string) => Promise<any>} rate
 */

/**
 * The books' consumption accounts, from the sealed settings the cards keep.
 *
 * @param {any} store
 */
export async function loadConsumptionSources(store) {
	const [aleph, filecoinPay, wallets] = await Promise.all([
		loadAleph(store.settings),
		loadFilecoinPay(store.settings),
		loadWallets(store.settings)
	]);
	return consumptionSources({ aleph, filecoinPay, wallets });
}

/**
 * Read one account's month, as its card would.
 *
 * @param {object} p
 * @param {any} p.store
 * @param {ConsumptionClient | any} p.client
 * @param {import('./consumption.js').ConsumptionSource} p.source
 * @param {string} p.month
 * @param {() => Date} [p.now]
 * @returns {Promise<ConsumptionRead>}
 */
export async function readConsumption({ store, client, source, month, now = () => new Date() }) {
	const entries = (/** @type {number} */ n) =>
		Array.from({ length: n }, () => ({ chain: source.chain, kind: 'usage', type: 'sent' }));
	if (source.chain === 'aleph') {
		const data = await client.alephStatement(source.address, month);
		const usage = data.usage?.length ?? 0;
		return {
			due: entries(usage).some(needsEigenbeleg),
			usage,
			eurCents: data.totals?.eurCents ?? null,
			complete: !data.difference,
			data
		};
	}
	if (source.chain === 'filecoin-pay') {
		const data = await client.filecoinPayStatement(source.address, month);
		const usage = data.usage?.length ?? 0;
		return {
			due: entries(usage).some(needsEigenbeleg),
			usage,
			eurCents: data.totals?.eurCents ?? null,
			complete: true,
			data
		};
	}
	const wallet = /** @type {any} */ (source.wallet ?? { address: source.address });
	const data = await readAkashMonth({ store, client, wallet, month, now });
	const usage = data.usage.length;
	return {
		due: entries(usage).some(needsEigenbeleg),
		usage,
		eurCents: data.totals.usageEurCents ?? null,
		complete: true,
		data
	};
}

/**
 * Link an Eigenbeleg to the top-ups it covers and keep which they were.
 *
 * @param {any} store
 * @param {Record<string, any>} receipt
 * @param {Record<string, any>[]} toLink not linked to it yet
 * @param {Record<string, any>[]} bookings all it covers, toLink included
 * @param {() => Date} now
 */
export async function linkConsumption(store, receipt, toLink, bookings, now) {
	for (const tx of toLink) {
		await confirmMatch(
			store,
			{
				receiptId: receipt.id,
				transactionId: tx.id,
				reasons: ['consumption-eigenbeleg'],
				alongside: true
			},
			{ log: false }
		);
	}
	const fresh = (await store.receipts.get(receipt.id)) ?? receipt;
	await store.receipts.put({
		...fresh,
		selfReceipt: {
			...fresh.selfReceipt,
			consumption: {
				bookings: bookings.map((tx) => String(tx.id)),
				linkedAt: now().toISOString()
			}
		}
	});
	return toLink.length;
}

/**
 * Make (or reuse) one account's Eigenbeleg of a month and link it.
 *
 * @param {object} p
 * @param {any} p.store
 * @param {import('../receipts/blob-store.js').BlobStore} p.blobs
 * @param {ConsumptionClient | any} p.client
 * @param {ConsumptionItem} p.item
 * @param {string} p.month
 * @param {ConsumptionRead | null} [p.read] the month as read before; read now when not given
 * @param {string} [p.issuer]
 * @param {string} [p.createdBy]
 * @param {() => Date} [p.now]
 * @returns {Promise<{ made: 'created' | 'reused' | 'none', number: string | null, linked: number }>}
 */
export async function makeConsumption({
	store,
	blobs,
	client,
	item,
	month,
	read = null,
	issuer = '',
	createdBy = '',
	now = () => new Date()
}) {
	const { source } = item;
	if (item.existing) {
		const linked = await linkConsumption(store, item.existing, item.toLink, item.bookings, now);
		return { made: 'reused', number: String(item.existing.selfNumber ?? ''), linked };
	}
	const r = read ?? (await readConsumption({ store, client, source, month, now }));
	if (!r.due) return { made: 'none', number: null, linked: 0 };
	const common = {
		store,
		blobs,
		client: /** @type {any} */ (client),
		month,
		issuer,
		createdBy,
		now
	};
	const made =
		source.chain === 'aleph'
			? await createAlephStatement({
					...common,
					address: source.address,
					accountName: source.name,
					statement: r.data
				})
			: source.chain === 'filecoin-pay'
				? await createFilecoinPayStatement({
						...common,
						address: source.address,
						walletName: source.name,
						statement: r.data
					})
				: await createAkashStatement({
						...common,
						wallet: /** @type {any} */ (source.wallet ?? { address: source.address }),
						data: r.data
					});
	const receipt = (await store.receipts.get(made.receipt.id)) ?? made.receipt;
	// Akash's card links the fees itself; the rest are linked here.
	const matches = await store.matches.list();
	const already = new Set(
		matches
			.filter((/** @type {any} */ m) => m.receiptId === receipt.id && m.state === 'confirmed')
			.map((/** @type {any} */ m) => m.transactionId)
	);
	const linked = await linkConsumption(
		store,
		receipt,
		item.toLink.filter((tx) => !already.has(tx.id)),
		item.bookings,
		now
	);
	await recordEvent(store.events, 'decision', {
		action: 'consumption-eigenbeleg',
		receiptId: receipt.id,
		number: made.number,
		month,
		chain: source.chain
	});
	return { made: 'created', number: made.number, linked };
}
