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

/**
 * The builder for the bridge's plain image: one publication per plain image
 * (NiKrause/relay-button#225), recorded in relay-button as
 * packages/sealed-image/builder/publications/belege-bridge.json (#244).
 * Published 2026-11-16 on the node below, attested and deleted again; each
 * build starts a V-PROGRAM with exactly this content, and the hardware must
 * show one of these measurements before the passphrase goes out. A new plain
 * image needs a new publication and a new entry here.
 */
export const BRIDGE_BUILDER = Object.freeze({
	claim: 'sealed image build',
	vprogram: '546e759c3721ccee9678105f65e9c6461b0d99ab9d83a9c8cbd0d28cf6eae52f',
	program: {
		allow_amend: false,
		environment: { internet: true },
		metadata: { name: 'sealed-image-builder-belege-bridge' },
		payment: { type: 'credit' },
		requirements: {
			node: { node_hash: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa' }
		},
		resources: { memory: 6144, seconds: 30, vcpus: 2 },
		runtime: {
			comment: '',
			ref: 'b8e43148123e34f5f02ffd65bab62b716b74706ba77cf10cbe329af32f01f10a'
		},
		verification: {
			backend: 'sev_snp',
			measurements: [
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'5da11fd2d742e92569953329775e3f66414bb03825731ffa5fd889cb1baefbc62228aea5ddf4437c7771c918c299d88b'
					},
					vcpu_type: 'EPYC-Genoa'
				},
				{
					platform: 'sev_snp',
					registers: {
						launch:
							'cb5213bce94283fbfda642c716625b9034e007371159f9431043d5ccb379c7b6f42f35cca2511ee92595b2445436f705'
					},
					vcpu_type: 'EPYC-v4'
				}
			],
			policy: 196608
		},
		volumes: [
			{
				comment: '',
				hash_tree: '6d5f85f0bcb9061394d82998a40f8942661bddc08a4bcb9acf9c942e2ddbedbd',
				ref: 'f785d2ff21744b9e9742cee1283a38ef5cb0cf647dd9e2a68bc838f61bd988a2',
				roothash: '54bed2eebb1955b54b9a3dd1b6509cdbf13e57c849f8f950e10f043e626b0e8a'
			}
		],
		workload: {
			hash_tree: '67d6294648f96d0f5c007fee3f974431518309a128cd24d1a11c81c982d4dbf8',
			ref: '39775ea9e83e3e1a3d6263692d514dd296fce0111d4262c46f12c97f6b038d95',
			roothash: 'a1fe0c39f960e5470db1a7114909400b9b8a5a9a3c97f37c9ec70211eefc52b3'
		}
	},
	crn: '01a3143b384ca43a3af338031b03ae86c0a4e139a24b848475d3ddb9bfbce8fa',
	measurements: [
		'5da11fd2d742e92569953329775e3f66414bb03825731ffa5fd889cb1baefbc62228aea5ddf4437c7771c918c299d88b',
		'cb5213bce94283fbfda642c716625b9034e007371159f9431043d5ccb379c7b6f42f35cca2511ee92595b2445436f705'
	],
	policy: 196608,
	plain: {
		sha256: '25f03bb56bc7d305790ae90d878a1d8b9cf71871b5899dc179deeac9ede8efa5',
		store: '955d9a89252044708d301b2901af8c00d00715c3d25539ba1773fe4e6630f31e',
		commit: '53a65aa9c388dcbabc9a91eee376968831e31e1a'
	}
});

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
	post = poster({ api: apiHost }),
	store = (image, message) => storeOnAleph(image, message, apiHost),
	read = (itemHash) => messageStatus(itemHash, { api: apiHost }),
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
