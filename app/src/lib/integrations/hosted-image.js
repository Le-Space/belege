// The books' own image of the hosted bridge (#777).
//
// The shared image (hosted-bridge.js HOSTED_IMAGE) opens with one passphrase
// that Le Space holds and the owner types. An image of the books' own is the
// same plain image (bridge/rootfs, published by the "Bridge image" workflow
// with "plain"), sealed for these books alone by an attested builder:
//
//   1. the browser derives the passphrase from the books' image base
//      (database-keys.js deriveImagePassphrase): nobody types it, nothing
//      stores it;
//   2. it starts a builder from the publication pinned below (a V-PROGRAM on
//      Aleph, paid by the books' key), attests it through Le Space's attest
//      relays against the pinned measurement, and only then hands it the
//      passphrase;
//   3. it fetches the sealed image back in runs, each over a channel attested
//      anew, forgets the builder, and stores the image on Aleph as a STORE
//      of the books' key;
//   4. a VM started from that STORE opens only with the derived passphrase.
//
// The build itself is @le-space/sealed-image's (NiKrause/relay-button#225);
// this module pins what Belege trusts and keeps the record of what was built.

import { attestedOpener, forgetVProgram, messageStatus, poster } from '@le-space/aleph-vm';
import {
	buildOnFreshBuilder,
	checkBuilder,
	creditsForBuild,
	MAX_PLAIN_BYTES,
	storeOnAleph
} from '@le-space/sealed-image';
import { templateMismatches } from '@le-space/aleph-vm/vprogram';
import { deriveImagePassphrase } from '../database-keys.js';
import { VM_CHANNEL } from './hosted-vm.js';
import { BRIDGE_BUILDER } from './bridge-builder.js';

export { BRIDGE_BUILDER } from './bridge-builder.js';

/** The sealed record of the books' own image: which STORE, from which plain image, when, attested how. */
export const IMAGE_SETTING = 'bridge/own-image';

/**
 * The builder of a build that is running, noted between its start and its
 * forget: a window closed in between leaves it here, and the card forgets it
 * at its next opening, so it costs no longer than that.
 */
export const BUILDER_SETTING = 'bridge/own-image-builder';

const HASH = /^[0-9a-f]{64}$/;

/**
 * The record of an own image, or null when `raw` is none.
 *
 * @param {unknown} raw what IMAGE_SETTING holds
 * @returns {{ store: string, plainSha256: string, size: number | null, builtAt: string | null, measurement: string | null, builder: string | null } | null}
 */
export function ownImageOf(raw) {
	const r = /** @type {any} */ (raw);
	if (!r || !HASH.test(r.store ?? '') || !HASH.test(r.plainSha256 ?? '')) return null;
	return {
		store: r.store,
		plainSha256: r.plainSha256,
		size: Number.isSafeInteger(r.size) ? r.size : null,
		builtAt: typeof r.builtAt === 'string' ? r.builtAt : null,
		measurement: typeof r.measurement === 'string' ? r.measurement : null,
		builder: HASH.test(r.builder ?? '') ? r.builder : null
	};
}

/**
 * The /attest of every relay the books use that has a TLS WebSocket by name:
 * where a builder is reached. A relay that does not carry the next run hands
 * it to the next one.
 *
 * @param {string[]} relays multiaddrs
 * @returns {string[]} `wss://<host>/attest`, each once
 */
export function attestUrlsOf(relays) {
	const urls = [];
	for (const relay of relays ?? []) {
		const m = /^\/dns4\/([a-z0-9.-]+)\/tcp\/443\/tls\/ws\//.exec(relay);
		if (m) urls.push(`wss://${m[1]}/attest`);
	}
	return [...new Set(urls)];
}

/**
 * The credits the books' key must hold for Aleph to start a builder: a day of
 * the builder and of the sealed image's storage (Aleph's min_runtime_days),
 * besides what it already pays for. Most of it stays: a build uses about a
 * quarter of an hour of the builder.
 *
 * @param {{ builderPerHour?: number | null, spendingPerHour?: number }} [o]
 */
export const creditsNeededForBuild = (o = {}) => creditsForBuild(o);

/**
 * Is the pinned builder complete and coherent (V-PROGRAM content, node,
 * measurements and the plain image agree)? Checked by the tests and before
 * every build.
 *
 * @param {any} [builder]
 * @returns {string[]} what does not agree; empty when all does
 */
