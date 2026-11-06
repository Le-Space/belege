// The desktop's bridge for the person's other devices, over UCEP (issue #142).
//
// The bridge listens on 127.0.0.1 of the Mac only; a phone with the same
// books cannot reach it. A desktop that has the bridge paired can serve it to
// its own devices: with "Bridge für eigene Geräte freigeben" switched on (a
// flag in that browser), its device-sync node (sync/device-sync.js) offers
// the UCEP extension `belege-bridge` with one command, `request`. A request
// names a method and a path; the desktop checks both against a fixed list
// (no pairing, no setup, nothing that changes the bridge or deletes), makes
// the same call to its own bridge with its own token, and sends the answer
// back. The token never leaves the desktop.
//
// Who may call: the device-sync node's peers are per device (not the UCEP
// node of ucep/net.js, whose key every device of the passkey shares), and
// only a device the books know and have not removed (`device:<peer id>`) is
// answered. The connection is Noise-encrypted end to end; a relay in between
// sees ciphertext. Nothing is redacted between own devices.
//
// Since #573 the bridge has a node of its own that serves the same extension
// with the same `request` (bridge/src/stream.js): a peer of the books, gated
// like a device. It is paired by its invitation (`web+ucep:pair?…`, printed
// by `pnpm bridge`): this device pairs over the stream, hands the books'
// device key, relays and device list over (`handover`), and adds the bridge
// to the books as a device – from then on every device of the books reaches
// it through the relays, with no desktop browser open, and keeps its device
// list current (`devices`). The desktop forwarding above stays as the last
// resort for a bridge that runs with `--no-node`.
//
// On a device, `bridgeFetch` stands in for fetch in the bridge client
// (bridge/client.js): the bridge's own node first when it is connected and
// proved, then the bridge on this machine over HTTP, then a connected own
// device that serves the extension. Pairing and unpairing over HTTP stay
// with HTTP.
//
// UCEP's limits hold: a request up to 64 KiB, an answer up to 1 MiB over a
// direct connection (64 KiB while relayed), 60 s to answer. A stream answer
// that is too large falls back to HTTP on this machine, when there is one.

import { UcepError, createConsumer, createProvider, parseInvitation } from '@le-space/ucep';

export const EXTENSION = 'belege-bridge';
export const SHARE_FLAG_KEY = 'belege.bridge-share';
/** The bridge's own pairing and unpairing, over HTTP only (bridge/src/stream.js HTTP_ONLY). */
const HTTP_ONLY_PATH = /^\/(pair|unpair)$/;
/** How long a call without a token waits for the bridge's node after an unlock. */
export const STREAM_WAIT_MS = 20_000;
const PEER_ID = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;

/**
 * The bridge's own node, as the books keep it (settings `bridge.peerId`, the
 * device record for its addresses): module state, read on every call.
 *
 * @type {{ peerId: string } | null}
 */
let bridgeNode = null;

/** @param {{ peerId?: unknown } | null} node */
export function setBridgeNode(node) {
	const peerId = String(node?.peerId ?? '');
	bridgeNode = PEER_ID.test(peerId) ? { peerId } : null;
}

/** The bridge's node's peer id, when the books know one. */
export const bridgeNodePeer = () => bridgeNode?.peerId ?? null;

/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
};
/** @param {string} b64 */
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * The bridge routes another device may use: reading and asking, never
 * pairing, setup, shares, portals or deleting (bridge/src/server.js).
 */
