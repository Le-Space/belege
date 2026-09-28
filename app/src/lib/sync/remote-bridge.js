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
// On the other device, `bridgeFetch` stands in for fetch in the bridge
// client (bridge/client.js): the bridge on this machine first, and when it
// cannot be reached, a connected own device that serves the extension.
//
// UCEP's limits hold: a request up to 64 KiB, an answer up to 1 MiB over a
// direct connection (64 KiB while relayed), 60 s to answer.

import { UcepError, createConsumer, createProvider } from '@le-space/ucep';

export const EXTENSION = 'belege-bridge';
export const SHARE_FLAG_KEY = 'belege.bridge-share';

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
			name: 'Belege-Bridge für eigene Geräte',
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
 * The consumer on another device: which connected own devices serve the
 * extension, and a fetch that calls through one of them.
 *
 * @param {object} p
 * @param {any} p.libp2p the device-sync node
 * @param {() => string[]} p.devices the own devices connected now
 * @param {string} [p.label]
 */
export async function startBridgeConsumer({ libp2p, devices, label = 'Belege' }) {
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

	/**
	 * fetch, through a desktop: the same Request in, a Response out.
	 *
	 * @param {string | URL | Request} input
	 * @param {RequestInit} [init]
	 */
	async function remoteFetch(input, init = {}) {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const peerId = await server();
		if (!peerId) throw new TypeError('no own device serves a bridge');
		const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
		/** @type {any} */
		const answer = await consumer.call(peerId, EXTENSION, 'request', {
			method: String(init.method ?? 'GET').toUpperCase(),
			path: `${url.pathname}${url.search}`,
			...(body !== undefined ? { body } : {})
		});
		const payload =
			answer.base64 !== undefined ? fromBase64(answer.base64) : JSON.stringify(answer.json ?? {});
		return new Response(payload, {
			status: answer.status,
			headers: { 'content-type': answer.contentType || 'application/json' }
		});
	}

	return { consumer, server, remoteFetch, stop: () => consumer.stop?.() };
}

/**
 * The bridge on this machine first; when it cannot be reached (a phone: no
 * bridge, or a page that may not call 127.0.0.1), an own device's.
 *
 * @param {{ local?: typeof fetch, remote: () => ((input: any, init?: RequestInit) => Promise<Response>) | null }} p
 * @returns {typeof fetch}
 */
export function bridgeFetch({ local = fetch, remote }) {
	return /** @type {typeof fetch} */ (
		async (input, init) => {
			try {
				return await local(input, init);
			} catch (error) {
				const through = remote();
				if (!through) throw error;
				// The own device's bridge answers with the desktop's token; this one's stays here.
				const headers = { .../** @type {Record<string, string>} */ (init?.headers ?? {}) };
				delete headers.Authorization;
				return through(input, { ...init, headers });
			}
		}
	);
}
