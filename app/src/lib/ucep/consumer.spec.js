// Belege as the consumer of the invoice extension, against a provider that
// answers as the invoicing app does (Le-Space/invoice app/src/lib/ucep): two
// real libp2p nodes over the in-memory transport.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { UcepError, createProvider, encodeInvitation } from '@le-space/ucep';
import {
	PROVIDER_SETTING,
	createBelegeConsumer,
	decimalFromUnits,
	eigenbelegArgs,
	pairByInvitation,
	pairedApp,
	requestEigenbeleg,
	unpair,
	OLD_CATALOGUE_PREFIX,
	forgetStoredCatalogue
} from './consumer.js';

/** A settings collection in memory, the way store/repository.js keeps one. */
function memorySettings() {
	/** @type {Map<string, any>} */
	const records = new Map();
	let next = 0;
	return /** @type {any} */ ({
		async put(/** @type {any} */ input) {
			const id = input.id ?? `01J${String(next++).padStart(23, '0')}`;
			const record = { deleted: false, ...(records.get(id) ?? {}), ...input, id };
			records.set(id, record);
			return record;
		},
		async get(/** @type {string} */ id) {
			return records.get(id) ?? null;
		},
		async list({ where = null } = {}) {
			const all = [...records.values()].filter((r) => !r.deleted);
			return where ? all.filter(where) : all;
		},
		async softDelete(/** @type {string} */ id) {
			records.set(id, { ...records.get(id), deleted: true });
		}
	});
}