export function builderProblems(builder = BRIDGE_BUILDER) {
	try {
		checkBuilder(builder);
	} catch (e) {
		return [e instanceof Error ? e.message : String(e)];
	}
	return templateMismatches(builder);
}

/**
 * Build the books' own image: start a builder from BRIDGE_BUILDER, attest
 * it, have it seal the plain image with the books' passphrase, fetch it back
 * and store it on Aleph, paid by `payer` (the books' key). Resolves to the
 * record to keep under IMAGE_SETTING.
 *
 * Everything that reaches the network is handed in, so tests run it against
 * fakes: `attest` loads what attests (attest-wasm), `post` sends Aleph
 * messages, `store` uploads, `read` asks for a message's status.
 *
 * @param {{
 *   imageBase: Uint8Array,
 *   app: import('@le-space/aleph-vm').AppKey,
 *   payer?: string,
 *   relays: string[],
 *   apiHost: string,
 *   attest: () => Promise<{ attestGuest: (a: any) => Promise<any>, wasm: any, relayTransports: (relays: string[]) => (route: string) => any }>,
 *   builder?: any,
 *   onProgress?: (p: { step: string, data?: Record<string, any> }) => void,
 *   onStarted?: (vprogram: string) => Promise<void> | void,
 *   onForgotten?: (vprogram: string) => Promise<void> | void,
 *   fetch?: typeof fetch,
 *   post?: (message: any) => Promise<any>,
 *   store?: typeof storeOnAleph,
 *   read?: (itemHash: string) => Promise<string | null>,
 *   now?: () => number,
 *   tuning?: Record<string, any>
 * }} a
 * @returns {Promise<{ store: string, cid: string, size: number, plainSha256: string, builtAt: string, measurement: string | null, builder: string | null }>}
 */
export async function buildBridgeImage({
	imageBase,
	app,
	payer = app.address,
	relays,
	apiHost,
	attest,
	builder = BRIDGE_BUILDER,
	onProgress = () => {},
	onStarted,
	onForgotten,
	fetch: get,
	post = poster({ api: apiHost, ...(get ? { fetch: get } : {}) }),
	store = (image, message) => storeOnAleph(image, message, apiHost),
	read = (itemHash) => messageStatus(itemHash, { api: apiHost, ...(get ? { fetch: get } : {}) }),
	now = Date.now,
	tuning = {}
}) {
	const problems = builderProblems(builder);
	if (problems.length)
		throw new Error(`the pinned builder is not complete: ${problems.join('; ')}`);
	if (!relays?.length) throw Object.assign(new Error('no attest relay'), { code: 'no-relay' });
	const passphrase = await deriveImagePassphrase(imageBase, builder.plain.sha256);
	const result = await buildOnFreshBuilder({
		passphrase,
		app,
		payer,
		channel: VM_CHANNEL,
		builder,
		opener: (/** @type {any} */ running) =>
			attestedOpener(running, async () => {
				const loaded = await attest();
				return { ...loaded, relays };
			}),
		onProgress,
		onStarted,
		onForgotten,
		post,
		// Every upload to the Aleph API the books already use: no host the consent screen does not name.
		store: (/** @type {Blob} */ image, /** @type {any} */ message) => store(image, message),
		read,
		now,
		...tuning
	});
	return {
		store: result.storeHash,
		cid: result.cid,
		size: result.size,
		plainSha256: result.plainSha256,
		builtAt: result.builtAt,
		// What the hardware showed for the builder that sealed it, and which V-PROGRAM it was.
		measurement: result.attested?.measurement ?? null,
		builder: result.attested?.vprogram ?? null
	};
}

/**
 * Forget a builder a closed window left running (BUILDER_SETTING). True when
 * Aleph took the FORGET, or there was none.
 *
 * @param {{ app: import('@le-space/aleph-vm').AppKey, payer?: string, vprogram: string | null | undefined, post?: (m: any) => Promise<any> }} a
 */
export async function forgetLeftBuilder({ app, payer = app.address, vprogram, post }) {
	if (!HASH.test(vprogram ?? '')) return true;
	return forgetVProgram(app, /** @type {string} */ (vprogram), {
		channel: VM_CHANNEL,
		reason: 'build window closed',
		payer,
		...(post ? { post } : {})
	});
}

export { MAX_PLAIN_BYTES };
