// The hosted bridge in a confidential VM on Aleph (#585, #587, #777): its
// records, its own image, the nodes, the credits and the plan, start, unlock
// and stop. Moved out of session.svelte.js as it was (#844, step B3); the
// pages keep calling it through session.svelte.js, which loads this module
// when one of its functions is first asked for and hands it the open session.

import { getSetting, setSetting } from '$lib/store/settings.js';
import { intlLocale, t } from '$lib/i18n/index.js';
import { networkPause } from '$lib/network-pause.js';
import {
	keyGenerationOf,
	readBridgeRecord,
	readHostedRecord,
	writeBridgeRecord,
	writeHostedRecord
} from './record.js';

/**
 * What this module needs of the open session, read anew at every use: the
 * books may be closed while a call waits.
 *
 * @typedef {object} SessionContext
 * @property {any} session the open session (node.js), or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {any} deviceSync device sync, when it runs
 * @property {any} bridgeConsumer the stream to the bridge's node, when there is one
 * @property {() => Promise<import('$lib/integrations/hosted-settings.js').HostedSettings>} keptHostedSettings
 */

/** @type {SessionContext} */
let ctx;

/** @param {SessionContext} context set by session.svelte.js before any call */
export function bindSession(context) {
	ctx = context;
}

const isoNow = () => new Date().toISOString();

/**
 * "Alles pausieren" holds here too: while the network is paused, nothing in
 * this module asks Aleph, Le Space Credits, a node or a VM – not to list, not
 * to start, unlock or build, and not to stop. Asked by every function that
 * dials, so a caller cannot get around the card; marked `fatal`, so a loop
 * that tries again (integrations/hosted-unlock.js) ends at once.
 */
function refuseWhilePaused() {
	if (!networkPause()) return;
	const error = new Error(t('messages.hostedBridge.paused'));
	/** @type {any} */ (error).fatal = true;
	/** @type {any} */ (error).code = 'NETWORK_PAUSED';
	throw error;
}

/**
 * The hosted bridge the books know (settings `bridge/hosted`): which VM, its
 * name, its peer id and when it was last attested; never the peer key.
 *
 * @returns {Promise<{ instance: string, host: string, peerId: string, measurement: string, attestedAt: string } | null>}
 */
export async function hostedBridgeRecord() {
	if (!ctx.session?.store) return null;
	const kept = await readHostedRecord(ctx.session.store.settings);
	if (typeof kept?.instance !== 'string') return null;
	const { instance, host, peerId, measurement, attestedAt } = kept;
	return { instance, host, peerId, measurement, attestedAt };
}

/**
 * The `fetch` for the hosted bridge's calls to Aleph (#587): progress of a
 * download as an `onProgress` phase 'bytes', a second Aleph host when the
 * first fails, and the runtime kept in the browser's cache once fetched.
 *
 * @param {string} apiHost
 * @param {(p: { phase: string, detail: string, received?: number, total?: number | null, ms?: number }) => void} onProgress
 */
async function alephFetchFor(apiHost, onProgress) {
	const { alephFetch, ALEPH_API_HOSTS } = await import('../integrations/aleph-fetch.js');
	const own = ALEPH_API_HOSTS.some((h) => new URL(h).origin === new URL(apiHost).origin);
	return alephFetch({
		hosts: own ? ALEPH_API_HOSTS : [apiHost],
		onDownload: ({ host, received, total, ms }) =>
			onProgress({ phase: 'bytes', detail: host, received, total, ms })
	});
}

/**
 * An Aleph that did not answer, said as that (#587); anything else unchanged.
 *
 * @param {unknown} error
 */
function alephSaid(error) {
	const tried =
		/** @type {any} */ (error)?.name === 'AlephUnavailable' && /** @type {any} */ (error).tried;
	if (!tried) return error;
	const detail = tried
		.map(
			(/** @type {{ host: string, outcome: string }} */ t) =>
				`${new URL(t.host).host}: ${t.outcome}`
		)
		.join(', ');
	return new Error(t('messages.hostedBridge.alephDown', { detail }));
}

/**
 * "Gehostete Bridge" (Integrationen → Bridge, #585): attest the bridge's VM
 * from this browser and unlock it, paired in the same step
 * (integrations/hosted-bridge.js). The VM is the books' Aleph key's: the
 * measurement names it and it signs the unlock. It is paid by that key or by
 * `payer` (Le Space's sub-account for these books; asked of Le Space Credits
 * when not given and they are switched on). The passphrase is the image's:
 * typed here for the shared image, derived here for a VM started from the
 * books' own image (#777); kept nowhere either way. The bridge's peer key is made here once per VM
 * and kept in the sealed settings, so a restart unlocks the same bridge again.
 *
 * `attempts` is how often the guest is asked before giving up (attest-wasm's
 * own patience when not given); `signal` cancels the waiting between them.
 * An error trying again will not help with is marked `fatal`
 * (integrations/hosted-unlock.js).
 *
 * @param {{ instance: string, passphrase?: string, payer?: string, attempts?: number, signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string }) => void }} p
 * @returns {Promise<{ peerId: string, host: string, measurement: string }>}
 */