async function node(/** @type {string} */ name) {
	return createLibp2p({
		addresses: { listen: [`/memory/${name}-${Math.random().toString(36).slice(2)}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify(), identifyPush: identifyPush() }
	});
}

const PDF = new TextEncoder().encode('%PDF-1.7 made-up Eigenbeleg');
/** @param {Uint8Array} bytes */
async function sha256(bytes) {
	const d = new Uint8Array(
		await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes))
	);
	return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A made-up booking: an Akash fee, valued at CoinGecko's rate. */
const tx = {
	id: '01J0000000000000000000000A',
	bookedOn: '2026-09-01',
	amountCents: -1234,
	asset: 'AKT',
	quantity: '-4200000',
	decimals: 6,
	txRef: '0'.repeat(64),
	valuation: { rate: '2.938095', currency: 'EUR', source: 'coingecko', at: '2026-09-01T12:00:00Z' }
};
const input = {
	counterparty: 'Stromwerk Test AG',
	description: 'Netzwerkgebühr für eine Lease-Zahlung',
	reason: 'Das Netzwerk berechnet Gebühren on-chain und stellt keine Rechnung aus.'
};

describe('eigenbelegArgs', () => {
	it('says what the booking is, in the spec’s shapes', () => {
		expect(eigenbelegArgs(tx, input)).toEqual({
			date: '2026-09-01',
			direction: 'outgoing',
			reason: input.reason,
			description: input.description,
			amount: { value: '12.34', currency: 'EUR' },
			crypto: {
				chain: 'cosmos:akashnet-2',
				symbol: 'AKT',
				quantity: '4.2',
				txRef: '0'.repeat(64),
				valuation: {
					rate: '2.938095',
					rateCurrency: 'EUR',
					source: 'coingecko',
					at: '2026-09-01T12:00:00Z'
				}
			},
			counterparty: { name: 'Stromwerk Test AG' },
			reference: { system: 'belege', id: tx.id }
		});
	});

	it('leaves the crypto part out of a bank booking, and an empty counterparty', () => {
		const args = eigenbelegArgs(
			{ id: 'X', bookedOn: '2026-09-02', amountCents: 5000 },
			{ ...input, counterparty: ' ' }
		);
		expect(args).toMatchObject({ direction: 'incoming', amount: { value: '50' } });
		expect(args).not.toHaveProperty('crypto');
		expect(args).not.toHaveProperty('counterparty');
	});

	it('writes units as whole units without a sign', () => {
		expect(decimalFromUnits('-4200000', 6)).toBe('4.2');
		expect(decimalFromUnits(1, 8)).toBe('0.00000001');
		expect(decimalFromUnits(-1234, 2)).toBe('12.34');
		expect(decimalFromUnits(5, 0)).toBe('5');
	});
});

describe('Belege and the invoicing app', () => {
	/** @type {any} */ let appNode;
	/** @type {any} */ let belegeNode;
	/** @type {any} */ let provider;
	/** @type {any} */ let consumer;
	const settings = memorySettings();
	/** @type {any[]} */
	const asked = [];
	let inline = true;
	let wrongBytes = false;

	beforeAll(async () => {
		[appNode, belegeNode] = await Promise.all([node('invoice'), node('belege')]);
		provider = createProvider({
			libp2p: appNode,
			manifest: {
				id: 'invoice',
				name: 'Rechnungen',
				version: '0.1.0',
				scopes: [
					{ name: 'invoice:eigenbeleg:create', description: 'Eigenbelege' },
					{ name: 'invoice:document:read', description: 'Lesen' }
				]
			},
			commands: {
				'create-eigenbeleg': {
					scope: 'invoice:eigenbeleg:create',
					idempotent: true,
					handler: async ({ argsJson }) => {
						asked.push(argsJson);
						return {
							documentId: 'doc-1',
							number: `EB-2026-000${asked.length}`,
							state: 'created',
							file: { mime: 'application/pdf', size: PDF.length, sha256: await sha256(PDF) }
						};
					}
				},
				'get-pdf': {
					scope: 'invoice:document:read',
					handler: async ({ argsJson }) => {
						if (argsJson?.documentId !== 'doc-1') throw new UcepError('INVALID_ARGUMENTS');
						const bytes = wrongBytes ? new TextEncoder().encode('%PDF- other') : PDF;
						return {
							mime: 'application/pdf',
							size: bytes.length,
							sha256: await sha256(bytes),
							...(inline ? { base64: btoa(String.fromCharCode(...bytes)) } : {})
						};
					}
				}
			}
		});
		await provider.start();
		consumer = createBelegeConsumer({ libp2p: belegeNode, settings, label: 'Belege, Laptop' });
		await consumer.start();
	});

	afterAll(async () => {
		await Promise.all([appNode?.stop(), belegeNode?.stop()]);
	});

	it('pairs with an invitation and keeps the app’s address sealed with the grant', async () => {
		const { uri } = await provider.createInvitation({
			scopes: ['invoice:eigenbeleg:create', 'invoice:document:read']
		});
		const app = await pairByInvitation({ consumer, settings, uri });
		expect(app.peerId).toBe(appNode.peerId.toString());
		expect(app.addrs[0]).toContain('/memory/');
		expect(await pairedApp(settings)).toMatchObject({ peerId: app.peerId });
		expect(
			(await settings.list()).some((/** @type {any} */ r) =>
				String(r.key).startsWith('ucep/grant/')
			)
		).toBe(true);
		expect((await provider.grants())[0]).toMatchObject({ label: 'Belege, Laptop' });
		// What the app serves is known, and kept in memory only.
		expect(
			(await consumer.catalogue()).some((/** @type {any} */ e) => e.extensionId === 'invoice')
		).toBe(true);
		expect(
			(await settings.list()).some((/** @type {any} */ r) =>
				String(r.key).startsWith(OLD_CATALOGUE_PREFIX)
			)
		).toBe(false);
	});

	it('writes nothing into the settings when a stranger announces extensions', async () => {
		const strangerNode = await node('stranger');
		try {
			const stranger = createProvider({
				libp2p: strangerNode,
				manifest: { id: 'x0', name: 'Fremd (Test)', version: '0.1.0' },
				commands: { help: { handler: () => ({}) } }
			});
			await stranger.start();
			const before = (await settings.list()).length;
			await strangerNode.dial(belegeNode.getMultiaddrs());
			await expect
				.poll(async () =>
					(await consumer.catalogue()).some((/** @type {any} */ e) => e.extensionId === 'x0')
				)
				.toBe(true);
			expect((await settings.list()).length).toBe(before);
		} finally {
			await strangerNode.stop();
		}
	});

	it('refuses an invitation of another extension', async () => {
		const other = encodeInvitation({
			providerPeerId: appNode.peerId.toString(),
			extensionId: 'chat',
			invitationId: 'made-up-invitation',
			secret: new Uint8Array(32),
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			scopes: ['chat:message:read'],
			addrs: []
		});
		await expect(pairByInvitation({ consumer, settings, uri: other })).rejects.toThrow(
			/nicht von einer Rechnungs-App/
		);
	});

	it('asks for an Eigenbeleg and takes its PDF, checked against its hash', async () => {
		const app = /** @type {any} */ (await pairedApp(settings));
		const made = await requestEigenbeleg({ consumer, app, tx, input });
		expect(made).toMatchObject({ number: 'EB-2026-0001', documentId: 'doc-1' });
		expect(new TextDecoder().decode(made.bytes)).toBe('%PDF-1.7 made-up Eigenbeleg');
		expect(asked[0]).toMatchObject({ reference: { system: 'belege', id: tx.id } });

		// The same booking again within a day: the same answer, not a second number.
		const again = await requestEigenbeleg({ consumer, app, tx, input });
		expect(again.number).toBe('EB-2026-0001');
		expect(asked).toHaveLength(1);
	});

	it('says so when the PDF did not come, or is not the one the app made', async () => {
		const app = /** @type {any} */ (await pairedApp(settings));
		inline = false;
		await expect(
			requestEigenbeleg({ consumer, app, tx: { ...tx, id: '01J0000000000000000000000B' }, input })
		).rejects.toThrow(/direkte Verbindung/);
		inline = true;
		wrongBytes = true;
		await expect(
			requestEigenbeleg({ consumer, app, tx: { ...tx, id: '01J0000000000000000000000C' }, input })
		).rejects.toThrow(/stimmt nicht/);
		wrongBytes = false;
	});

	it('says so when the app cannot be reached', async () => {
		const app = { peerId: appNode.peerId.toString(), addrs: ['/memory/nobody-here'], pairedAt: '' };
		await expect(requestEigenbeleg({ consumer, app, tx, input })).rejects.toThrow(
			/nicht erreichbar/
		);
	});

	it('unpairs: the app forgets the grant, and Belege the app', async () => {
		await unpair({ consumer, settings });
		expect(await pairedApp(settings)).toBeNull();
		expect(await provider.grants()).toEqual([]);
		expect(
			(await settings.list()).find((/** @type {any} */ r) => r.key === PROVIDER_SETTING)?.value
		).toBeNull();
	});
});

describe('forgetStoredCatalogue', () => {
	it('removes the catalogue records earlier builds kept, and nothing else', async () => {
		const settings = memorySettings();
		await settings.put({
			key: `${OLD_CATALOGUE_PREFIX}12D3KooWexample|/uc/extension/x0/0.1.0`,
			value: {}
		});
		await settings.put({
			key: `${OLD_CATALOGUE_PREFIX}12D3KooWexample|/uc/extension/x1/0.1.0`,
			value: {}
		});
		await settings.put({ key: 'ucep/grant/made-up', value: {} });
		expect(await forgetStoredCatalogue(settings)).toBe(2);
		expect((await settings.list()).map((/** @type {any} */ r) => r.key)).toEqual([
			'ucep/grant/made-up'
		]);
		expect(await forgetStoredCatalogue(settings)).toBe(0);
	});
});
