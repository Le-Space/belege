// Belege as a UCEP consumer of the invoice extension (Le-Space/ucep-spec,
// extensions/invoice.md): paired once with the invoicing app, it asks that app
// for a self-issued receipt (Eigenbeleg) for a booking without a receipt, and
// takes the PDF back as the booking's receipt (receipts/eigenbeleg.js).
//
// What Belege keeps of the pairing — the grant and the provider's addresses —
// is in the sealed settings collection. The catalogue of what peers serve
// lives in memory: any peer that reaches Belege's node can announce
// extensions, and the settings are append-only and replicate to every own
// device. After a reload Belege dials the app again through the relay address
// it was paired over (`reach`), which learns the catalogue anew.

import { createConsumer, parseInvitation } from '@le-space/ucep';
import { assetOf } from '../assets/registry.js';
import { hasQuantity } from '../assets/valuation.js';
import { getSetting, setSetting } from '../store/settings.js';
import { collectionKeyValue } from './store.js';

export const INVOICE_EXTENSION = 'invoice';
export const SCOPES = Object.freeze([
	'invoice:eigenbeleg:create',
	'invoice:document:read',
	// invoice 0.2.0 (issue #8): the issued invoices, and which of them were paid
	'invoice:issued:read',
	'invoice:payment:record'
]);
/** The settings key of the paired invoicing app: `{ peerId, addrs, pairedAt }`. */
export const PROVIDER_SETTING = 'ucepInvoiceApp';

/**
 * @typedef {{ peerId: string, addrs: string[], pairedAt: string }} PairedApp
 * @typedef {import('../store/repository.js').Collection} Collection
 */

/**
 * @param {{ libp2p: any, settings: Collection, label: string }} params
 */
export function createBelegeConsumer({ libp2p, settings, label }) {
	return createConsumer({
		libp2p,
		label,
		store: { grants: collectionKeyValue(settings, 'ucep/grant/') }
	});
}

/** Where earlier builds kept the catalogue in the settings. */
export const OLD_CATALOGUE_PREFIX = 'ucep/catalogue/';

/**
 * The catalogue records earlier builds wrote into the settings: removed once.
 *
 * @param {Collection} settings
 * @returns {Promise<number>} how many
 */
export async function forgetStoredCatalogue(settings) {
	const old = await settings.list({
		where: (r) => typeof r.key === 'string' && r.key.startsWith(OLD_CATALOGUE_PREFIX)
	});
	for (const r of old) await settings.softDelete(r.id);
	return old.length;
}

/**
 * Units of the smallest denomination as a decimal string in whole units,
 * without a sign: `4200000`, 6 → `4.2`.
 *
 * @param {string | number | bigint} units
 * @param {number} decimals
 */
export function decimalFromUnits(units, decimals) {
	let value = BigInt(units);
	if (value < 0n) value = -value;
	if (decimals === 0) return value.toString();
	const text = value.toString().padStart(decimals + 1, '0');
	const fraction = text.slice(-decimals).replace(/0+$/, '');
	return fraction ? `${text.slice(0, -decimals)}.${fraction}` : text.slice(0, -decimals);
}

/**
 * The arguments of `create-eigenbeleg` for a booking and what the person
 * wrote (the same three fields as a local Eigenbeleg).
 *
 * @param {Record<string, any>} tx
 * @param {{ counterparty: string, description: string, reason: string }} input
 */
export function eigenbelegArgs(tx, input) {
	const cents = Number(tx.amountCents ?? 0);
	const known = hasQuantity(tx) ? assetOf(tx.asset) : null;
	const v = tx.valuation;
	const hash = String(tx.chainTxRef || tx.txRef || '').trim();
	return {
		date: String(tx.bookedOn),
		direction: cents < 0 ? 'outgoing' : 'incoming',
		reason: input.reason.trim(),
		description: input.description.trim(),
		amount: { value: decimalFromUnits(cents, 2), currency: 'EUR' },
		...(known?.chain && v?.rate
			? {
					crypto: {
						chain: known.chain,
						...(known.caip19 ? { asset: known.caip19 } : {}),
						symbol: known.symbol,
						quantity: decimalFromUnits(
							tx.quantity,
							Number.isInteger(tx.decimals) ? tx.decimals : known.decimals
						),
						...(hash ? { txRef: hash } : {}),
						valuation: {
							rate: String(v.rate),
							rateCurrency: 'EUR',
							source: String(v.source ?? ''),
							at: String(v.at ?? '')
						}
					}
				}
			: {}),
		...(input.counterparty.trim() ? { counterparty: { name: input.counterparty.trim() } } : {}),
		reference: { system: 'belege', id: String(tx.id) }
	};
}