const ALLOWED = /** @type {const} */ ([
	['GET', /^\/health$/],
	['GET', /^\/llm\/status$/],
	['GET', /^\/hibiscus\/accounts$/],
	['GET', /^\/hibiscus\/transactions$/],
	['GET', /^\/mail\/messages$/],
	['GET', /^\/mail\/attachment$/],
	['GET', /^\/mail\/search$/],
	['POST', /^\/mail\/assist$/],
	['POST', /^\/match\/assist$/],
	['POST', /^\/transfer\/assist$/],
	['POST', /^\/vendor\/assist$/],
	['POST', /^\/extract$/],
	['GET', /^\/rates$/],
	['GET', /^\/kraken\/(balances|ledgers)$/],
	['GET', /^\/chains$/],
	['GET', /^\/bitcoin\/key$/],
	['POST', /^\/[a-z0-9-]{2,20}\/wallet$/],
	['POST', /^\/aleph\/accounts$/],
	['GET', /^\/aleph\/statement$/]
]);

/** Whether another device may make this call. @param {string} method @param {string} path without query */
export const allowed = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));

/** @returns {Storage | null} */
function storage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** Whether this desktop serves its bridge to own devices (per browser). */
export function bridgeShareOn() {
	try {
		return storage()?.getItem(SHARE_FLAG_KEY) === 'on';
	} catch {
		return false;
	}
}

/** @param {boolean} on */
export function setBridgeShare(on) {
	try {
		if (on) storage()?.setItem(SHARE_FLAG_KEY, 'on');
		else storage()?.removeItem(SHARE_FLAG_KEY);
	} catch {
		// Blocked: stays off.
	}
}

/**
 * The command's work, apart from libp2p: check the caller and the call, ask
 * the own bridge, package the answer.
 *
 * @param {object} p
 * @param {{ method?: unknown, path?: unknown, body?: unknown } | null} p.args
 * @param {string} p.peerId the caller, authenticated by the secure channel
 * @param {(peerId: string) => boolean | Promise<boolean>} p.isOwnDevice
 * @param {() => { url: string, token: string } | null} p.bridge this desktop's pairing
 * @param {typeof fetch} [p.fetch]
 * @returns {Promise<{ status: number, contentType: string, json?: unknown, base64?: string }>}
 */
export async function serveRequest({ args, peerId, isOwnDevice, bridge, fetch: f = fetch }) {
	if (!(await isOwnDevice(peerId))) throw new UcepError('PAIRING_REQUIRED', 'not an own device');
	const method = String(args?.method ?? '');
	const target = String(args?.path ?? '');
	if (!target.startsWith('/') || target.startsWith('//')) {
		throw new UcepError('INVALID_ARGUMENTS', 'path');
	}
	const url = new URL(target, 'http://bridge');
	if (!allowed(method, url.pathname)) throw new UcepError('INVALID_ARGUMENTS', 'not allowed');
	const own = bridge();
	if (!own) throw new UcepError('UNAVAILABLE', 'no bridge paired here');
	let res;
	try {
		res = await f(`${own.url.replace(/\/+$/, '')}${url.pathname}${url.search}`, {
			method,
			headers: {
				Authorization: `Bearer ${own.token}`,
				...(args?.body !== undefined ? { 'Content-Type': 'application/json' } : {})
			},
			...(args?.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
			cache: 'no-store',
			credentials: 'omit'
		});
	} catch {
		throw new UcepError('UNAVAILABLE', 'the bridge on the desktop does not answer');
	}
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		return { status: res.status, contentType, json: await res.json().catch(() => null) };
	}
	return {
		status: res.status,
		contentType,
		base64: toBase64(new Uint8Array(await res.arrayBuffer()))
	};
}

/**
 * Serve the own bridge to own devices on the device-sync node.
 *
 * @param {object} p
 * @param {any} p.libp2p the device-sync node
 * @param {(peerId: string) => boolean | Promise<boolean>} p.isOwnDevice
 * @param {() => { url: string, token: string } | null} p.bridge
 * @param {(line: string) => void} [p.log] counts only
 */