export async function unlockHostedBridge({
	instance,
	passphrase,
	payer,
	attempts,
	signal,
	onProgress = () => {}
}) {
	const { fatal, pause } = await import('../integrations/hosted-unlock.js');
	refuseWhilePaused();
	if (
		!ctx.session?.online ||
		!ctx.session.bridgeAuthBase ||
		!ctx.deviceSync ||
		!ctx.bridgeConsumer
	) {
		throw fatal(t('messages.bridge.needsSync'));
	}
	const hosted = await import('../integrations/hosted-bridge.js');
	const { ensureBackupKey, alephEndpoints } = await import('../backup/keeper.js');
	const { alephAddressOf, alephSign } = await import('../backup/aleph-signer.js');
	const { twoN6Host } = await import('../ucep/net.js');
	const { knownDevices } = await import('../sync/device-sync.js');
	const { setBridgeNode } = await import('../sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('../database-keys.js');
	const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import(
		'@libp2p/crypto/keys'
	);
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');

	const hash = instance.trim();
	if (!hosted.isInstanceHash(hash)) throw fatal(t('messages.hostedBridge.notInstance'));
	const settings = ctx.session.store.settings;
	// Started here from the books' own image (#777): that image, and its passphrase derived, not typed.
	const started = await hostedVmRecord();
	const ownImage =
		started?.instance === hash &&
		typeof started?.image === 'string' &&
		typeof started?.plainSha256 === 'string'
			? { store: started.image, plainSha256: started.plainSha256 }
			: null;
	if (ownImage) passphrase = await ownImagePassphrase(ownImage.plainSha256);
	if (!passphrase) throw fatal(t('messages.hostedBridge.noPassphrase'));
	// The books' key, made on the owner's device as for the backup; a member's device waits for it (#613).
	const ownerKey = await ensureBackupKey(settings, { create: !ctx.app.member });
	if (!ownerKey) throw fatal(t('messages.hostedBridge.noAlephKey'));
	const owner = alephAddressOf(ownerKey);
	const { apiHost } = alephEndpoints();
	const relayUrl = hosted.attestUrlOf(ctx.session.relays ?? []);
	if (!relayUrl) throw fatal(t('messages.hostedBridge.noRelay'));

	onProgress({ phase: 'instance', detail: hash });
	const alephGet = await alephFetchFor(apiHost, onProgress);
	const { content, crn, vcpus } = await hosted
		.fetchInstance(hash, { apiHost, fetch: alephGet })
		.catch((e) => {
			throw alephSaid(e);
		});
	// Paid by another account than the books' key: Le Space's sub-account for these books, or none.
	const payers = [owner];
	if (payer) payers.push(payer);
	else if (String(content?.address ?? '').toLowerCase() !== owner.toLowerCase()) {
		const sub = await leSpaceVmAccount(ownerKey).catch(() => null);
		if (sub) payers.push(sub);
	}
	const wasm = await import('@le-space/attest-wasm/pkg/relay_button_attest.js');
	await wasm.default();
	/** @type {any} */
	let published = null;
	/** @type {any} */
	let verify;
	if (import.meta.env.VITE_E2E === 'true') {
		// The fake agent's reports carry no AMD signature: the test names the
		// measurement, and only it is checked (as in bridge/test/support/fake-attest-agent.js).
		const pins = globalThis.localStorage?.getItem(hosted.E2E_HOSTED_PINS_KEY);
		if (pins) {
			published = JSON.parse(pins);
			verify = async (/** @type {any} */ { report, expectedMeasurements }) => {
				const m = Array.from(report.subarray(0x90, 0xc0), (/** @type {number} */ b) =>
					b.toString(16).padStart(2, '0')
				).join('');
				if (!expectedMeasurements.includes(m)) throw new Error('measurement not pinned');
				return { verified: true, measurement: m, policy: '0x30000', launchTcb: {} };
			};
		}
	}
	if (!published) {
		const { confidentialTrustedExecution } = await import('@le-space/attest-wasm/instance');
		published = await confidentialTrustedExecution({
			wasm,
			owner,
			vcpus,
			apiHost,
			fetch: alephGet,
			onProgress
		}).catch((e) => {
			throw alephSaid(e);
		});
	}

	// The bridge's own peer key: the one made for this VM before, or a new one.
	const kept = await readHostedRecord(settings);
	const peerKey =
		kept?.instance === hash && typeof kept?.peerKey === 'string'
			? privateKeyFromProtobuf(Uint8Array.from(atob(kept.peerKey), (c) => c.charCodeAt(0)))
			: await generateKeyPair('Ed25519');
	const peerKeyBytes = privateKeyToProtobuf(peerKey);
	const peerId = peerIdFromPrivateKey(peerKey).toString();

	const saved = (await readBridgeRecord(settings)) ?? {};
	const keyGeneration = keyGenerationOf(saved);
	const authKey = await bridgeAuthKeyOf(ctx.session.bridgeAuthBase, keyGeneration);
	const records = await settings.list({ includeDeleted: true });
	const { whose } = await import('../members/whose.js');
	const members = whose(records);
	// Own devices, and a writing member's the owner let use the bridge (#641, #579): as at a handover.
	const own = knownDevices(records)
		.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
		.map((d) => d.peerId);
	const host = twoN6Host(hash);
	const secrets = hosted.hostedSecrets({
		host,
		authKey,
		peerKey: peerKeyBytes,
		relays: ctx.session.relays ?? [],
		devices: [ctx.session.peerId, ...own]
	});
	// What else it starts with (#728): the accounts and settings kept for a hosted bridge.
	const { withHostedSettings } = await import('../integrations/hosted-settings.js');
	const startWith = withHostedSettings(secrets, await ctx.keptHostedSettings());

	signal?.throwIfAborted();
	const nodesOf = await import('../integrations/hosted-nodes.js');
	/** What the books remember about nodes, changed and kept; never in the way of the unlock. */
	const rememberNode = async (
		/** @type {(h: import('../integrations/hosted-nodes.js').NodeHistory) => import('../integrations/hosted-nodes.js').NodeHistory} */ change
	) => {
		try {
			const history = nodesOf.nodeHistoryOf(await getSetting(settings, nodesOf.NODES_SETTING));
			await setSetting(settings, nodesOf.NODES_SETTING, change(history));
		} catch {
			// A device that may not write the settings: the next one remembers.
		}
	};
	const result = await hosted
		.unlockHosted({
			instance: content,
			published,
			image: ownImage?.store ?? hosted.HOSTED_IMAGE,
			owner,
			payers,
			wasm,
			relayUrl,
			crnHash: crn,
			instanceItemHash: hash,
			passphrase,
			secrets: startWith,
			sign: async (/** @type {string} */ payload) => alephSign(ownerKey, payload),
			onProgress,
			sleep: (/** @type {number} */ ms) => pause(ms, signal),
			...(attempts ? { attempts } : {}),
			...(verify ? { verify } : {})
		})
		.catch(async (/** @type {unknown} */ e) => {
			// AMD has no certificate for this node's processor and firmware: the attestation
			// cannot be checked, so nothing went to the VM. Said plainly, and the node remembered.
			if (!nodesOf.isUnverifiableNode(e)) throw e;
			if (crn) await rememberNode((h) => nodesOf.noteUnverifiable(h, crn, isoNow()));
			const { reasonOf } = await import('../integrations/hosted-unlock.js');
			const error = fatal(t('messages.hostedBridge.nodeUnverifiable'));
			/** @type {any} */ (error).code = 'NODE_UNVERIFIABLE';
			/** @type {any} */ (error).detail = reasonOf(e);
			throw error;
		});
	const attestedAt = isoNow();
	if (crn) await rememberNode((h) => nodesOf.noteUnlocked(h, crn, attestedAt));
	await writeHostedRecord(settings, {
		instance: hash,
		host,
		peerId,
		peerKey: btoa(String.fromCharCode(...peerKeyBytes)),
		measurement: result.measurement,
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
	const addrs = [`/dns4/${host}/tcp/443/tls/ws/p2p/${peerId}`];
	await ctx.deviceSync.addDevice(peerId, t('messages.hostedBridge.deviceLabel'), {
		bridge: true,
		addrs,
		hosted: { host }
	});
	return { peerId, host, measurement: result.measurement };
}

/**
 * The hosted bridge's VM as the books last recorded it (#587): which
 * instance, on which node, since when, at what price; null when none.
 */
export async function hostedVmRecord() {
	if (!ctx.session?.store) return null;
	const { VM_SETTING } = await import('../integrations/hosted-vm.js');
	const kept = /** @type {any} */ (await getSetting(ctx.session.store.settings, VM_SETTING));
	return typeof kept?.instance === 'string' ? kept : null;
}

/**
 * The books' own image of the hosted bridge (#777), as built from this
 * browser: its STORE and the plain image it was made from; null while there
 * is none. Its passphrase is in no record: it is derived when needed.
 */
export async function hostedOwnImage() {
	if (!ctx.session?.store) return null;
	const { IMAGE_SETTING, ownImageOf } = await import('../integrations/hosted-image.js');
	return ownImageOf(await getSetting(ctx.session.store.settings, IMAGE_SETTING));
}

/** The passphrase of the books' own image made from `plainSha256`, derived here, never kept. @param {string} plainSha256 */
export async function ownImagePassphrase(plainSha256) {
	if (!ctx.session?.imageBase) throw new Error(t('messages.hostedBridge.ownImageOwnerOnly'));
	const { deriveImagePassphrase } = await import('../database-keys.js');
	return deriveImagePassphrase(ctx.session.imageBase, plainSha256);
}

/** The books' key as the app key the shared VM code signs with. @param {Uint8Array} key @param {string} owner */
async function alephAppKey(key, owner) {
	const { alephSign } = await import('../backup/aleph-signer.js');
	return {
		address: owner,
		signMessage: async (/** @type {{ message: string }} */ { message }) => alephSign(key, message)
	};
}

/**
 * A builder a window closed during a build left on Aleph (#777): forgotten
 * now, so it costs no longer than until the card opens again. Quiet: a
 * device that may not write the settings leaves it to the next one.
 */
export async function forgetLeftHostedBuilder() {
	if (!ctx.session?.store || !ctx.session.online || ctx.app.member || networkPause()) return;
	const { BUILDER_SETTING, forgetLeftBuilder } = await import('../integrations/hosted-image.js');
	const left = /** @type {any} */ (await getSetting(ctx.session.store.settings, BUILDER_SETTING));
	if (!left?.vprogram) return;
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { poster } = await import('@le-space/aleph-vm');
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const forgotten = await forgetLeftBuilder({
		app: await alephAppKey(key, owner),
		payer: typeof left.payer === 'string' ? left.payer : owner,
		vprogram: left.vprogram,
		post: poster({ api: apiHost, fetch: await alephFetchFor(apiHost, () => {}) })
	}).catch(() => false);
	if (forgotten)
		await setSetting(ctx.session.store.settings, BUILDER_SETTING, null).catch(() => {});
}

/**
 * What Aleph wants in reserve before it starts the builder, and what the
 * books' key holds: a day of the builder besides what the key pays for
 * already (a VM it runs itself).
 *
 * @param {{ owner: string, apiHost: string, running: any }} p
 */
async function buildReserve({ owner, apiHost, running }) {
	const vm = await import('../integrations/hosted-vm.js');
	const image = await import('../integrations/hosted-image.js');
	const spending =
		running && !running.stoppedAt && running.payer === owner
			? Number(running.creditsPerHour) || 0
			: 0;
	const needed = image.creditsNeededForBuild({ spendingPerHour: spending });
	// Aleph's second host when the first does not answer; an address neither
	// host knows (404 from both) holds nothing.
	const credits = await vm
		.creditsOf(owner, { apiHost, fetch: await alephFetchFor(apiHost, () => {}) })
		.catch((e) => {
			const tried = /** @type {any} */ (e)?.name === 'AlephUnavailable' && e.tried;
			if (tried?.length && tried.every((/** @type {any} */ x) => x.outcome === 'HTTP 404'))
				return 0;
			throw e;
		});
	return { credits, needed };
}

/**
 * Whether the books' key can pay a build now, for the card before the click:
 * its credits and the reserve Aleph wants; null when that cannot be asked
 * (no books open, a member's device, Aleph not answering).
 *
 * @returns {Promise<{ credits: number, needed: number, address: string } | null>}
 */
export async function hostedBuildReserve() {
	if (!ctx.session?.online || !ctx.session.store || !ctx.session.imageBase || ctx.app.member)
		return null;
	if (networkPause()) return null;
	try {
		const { alephEndpoints } = await import('../backup/keeper.js');
		const { owner } = await hostedOwner();
		const { apiHost } = alephEndpoints();
		const r = await buildReserve({ owner, apiHost, running: await hostedVmRecord() });
		return { ...r, address: owner };
	} catch {
		return null;
	}
}

/**
 * "Bridge-Image bauen" (#777): the books' own image of the hosted bridge,
 * sealed by an attested builder with a passphrase derived here, stored on
 * Aleph as a STORE of the books' key and paid by it. Only with the books' own
 * key as payer: a build through Le Space's plan is not offered yet. The next
 * start uses this image and unlocks it without a typed passphrase.
 *
 * @param {{ signal?: AbortSignal, onProgress?: (p: { phase: string, detail?: string, received?: number, total?: number | null, step?: string, data?: Record<string, any> }) => void }} [p]
 */
export async function buildHostedImage({ signal, onProgress = () => {} } = {}) {
	refuseWhilePaused();
	if (!ctx.session?.online || !ctx.session.store) throw new Error(t('messages.bridge.needsSync'));
	if (!ctx.session.imageBase || ctx.app.member)
		throw new Error(t('messages.hostedBridge.ownImageOwnerOnly'));
	const hosted = await import('../integrations/hosted-bridge.js');
	const image = await import('../integrations/hosted-image.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const settings = ctx.session.store.settings;
	const running = await hostedVmRecord();
	await forgetLeftHostedBuilder();

	const first = hosted.attestUrlOf(ctx.session.relays ?? []);
	/** @type {string[]} */
	const relays = [
		...(first ? [first] : []),
		...image.attestUrlsOf(ctx.session.relays ?? [])
	].filter((u, i, all) => all.indexOf(u) === i);
	if (!relays.length) throw new Error(t('messages.hostedBridge.noRelay'));

	const { credits, needed } = await buildReserve({ owner, apiHost, running });
	if (credits < needed) {
		throw new Error(
			t('messages.hostedBridge.ownImageFewCredits', {
				needed: needed.toLocaleString(intlLocale()),
				credits: Math.floor(credits).toLocaleString(intlLocale())
			})
		);
	}

	const appKey = await alephAppKey(key, owner);
	signal?.throwIfAborted();
	/** What went wrong, in the card's words; the package's own message stays for the technical view. */
	const failed = (/** @type {unknown} */ e) => {
		const code = String(/** @type {any} */ (e)?.code ?? '');
		const message = e instanceof Error ? e.message : String(e);
		const why = /measurement|policy|signature|rejected/i.test(message)
			? 'attestation'
			: code === 'refused'
				? 'refused'
				: code === 'unreachable' || code === 'no-relay'
					? 'unreachable'
					: /^(upload-refused|upload-broken|store-rejected|other-image)$/.test(code)
						? 'upload'
						: 'other';
		const error = new Error(
			t('messages.hostedBridge.ownImageFailed', {
				reason: t(`messages.hostedBridge.ownImageWhy.${why}`)
			})
		);
		/** @type {any} */ (error).detail = message;
		/** @type {any} */ (error).code = code;
		return error;
	};
	const built = await image
		.buildBridgeImage({
			imageBase: ctx.session.imageBase,
			app: appKey,
			relays,
			apiHost,
			// Aleph's second host when the first does not answer (aleph-fetch.js).
			fetch: await alephFetchFor(apiHost, () => {}),
			attest: async () => {
				const wasm = await import('@le-space/attest-wasm/pkg/relay_button_attest.js');
				await wasm.default();
				const { attestGuest, websocketTransport } = await import('@le-space/attest-wasm/ratls');
				return {
					attestGuest,
					wasm,
					relayTransports:
						(/** @type {string[]} */ [relay]) =>
						(/** @type {string} */ route) =>
							websocketTransport(`${relay}${route}`)
				};
			},
			onStarted: async (/** @type {string} */ vprogram) => {
				await setSetting(settings, image.BUILDER_SETTING, {
					vprogram,
					payer: owner,
					startedAt: isoNow()
				});
			},
			onForgotten: async () => {
				await setSetting(settings, image.BUILDER_SETTING, null);
			},
			onProgress: ({ step, data = {} }) => {
				// `step` and `data` as the build reported them, for the journey view (@le-space/build-journey).
				if (step === 'fetch' || step === 'upload') {
					onProgress({
						phase: `ownImage.${step}`,
						detail: String(data.host ?? ''),
						received: Number(data.got ?? 0),
						total: Number(data.size ?? 0) || null,
						step,
						data
					});
				} else onProgress({ phase: `ownImage.${step}`, detail: '', step, data });
			}
		})
		.catch((e) => {
			throw failed(e);
		});
	await setSetting(settings, image.IMAGE_SETTING, { ...built, payer: owner });
	return built;
}

/** Where Aleph's node list is read: Aleph's, or in an E2E build the fake Aleph's. */
async function hostedNodeList() {
	const vm = await import('../integrations/hosted-vm.js');
	if (import.meta.env.VITE_E2E === 'true') {
		const { E2E_ALEPH_URL_KEY } = await import('../backup/keeper.js');
		const base = globalThis.localStorage?.getItem(E2E_ALEPH_URL_KEY);
		if (base) return { url: `${base}/crns.json`, loopback: true };
	}
	return { url: vm.CRN_LIST, loopback: false };
}

/**
 * What the books remember about nodes (sealed settings): which could not be
 * attested and when, and where the last unlock held.
 *
 * @returns {Promise<import('../integrations/hosted-nodes.js').NodeHistory>}
 */
export async function hostedNodeHistory() {
	const { NODES_SETTING, nodeHistoryOf } = await import('../integrations/hosted-nodes.js');
	return nodeHistoryOf(
		ctx.session?.store ? await getSetting(ctx.session.store.settings, NODES_SETTING) : null
	);
}

/** The confidential nodes a hosted bridge can start on, best first (#587). */
export async function hostedNodes() {
	refuseWhilePaused();
	const { loadNodes } = await import('../integrations/hosted-vm.js');
	return loadNodes(await hostedNodeList());
}

/**
 * The books' Aleph key and its address, on a device that may start a VM.
 * @returns {Promise<{ key: Uint8Array, owner: string }>}
 */
async function hostedOwner() {
	if (!ctx.session?.store) throw new Error(t('messages.bridge.needsSync'));
	const { ensureBackupKey } = await import('../backup/keeper.js');
	const { alephAddressOf } = await import('../backup/aleph-signer.js');
	const key = await ensureBackupKey(ctx.session.store.settings, { create: !ctx.app.member });
	if (!key) throw new Error(t('messages.hostedBridge.noAlephKey'));
	return { key, owner: alephAddressOf(key) };
}

/** A Le Space Credits client for the books, or null while the person has not switched them on. */
async function creditsClientOf(/** @type {Uint8Array} */ key) {
	if (!ctx.session?.store) return null;
	const { ON_SETTING, createCreditsClient } = await import('../credits/credits.js');
	if ((await getSetting(ctx.session.store.settings, ON_SETTING)) !== true) return null;
	return createCreditsClient({ key });
}

/**
 * Le Space's sub-account that pays these books' VM, as Le Space Credits name
 * it; null when Credits are off or name none.
 *
 * @param {Uint8Array} key the books' Aleph key
 */
async function leSpaceVmAccount(key) {
	const client = await creditsClientOf(key);
	const owner = client ? (await client.balance())?.vm?.owner : null;
	return typeof owner === 'string' && /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner : null;
}

/**
 * What the hosted bridge card shows of Le Space Credits (#587): whether they
 * are on, the balance in credits, the plan and the hours it holds. Null
 * fields when Credits are off.
 */
export async function hostedCredits() {
	refuseWhilePaused();
	const { key } = await hostedOwner();
	const client = await creditsClientOf(key);
	if (!client)
		return {
			on: false,
			credits: null,
			plan: null,
			hoursLeft: null,
			periodEnd: null,
			termsDue: false
		};
	const { termsOf } = await import('../credits/credits.js');
	const balance = await client.balance();
	const plan = balance?.package ?? null;
	return {
		on: true,
		credits: Number(balance?.credits ?? 0) - Number(balance?.reserved ?? 0),
		plan: plan?.id ?? null,
		hoursLeft: plan?.hours_left ?? null,
		periodEnd: plan?.period_end ?? null,
		termsDue: termsOf(balance?.terms).due
	};
}

/**
 * "Paket wählen" on the hosted bridge card: a plan of the hosted bridge, paid
 * from the books' balance at Le Space Credits; its first period opens now.
 *
 * @param {string} planId one of credits.js BRIDGE_PLANS
 */
export async function chooseHostedPlan(planId) {
	refuseWhilePaused();
	const { BRIDGE_PLANS } = await import('../credits/credits.js');
	if (!BRIDGE_PLANS.some((p) => p.id === planId))
		throw new Error('not a plan of the hosted bridge');
	const { key } = await hostedOwner();
	const client = await creditsClientOf(key);
	if (!client) throw new Error(t('messages.hostedBridge.creditsOff'));
	try {
		await client.choosePlan(planId);
	} catch (e) {
		// The terms came into force since the card read the balance.
		if (/** @type {any} */ (e)?.status === 412 && /** @type {any} */ (e)?.code === 'TERMS')
			throw new Error(t('credits.terms.needed'), { cause: e });
		throw e;
	}
	return hostedCredits();
}

/**
 * Le Space's sub-account for these books, with the books' key authorized to
 * start, forget and forward its VM (Le Space Credits' model A).
 *
 * @param {Uint8Array} key @param {string} owner the books' key's address
 * @returns {Promise<{ payer: string, hoursLeft: number | null }>}
 */
async function authorizeLeSpacePayer(key, owner) {
	const client = await creditsClientOf(key);
	if (!client) throw new Error(t('messages.hostedBridge.creditsOff'));
	let answer;
	try {
		answer = await client.vmAuthorize(owner);
	} catch (e) {
		if (/** @type {any} */ (e)?.code === 'NO_PLAN')
			throw new Error(t('messages.hostedBridge.noPlan'));
		// Le Space's terms are in force and not agreed to yet (credits/TermsConsent.svelte).
		if (/** @type {any} */ (e)?.status === 412 && /** @type {any} */ (e)?.code === 'TERMS')
			throw new Error(t('credits.terms.needed'), { cause: e });
		throw e;
	}
	if (!/^0x[0-9a-fA-F]{40}$/.test(String(answer?.owner ?? ''))) {
		throw new Error(t('messages.hostedBridge.noPayer'));
	}
	return { payer: answer.owner, hoursLeft: answer.hours_left ?? null };
}

/**
 * "Starten" on the "Gehostete Bridge" card (#587): ask Aleph for a
 * confidential VM of the published bridge image, owned by the books' Aleph
 * key and paid by `paidBy` – Le Space from the books' plan (its sub-account,
 * the books' key as delegate) or the books' key itself – then bring it up and
 * unlock and pair it (`continueHostedStart`). The VM is recorded, sealed, as
 * soon as Aleph has it, so a start that is interrupted carries on from there.
 *
 * @param {{ crn: string, passphrase?: string, paidBy?: 'lespace' | 'books', signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string, attempt?: number, tries?: number }) => void }} p
 */
export async function startHostedBridge({
	crn,
	passphrase,
	paidBy = 'books',
	signal,
	onProgress = () => {}
}) {
	refuseWhilePaused();
	if (!ctx.session?.online || !ctx.session.bridgeAuthBase || !ctx.deviceSync) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	// The books' own image (#777) when they pay themselves and have one; else the shared one.
	const own = paidBy === 'books' && !ctx.app.member ? await hostedOwnImage() : null;
	if (!own && !passphrase) throw new Error(t('messages.hostedBridge.noPassphrase'));
	const vm = await import('../integrations/hosted-vm.js');
	const hosted = await import('../integrations/hosted-bridge.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { alephSign } = await import('../backup/aleph-signer.js');
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const running = await hostedVmRecord();
	if (running && !running.stoppedAt) throw new Error(t('messages.hostedBridge.alreadyRunning'));

	onProgress({ phase: 'node', detail: crn });
	const node = (await hostedNodes()).find((n) => n.hash === crn);
	if (!node) throw new Error(t('messages.hostedBridge.noNode'));

	// Who pays: Le Space's sub-account for these books, or the books' key.
	let payer = owner;
	if (paidBy === 'lespace') {
		onProgress({ phase: 'payer', detail: '' });
		({ payer } = await authorizeLeSpacePayer(key, owner));
	}

	onProgress({ phase: 'measure', detail: '' });
	/** @type {any} */
	let trustedExecution = null;
	if (import.meta.env.VITE_E2E === 'true') {
		const pins = globalThis.localStorage?.getItem(hosted.E2E_HOSTED_PINS_KEY);
		if (pins) trustedExecution = JSON.parse(pins);
	}
	if (!trustedExecution) {
		const wasm = await import('@le-space/attest-wasm/pkg/relay_button_attest.js');
		await wasm.default();
		const { confidentialTrustedExecution } = await import('@le-space/attest-wasm/instance');
		trustedExecution = await confidentialTrustedExecution({
			wasm,
			owner,
			vcpus: vm.HOSTED_VM.vcpus,
			apiHost,
			fetch: await alephFetchFor(apiHost, onProgress),
			onProgress
		}).catch((e) => {
			throw alephSaid(e);
		});
	}

	const content = vm.instanceContent({
		payer,
		image: own?.store ?? hosted.HOSTED_IMAGE,
		crn,
		trustedExecution,
		name: `belege-bridge-${isoNow().slice(0, 16)}`
	});
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	const message = await vm.signedMessage({ type: 'INSTANCE', content, sign, sender: owner });
	// Aleph takes the VM only with a day of its price in reserve: said here, before it refuses.
	const [perHour, credits] = await Promise.all([
		vm.creditsPerHour(message, { apiHost }),
		vm.creditsOf(payer, { apiHost })
	]);
	if (perHour && credits < vm.RESERVE_HOURS * perHour) {
		throw new Error(
			t(
				paidBy === 'lespace'
					? 'messages.hostedBridge.fewHours'
					: 'messages.hostedBridge.fewCredits',
				{
					needed: (vm.RESERVE_HOURS * perHour).toLocaleString(intlLocale()),
					credits: Math.floor(credits).toLocaleString(intlLocale()),
					perHour: perHour.toLocaleString(intlLocale())
				}
			)
		);
	}

	onProgress({ phase: 'requested', detail: message.item_hash });
	const instance = await vm.sendMessage(message, { apiHost });
	await setSetting(ctx.session.store.settings, vm.VM_SETTING, {
		instance,
		crn,
		nodeUrl: node.url,
		payer,
		paidBy,
		startedAt: isoNow(),
		creditsPerHour: perHour,
		...(own ? { image: own.store, plainSha256: own.plainSha256 } : {})
	});
	return continueHostedStart({ passphrase, signal, onProgress });
}

/**
 * From a VM Aleph has to a paired bridge: the node told, 443 forwarded, then
 * the attestation and unlock of #585. The VM boots meanwhile; until its agent
 * answers, the unlock is tried again, each try once, and the card hears which
 * try it is and why the last one failed. An answer that refuses the VM
 * (another measurement, image or owner), or an error trying again will not
 * help with (integrations/hosted-unlock.js), ends it: no secret went out.
 * `signal` cancels the waiting; the VM keeps running.
 *
 * @param {{ passphrase?: string, signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string, attempt?: number, tries?: number }) => void, patience?: { tries?: number, delayMs?: number } }} p
 */
export async function continueHostedStart({
	passphrase,
	signal,
	onProgress = () => {},
	patience = {}
}) {
	refuseWhilePaused();
	const vm = await import('../integrations/hosted-vm.js');
	const { pause, reasonOf, unlockVerdict } = await import('../integrations/hosted-unlock.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { alephSign } = await import('../backup/aleph-signer.js');
	const record = await hostedVmRecord();
	if (!record || record.stoppedAt || !ctx.session?.store)
		throw new Error(t('messages.hostedBridge.noVm'));
	// A VM of the books' own image opens with the derived passphrase; the shared one with the typed one.
	if (!record.image && !passphrase) throw new Error(t('messages.hostedBridge.noPassphrase'));
	const settings = ctx.session.store.settings;
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const { loopback } = await hostedNodeList();
	const nodeUrl = vm.nodeUrlOf(record.nodeUrl, { loopback });
	if (!nodeUrl) throw new Error(t('messages.hostedBridge.noNode'));
	/** @type {{ tries?: number, delayMs?: number }} */
	let e2ePatience = {};
	if (import.meta.env.VITE_E2E === 'true') {
		// A test waits seconds, not minutes, for a VM that does not answer.
		try {
			e2ePatience = JSON.parse(
				globalThis.localStorage?.getItem('belege.e2e.hostedPatience') ?? '{}'
			);
		} catch {
			e2ePatience = {};
		}
	}
	const { tries = 60, delayMs = 10_000 } = { ...e2ePatience, ...patience };
	/** A node retries a failed start a few times; after three it is not going to work there. */
	const gaveUp = (/** @type {any} */ p) => Boolean(p?.failed && p.failed.attempts >= 3);

	onProgress({ phase: 'network', detail: record.instance });
	let placed = await vm.onNode(nodeUrl, record.instance);
	if (!placed) {
		await vm.notifyNode(nodeUrl, record.instance);
		placed = await vm.onNode(nodeUrl, record.instance);
	}
	// The account that pays the VM holds its port forwards; the books' key sends for it.
	const payer = typeof record.payer === 'string' ? record.payer : owner;
	if (!placed?.port443) {
		const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
		await vm.sendMessage(
			await vm.signedMessage({
				type: 'AGGREGATE',
				content: vm.forward443Content(payer, record.instance),
				sign,
				sender: owner
			}),
			{ apiHost }
		);
		for (let i = 0; i < tries && !placed?.port443; i++) {
			// The node gave up starting it: waiting longer will not help (#587).
			if (gaveUp(placed)) break;
			onProgress({ phase: 'network', detail: record.instance, attempt: i + 1, tries });
			await pause(delayMs, signal);
			refuseWhilePaused();
			placed = await vm.onNode(nodeUrl, record.instance);
		}
		if (gaveUp(placed)) {
			throw new Error(
				t('messages.hostedBridge.startupFailed', {
					code: placed?.failed?.code ?? '',
					attempts: placed?.failed?.attempts ?? 0
				})
			);
		}
		if (!placed?.port443) throw new Error(t('messages.hostedBridge.noPort'));
	}

	// The VM boots, and its agent answers only then.
	/** @type {unknown} */
	let last = null;
	for (let i = 0; i < tries; i++) {
		if (i) await pause(delayMs, signal);
		try {
			const done = await unlockHostedBridge({
				instance: record.instance,
				passphrase: record.image ? undefined : passphrase,
				payer,
				// This loop is the patience: one ask per try, so each try's reason is seen.
				attempts: 1,
				signal,
				onProgress
			});
			await setSetting(settings, vm.VM_SETTING, {
				...record,
				unlockedAt: isoNow()
			});
			return done;
		} catch (e) {
			last = e;
			// Refused, or nothing a later try changes: say why now instead of waiting.
			if (unlockVerdict(e) === 'stop') throw e;
			onProgress({ phase: 'boot', detail: reasonOf(e), attempt: i + 1, tries });
		}
	}
	throw last;
}

/**
 * "Stoppen" (#587): FORGET the VM; its node stops and drops it, and the VM
 * keeps nothing. The books keep when it ran, for the hours used; the hosted
 * bridge leaves the devices.
 */
export async function stopHostedBridge() {
	refuseWhilePaused();
	const vm = await import('../integrations/hosted-vm.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { alephSign } = await import('../backup/aleph-signer.js');
	const record = await hostedVmRecord();
	if (!record || record.stoppedAt || !ctx.session?.store)
		throw new Error(t('messages.hostedBridge.noVm'));
	const settings = ctx.session.store.settings;
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	const payer = typeof record.payer === 'string' ? record.payer : owner;
	await vm.sendMessage(
		await vm.signedMessage({
			type: 'FORGET',
			content: vm.forgetContent(payer, record.instance),
			sign,
			sender: owner
		}),
		{ apiHost }
	);
	const stoppedAt = isoNow();
	await setSetting(settings, vm.VM_SETTING, { ...record, stoppedAt });
	const paired = await hostedBridgeRecord();
	if (paired && paired.instance === record.instance && paired.peerId && ctx.deviceSync) {
		await ctx.deviceSync.removeDevice(paired.peerId).catch(() => {});
	}
	return { stoppedAt };
}

/**
 * The VMs the books' Aleph key started that Aleph still holds (#587), newest
 * first, with the node each runs on as Aleph's node list names it, and
 * whether it is the one these books recorded or unlocked.
 *
 * @returns {Promise<Array<import('../integrations/hosted-vm.js').OwnInstance & { nodeName: string | null, nodeUrl: string | null, known: boolean }>>}
 */
export async function hostedInstances() {
	refuseWhilePaused();
	const vm = await import('../integrations/hosted-vm.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const [list, nodes, record, paired] = await Promise.all([
		vm.listInstances(owner, { apiHost }),
		hostedNodes().catch(() => []),
		hostedVmRecord(),
		hostedBridgeRecord()
	]);
	return list.map((i) => {
		const node = nodes.find((n) => n.hash === i.crn);
		const recorded = record?.instance === i.hash;
		return {
			...i,
			nodeName: node?.name ?? null,
			nodeUrl:
				node?.url ?? (recorded && typeof record?.nodeUrl === 'string' ? record.nodeUrl : null),
			known: recorded || paired?.instance === i.hash
		};
	});
}

/**
 * "Stoppen" for one of the books' key's VMs from the list (#587): FORGET it,
 * paid by whoever its INSTANCE names. The one these books recorded stops as
 * `stopHostedBridge` stops it.
 *
 * @param {string} instance
 */
export async function stopHostedInstance(instance) {
	refuseWhilePaused();
	const hash = String(instance ?? '').trim();
	const record = await hostedVmRecord();
	if (record && !record.stoppedAt && record.instance === hash) return stopHostedBridge();
	if (!ctx.session?.store) throw new Error(t('messages.bridge.needsSync'));
	const vm = await import('../integrations/hosted-vm.js');
	const hosted = await import('../integrations/hosted-bridge.js');
	const { alephEndpoints } = await import('../backup/keeper.js');
	const { alephSign } = await import('../backup/aleph-signer.js');
	if (!hosted.isInstanceHash(hash)) throw new Error(t('messages.hostedBridge.notInstance'));
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const { content } = await hosted.fetchInstance(hash, { apiHost });
	const payer = /^0x[0-9a-fA-F]{40}$/.test(String(content?.address ?? ''))
		? content.address
		: owner;
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	await vm.sendMessage(
		await vm.signedMessage({
			type: 'FORGET',
			content: vm.forgetContent(payer, hash),
			sign,
			sender: owner
		}),
		{ apiHost }
	);
	const paired = await hostedBridgeRecord();
	if (paired && paired.instance === hash && paired.peerId && ctx.deviceSync) {
		await ctx.deviceSync.removeDevice(paired.peerId).catch(() => {});
	}
	return { stoppedAt: isoNow() };
}