/** @param {Collection} settings @returns {Promise<PairedApp | null>} */
export async function pairedApp(settings) {
	return (await getSetting(settings, PROVIDER_SETTING)) ?? null;
}

/**
 * Pair with an invitation the invoicing app showed (link or QR code text).
 *
 * @param {{ consumer: any, settings: Collection, uri: string, now?: () => Date }} params
 * @returns {Promise<PairedApp>}
 */
export async function pairByInvitation({ consumer, settings, uri, now = () => new Date() }) {
	const invitation = parseInvitation(uri.trim());
	if (invitation.extensionId !== INVOICE_EXTENSION) {
		throw new Error('Diese Einladung ist nicht von einer Rechnungs-App.');
	}
	await consumer.pairWithInvitation(uri.trim());
	const app = {
		peerId: invitation.providerPeerId,
		addrs: invitation.addrs,
		pairedAt: now().toISOString()
	};
	await setSetting(settings, PROVIDER_SETTING, app);
	return app;
}

/**
 * Pair by code: reach the app by its peer id through the relays, and ask. The
 * app's human compares the six digits `onCode` gets and says yes.
 *
 * @param {{ consumer: any, settings: Collection, peerId: string, relays: string[], onCode: (code: string) => void, now?: () => Date }} params
 * @returns {Promise<PairedApp>}
 */
export async function pairByCode({
	consumer,
	settings,
	peerId,
	relays,
	onCode,
	now = () => new Date()
}) {
	const id = peerId.trim();
	const addrs = relays.map((relay) => `${relay}/p2p-circuit/p2p/${id}`);
	if (!(await reach(consumer, addrs))) {
		throw new Error('Die Rechnungs-App ist unter dieser Peer-ID gerade nicht erreichbar.');
	}
	await consumer.pairInBand(id, INVOICE_EXTENSION, { scopes: [...SCOPES], onCode });
	const app = { peerId: id, addrs, pairedAt: now().toISOString() };
	await setSetting(settings, PROVIDER_SETTING, app);
	return app;
}

/**
 * Unpair: the app forgets the grant, and so does Belege, also when the app
 * cannot be reached.
 *
 * @param {{ consumer: any, settings: Collection }} params
 */
export async function unpair({ consumer, settings }) {
	const app = await pairedApp(settings);
	if (!app) return;
	await reach(consumer, app.addrs).catch(() => false);
	await consumer.unpair(app.peerId, INVOICE_EXTENSION).catch(() => false);
	await setSetting(settings, PROVIDER_SETTING, null);
}

/**
 * Dial the app at one of its addresses and learn what it serves.
 *
 * @param {any} consumer
 * @param {string[]} addrs
 */
export async function reach(consumer, addrs) {
	for (const addr of addrs) {
		const found = await consumer.addProvider(addr).catch(() => null);
		if (found?.reachable) return true;
	}
	return false;
}

/** @param {string} value */
function fromBase64(value) {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes))
	);
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ask the paired app for an Eigenbeleg, and fetch its PDF.
 *
 * The request id is the booking's, so asking twice within a day (a lost
 * answer, a retry) gives the same document, not a second number. The PDF comes
 * inline only over a direct connection; its SHA-256 is checked against what
 * the app said when it made it.
 *
 * @param {{ consumer: any, app: PairedApp, tx: Record<string, any>, input: { counterparty: string, description: string, reason: string } }} params
 * @returns {Promise<{ number: string, documentId: string, bytes: Uint8Array, sha256: string }>}
 */
export async function requestEigenbeleg({ consumer, app, tx, input }) {
	if (!(await reach(consumer, app.addrs))) {
		throw new Error('Die Rechnungs-App ist gerade nicht erreichbar. Ist sie offen und entsperrt?');
	}
	const created = await consumer.call(
		app.peerId,
		INVOICE_EXTENSION,
		'create-eigenbeleg',
		eigenbelegArgs(tx, input),
		{ requestId: `belege-eigenbeleg-${tx.id}` }
	);
	const pdf = await consumer.call(app.peerId, INVOICE_EXTENSION, 'get-pdf', {
		documentId: created.documentId
	});
	if (!pdf?.base64) {
		throw new Error(
			`Der Eigenbeleg ${created.number} ist erstellt, aber sein PDF kommt nur über eine direkte Verbindung – die gerade nicht zustande kam. Bitte später noch einmal.`
		);
	}
	const bytes = fromBase64(pdf.base64);
	const sha256 = await sha256Hex(bytes);
	if (sha256 !== created.file?.sha256) {
		throw new Error(
			'Das PDF des Eigenbelegs stimmt nicht mit dem überein, was die App erstellt hat.'
		);
	}
	return { number: created.number, documentId: created.documentId, bytes, sha256 };
}