export async function startBridgeProvider({ libp2p, isOwnDevice, bridge, log = () => {} }) {
	const provider = createProvider({
		libp2p,
		manifest: {
			id: EXTENSION,
			name: 'Belege bridge for own devices',
			version: '0.1.0',
			description: 'The bridge of this desktop, for devices of the same books.'
		},
		commands: {
			request: {
				description: 'One bridge call: { method, path, body? } → { status, json | base64 }',
				handler: async ({ argsJson, peerId }) => {
					const answer = await serveRequest({ args: argsJson, peerId, isOwnDevice, bridge });
					log(`bridge for a device: ${String(argsJson?.method)} → ${answer.status}`);
					return answer;
				}
			}
		},
		pairingModes: []
	});
	await provider.start();
	return provider;
}

/**
 * The consumer on a device: the bridge's own node when it is connected and
 * proved, else which connected own devices serve the extension, and a fetch
 * that calls through either.
 *
 * @param {object} p
 * @param {any} p.libp2p the device-sync node
 * @param {() => string[]} p.devices the own devices connected now
 * @param {(peerId: string) => boolean} [p.isProved] the device gate's word on a peer (device-gate.js)
 * @param {string} [p.label]
 */
export async function startBridgeConsumer({
	libp2p,
	devices,
	isProved = () => true,
	label = 'Belege'
}) {
	const consumer = createConsumer({ libp2p, label });
	await consumer.start?.();

	/** The device found last, kept a minute while it stays connected. */
	/** @type {{ peerId: string, at: number } | null} */
	let last = null;

	/** A connected own device that serves the bridge, or null. */
	async function server() {
		const connected = devices();
		if (last && Date.now() - last.at < 60_000 && connected.includes(last.peerId))
			return last.peerId;
		last = null;
		for (const peerId of connected) {
			const found = await consumer.addProvider(peerId).catch(() => null);
			if (found?.extensions?.some((/** @type {any} */ e) => e.extensionId === EXTENSION)) {
				last = { peerId, at: Date.now() };
				return peerId;
			}
		}
		return null;
	}

	/** The bridge's own node, when the books know it and it is connected and proved on this run. */
	function streamServer() {
		const peerId = bridgeNode?.peerId;
		if (!peerId || !isProved(peerId)) return null;
		const open = libp2p
			.getConnections()
			.some((/** @type {any} */ c) => c.remotePeer.toString() === peerId && c.status === 'open');
		return open ? peerId : null;
	}

	/**
	 * One bridge call through a peer that serves the extension: the same
	 * Request in, a Response out.
	 *
	 * @param {string} peerId
	 * @param {string | URL | Request} input
	 * @param {RequestInit} [init]
	 */
	async function callThrough(peerId, input, init = {}) {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
		/** @type {any} */
		let answer;
		try {
			answer = await consumer.call(peerId, EXTENSION, 'request', {
				method: String(init.method ?? 'GET').toUpperCase(),
				path: `${url.pathname}${url.search}`,
				...(body !== undefined ? { body } : {})
			});
		} catch (error) {
			// The bridge said no to this device: an answer, not a way that failed –
			// no other way to the bridge may say yes instead (#579).
			const refusal = grantRefusal(error);
			if (!refusal) throw error;
			return new Response(JSON.stringify(refusal.json), {
				status: refusal.status,
				headers: { 'content-type': 'application/json' }
			});
		}
		const payload =
			answer.base64 !== undefined ? fromBase64(answer.base64) : JSON.stringify(answer.json ?? {});
		return new Response(payload, {
			status: answer.status,
			headers: { 'content-type': answer.contentType || 'application/json' }
		});
	}

	/**
	 * fetch, through a desktop that serves its bridge.
	 *
	 * @param {string | URL | Request} input
	 * @param {RequestInit} [init]
	 */
	async function remoteFetch(input, init = {}) {
		const peerId = await server();
		if (!peerId) throw new TypeError('no own device serves a bridge');
		return callThrough(peerId, input, init);
	}

	/**
	 * fetch, over the stream to the bridge's own node. `waitMs`: how long to
	 * wait for the node to be connected and proved – right after an unlock the
	 * first calls come before that, and a device paired by invitation only has
	 * no token to fall back to HTTP with.
	 *
	 * @param {string | URL | Request} input
	 * @param {RequestInit} [init]
	 * @param {{ waitMs?: number }} [options]
	 */
	async function streamFetch(input, init = {}, { waitMs = 0 } = {}) {
		if (!bridgeNode) throw new TypeError('no bridge node is known');
		const until = Date.now() + waitMs;
		let peerId = streamServer();
		while (!peerId && Date.now() < until) {
			await new Promise((r) => setTimeout(r, 250));
			peerId = streamServer();
		}
		if (!peerId) throw new TypeError('the bridge’s node is not connected');
		return callThrough(peerId, input, init);
	}

	/**
	 * Pair the bridge's node by its invitation and hand it its own key
	 * (bridge/src/node.js `handover`): from then on the bridge proves itself to
	 * the books' devices with it, as that one peer. The key goes once, over the
	 * Noise channel to the peer the invitation names; the books' device key
	 * never leaves the browser (database-keys.js deriveBridgeAuthBase).
	 *
	 * @param {object} p
	 * @param {string} p.invitation `web+ucep:pair?…`, as the bridge printed it
	 * @param {Uint8Array} p.authKey the bridge's own key of this generation (node.js `bridgeAuth`)
	 * @param {string[]} p.relays the relays the books use
	 * @param {string[]} p.devices the books' devices, this one included
	 * @returns {Promise<{ peerId: string, addrs: string[] }>} the bridge's node, and where it listens besides the relays
	 */
	async function pairBridge({ invitation, authKey, relays, devices: list }) {
		const inv = parseInvitation(invitation.trim());
		if (inv.extensionId !== EXTENSION) throw new UcepError('UNKNOWN_EXTENSION');
		await consumer.pairWithInvitation(invitation.trim());
		await consumer.call(inv.providerPeerId, EXTENSION, 'handover', {
			bridgeAuth: toBase64(authKey),
			relays: relays.slice(0, 16),
			devices: [...new Set(list)].slice(0, 64)
		});
		return {
			peerId: inv.providerPeerId,
			addrs: inv.addrs.filter((a) => !a.includes('/p2p-circuit'))
		};
	}

	/**
	 * The books' device list to the bridge's node, when it is connected: a
	 * device removed in the app is refused there too.
	 *
	 * @param {string[]} list peer ids
	 * @returns {Promise<boolean>} whether the bridge took it
	 */
	async function tellDevices(list) {
		const peerId = streamServer();
		if (!peerId) return false;
		await consumer.call(peerId, EXTENSION, 'devices', { devices: [...new Set(list)].slice(0, 64) });
		return true;
	}

	/**
	 * "Kopplung lösen": the bridge's node forgets its key and runs unarmed,
	 * printing a new invitation (bridge/src/node.js `unpair`).
	 *
	 * @returns {Promise<boolean>} whether the bridge was reached
	 */
	async function forgetBridge() {
		const peerId = streamServer();
		if (!peerId) return false;
		await consumer.call(peerId, EXTENSION, 'unpair', {});
		return true;
	}

	/**
	 * What each device may do with the bridge (bridge/src/node.js `grants`):
	 * the device that paired it sees every device's, another its own.
	 *
	 * @returns {Promise<{ holder: boolean, scopes: string[], devices: { peerId: string, scopes: string[], lastUsedAt: number | null, expiresAt: number | null }[] } | null>}
	 *   null: the bridge's node is not connected
	 */
	async function bridgeGrants() {
		const peerId = streamServer();
		if (!peerId) return null;
		return /** @type {any} */ (await consumer.call(peerId, EXTENSION, 'grants', {}));
	}

	/**
	 * Let a device whose access lapsed in again (bridge/src/node.js `renew`):
	 * only the device that paired the bridge may.
	 *
	 * @param {string} device peer id
	 */
	async function renewDevice(device) {
		const peerId = streamServer();
		if (!peerId) return false;
		await consumer.call(peerId, EXTENSION, 'renew', { peerId: device });
		return true;
	}

	return {
		consumer,
		forgetBridge,
		bridgeGrants,
		renewDevice,
		server,
		streamServer,
		remoteFetch,
		streamFetch,
		pairBridge,
		tellDevices,
		stop: () => consumer.stop?.()
	};
}

