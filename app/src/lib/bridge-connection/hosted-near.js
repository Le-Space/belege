// The hosted bridge on Phala, started through NEAR (#696): what the books keep
// about it, its status on the contract, start and stop. Moved out of
// session.svelte.js as it was (#844, step B4); the pages keep calling it
// through session.svelte.js, which loads this module when one of its
// functions is first asked for and hands it the open session.

import { t } from '$lib/i18n/index.js';
import { networkPause } from '$lib/network-pause.js';
import {
	keyGenerationOf,
	readBridgeRecord,
	readNearHostedRecord,
	writeBridgeRecord,
	writeNearHostedRecord
} from './record.js';

/** @type {import('./hosted-aleph.js').SessionContext} */
let ctx;

/** @param {import('./hosted-aleph.js').SessionContext} context set by session.svelte.js before any call */
export function bindSession(context) {
	ctx = context;
}

const isoNow = () => new Date().toISOString();

/** While the network is paused nothing here asks NEAR or the launcher (as hosted-aleph.js); stopping is the exception. */
function refuseWhilePaused() {
	if (networkPause()) throw new Error(t('messages.hostedBridge.paused'));
}

/**
 * The bridge on Phala this browser started last, as the books keep it (no
 * network): its peer id and when it was attested; never the peer key.
 *
 * @returns {Promise<{ peerId: string, attestedAt: string | null } | null>}
 */
export async function nearHostedRecord() {
	if (!ctx.session?.store) return null;
	const kept = await readNearHostedRecord(ctx.session.store.settings);
	if (typeof kept?.peerId !== 'string') return null;
	return { peerId: kept.peerId, attestedAt: kept.attestedAt ?? null };
}

/**
 * The books on NEAR for the hosted bridge on Phala: their account (made on
 * the owner's device), its balance, the contract's view and the bridge this
 * browser last started.
 *
 * @returns {Promise<{ accountId: string, balance: bigint | null, contract: any, kept: any } | null>}
 */
export async function nearBridgeStatus() {
	if (!ctx.session?.store || networkPause()) return null;
	const nb = await import('../integrations/near-bridge.js');
	const settings = ctx.session.store.settings;
	const seed = await nb.ensureNearKey(settings, { create: !ctx.app.member });
	if (!seed) return null;
	const near = nb.nearBooks({ seed });
	const [balance, contract] = await Promise.all([near.balance(), near.view().catch(() => null)]);
	const kept = await readNearHostedRecord(settings);
	return { accountId: near.books.accountId, balance, contract, kept };
}

/**
 * "Gehostete Bridge auf Phala, über NEAR" (#696): start the bridge in a TDX
 * VM through the NEAR contract and Le Space's launcher, and pair it in the
 * same step – what goes in is what goes into an Aleph VM (`hostedSecrets`):
 * its key of the books, its own peer key (made here, so its peer id is known
 * before it runs), the books' relays and devices. It goes only to the VM
 * whose quote the contract checked, sealed to that VM's key. The bridge
 * dials out to the relays; there is no inbound route to the VM.
 *
 * @param {{ onPhase?: (phase: string, detail?: any) => void }} [p]
 * @returns {Promise<{ peerId: string, composeHash: string }>}
 */
export async function startNearHostedBridge({ onPhase = () => {} } = {}) {
	refuseWhilePaused();
	if (
		!ctx.session?.online ||
		!ctx.session.bridgeAuthBase ||
		!ctx.deviceSync ||
		!ctx.bridgeConsumer
	) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	const nb = await import('../integrations/near-bridge.js');
	const hosted = await import('../integrations/hosted-bridge.js');
	const { knownDevices } = await import('../sync/device-sync.js');
	const { setBridgeNode } = await import('../sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('../database-keys.js');
	const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import(
		'@libp2p/crypto/keys'
	);
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');

	const settings = ctx.session.store.settings;
	const seed = await nb.ensureNearKey(settings, { create: !ctx.app.member });
	if (!seed) throw new Error(t('messages.nearBridge.noKey'));
	const near = nb.nearBooks({ seed });
	if ((await near.balance()) === null) throw new Error(t('messages.nearBridge.notFunded'));
	if (!(ctx.session.relays ?? []).length) throw new Error(t('messages.nearBridge.noRelay'));

	// The bridge's own peer key: the one these books' NEAR bridge had, or a new one.
	const kept = await readNearHostedRecord(settings);
	const peerKey =
		kept?.books === near.books.accountId && typeof kept?.peerKey === 'string'
			? privateKeyFromProtobuf(Uint8Array.from(atob(kept.peerKey), (c) => c.charCodeAt(0)))
			: await generateKeyPair('Ed25519');
	const peerKeyBytes = privateKeyToProtobuf(peerKey);
	const peerId = peerIdFromPrivateKey(peerKey).toString();

	const saved = (await readBridgeRecord(settings)) ?? {};
	const keyGeneration = keyGenerationOf(saved);
	const authKey = await bridgeAuthKeyOf(ctx.session.bridgeAuthBase, keyGeneration);

	// Made only once the contract shows the VM attested.
	const secrets = async () => {
		const records = await settings.list({ includeDeleted: true });
		const { whose } = await import('../members/whose.js');
		const members = whose(records);
		const own = knownDevices(records)
			.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
			.map((d) => d.peerId);
		const all = hosted.hostedSecrets({
			host: '',
			authKey,
			peerKey: peerKeyBytes,
			relays: ctx.session?.relays ?? [],
			devices: [ctx.session?.peerId ?? '', ...own].filter(Boolean)
		});
		// No HTTPS name: the VM on Phala has no inbound route.
		delete all.https_hostname;
		// What else it starts with (#728): the accounts and settings kept for a hosted bridge.
		const { withHostedSettings } = await import('../integrations/hosted-settings.js');
		return withHostedSettings(all, await ctx.keptHostedSettings());
	};

	const launcher = nb.launcherClient({ books: near.books });
	const { atMs, composeHash } = await nb.startNearBridge({ near, launcher, secrets, onPhase });

	const attestedAt = isoNow();
	await writeNearHostedRecord(settings, {
		books: near.books.accountId,
		peerId,
		peerKey: btoa(String.fromCharCode(...peerKeyBytes)),
		composeHash,
		atMs,
		attestedAt
	});
	// The books' bridge from now on, as after a handover.
	ctx.session.bridgeAuth.peerId = peerId;
	ctx.session.bridgeAuth.key = authKey;
	setBridgeNode({ peerId });
	await writeBridgeRecord(settings, {
		token: null,
		...saved,
		peerId,
		keyGeneration,
		nodePairedAt: attestedAt
	});
	await ctx.deviceSync.addDevice(peerId, t('messages.nearBridge.deviceLabel'), { bridge: true });
	return { peerId, composeHash };
}

/** Stop the bridge on Phala: the contract forgets the VM at once, the launcher deletes it. */
export async function stopNearHostedBridge() {
	if (!ctx.session?.store) throw new Error(t('messages.bridge.needsSync'));
	const nb = await import('../integrations/near-bridge.js');
	const seed = await nb.ensureNearKey(ctx.session.store.settings, { create: false });
	if (!seed) throw new Error(t('messages.nearBridge.noKey'));
	return nb.stopNearBridge({ near: nb.nearBooks({ seed }) });
}