/**
 * What the bridge's node answers when a device may not make a call (bridge
 * grants.js, #579), as the HTTP answer the bridge client knows: a scope the
 * device does not hold, scopes that lapsed, or a limit on what costs. The
 * per-minute limit on the model is the 429 a provider's limit is
 * (`LLM_RATE_LIMIT`), so a run waits and goes on; the day's tokens stop it.
 *
 * @param {any} error
 * @returns {{ status: number, json: { error: string, code: string } } | null}
 */
export function grantRefusal(error) {
	if (!(error instanceof UcepError) && typeof error?.code !== 'string') return null;
	const reason = String(error.message ?? '');
	switch (error.code) {
		case 'SCOPE_MISSING':
			return { status: 403, json: { error: reason, code: 'BRIDGE_SCOPE_MISSING' } };
		case 'GRANT_EXPIRED':
			return { status: 403, json: { error: reason, code: 'BRIDGE_GRANT_EXPIRED' } };
		case 'RATE_LIMITED':
			if (reason === 'llm-per-minute') {
				return { status: 429, json: { error: reason, code: 'LLM_RATE_LIMIT' } };
			}
			if (reason === 'llm-tokens-per-day') {
				return { status: 403, json: { error: reason, code: 'BRIDGE_LLM_DAY' } };
			}
			if (reason === 'backup-per-hour') {
				return { status: 429, json: { error: reason, code: 'BRIDGE_BACKUP_HOUR' } };
			}
			return null;
		default:
			return null;
	}
}

/**
 * The bridge's own node first, over the stream, when `stream` has it; then the
 * bridge on this machine over HTTP; when that cannot be reached either (a
 * phone: no bridge, or a page that may not call 127.0.0.1), an own device's.
 * Pairing and unpairing over HTTP go to HTTP only.
 *
 * `onRoute` hears which way a call went: 'stream' to the bridge's node,
 * 'local' over HTTP here, or 'device' through an own device's bridge.
 *
 * A call without a token (a device paired by invitation only) waits a while
 * for the node: HTTP would only answer 401.
 *
 * @param {{ local?: typeof fetch, stream?: () => ((input: any, init?: RequestInit, options?: { waitMs?: number }) => Promise<Response>) | null, remote: () => ((input: any, init?: RequestInit) => Promise<Response>) | null, onRoute?: (route: 'stream' | 'local' | 'device') => void, waitMs?: number }} p
 * @returns {typeof fetch}
 */
export function bridgeFetch({
	local = fetch,
	stream = () => null,
	remote,
	onRoute = () => {},
	waitMs = STREAM_WAIT_MS
}) {
	return /** @type {typeof fetch} */ (
		async (input, init) => {
			// The token is HTTP's: a peer over the stream is known by its proof.
			const headers = { .../** @type {Record<string, string>} */ (init?.headers ?? {}) };
			const hasToken = Boolean(headers.Authorization);
			delete headers.Authorization;
			const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
			const over = HTTP_ONLY_PATH.test(path) ? null : stream();
			if (over) {
				try {
					const res = await over(input, { ...init, headers }, { waitMs: hasToken ? 0 : waitMs });
					onRoute('stream');
					return res;
				} catch {
					// Not connected, or the answer too big for the stream: HTTP, when there is one.
				}
			}
			try {
				const res = await local(input, init);
				onRoute('local');
				return res;
			} catch (error) {
				const through = remote();
				if (!through) throw error;
				const res = await through(input, { ...init, headers });
				onRoute('device');
				return res;
			}
		}
	);
}
