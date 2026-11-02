// "Wer hält es?" – which IPFS nodes offer a backup, and where they are.
//
// Asked only on a click, from three public services, each named on the card:
//   1. IPFS delegated routing (`/routing/v1/providers/<cid>`, through Helia's
//      client `@helia/delegated-routing-v1-http-api-client`): the peers that
//      announce the backup's CID, with their addresses. It sees the CID and
//      this computer's IP address. The client is used on its own here, not
//      wired into this browser's Helia node: there it would be asked for every
//      block the app looks up.
//   2. Aleph's `corechannel` aggregate: Aleph's core channel nodes with their
//      names and addresses, to name the peers that are Aleph's (by IP).
//   3. ipwho.is: the country, city and network of each peer's IP. It sees
//      those IPs (Aleph's servers, not yours) and this computer's IP address.
// A service that does not answer leaves its part empty; the rest still shows.

import { CID } from 'multiformats/cid';

/** The account whose `corechannel` aggregate lists Aleph's nodes. */
export const ALEPH_NODES_ACCOUNT = '0xa1B3bb7d2332383D96b7796B908fB7f7F3c2Be10';
const ROUTING = 'https://delegated-ipfs.dev';
const GEO = 'https://ipwho.is';
/** At most this many peers are listed and located. */
export const MAX_HOLDERS = 40;

/** In E2E builds only: the fake Aleph on 127.0.0.1 answers routing and places too. */
export const E2E_HOLDERS_URL_KEY = 'belege.e2e.alephUrl';

/**
 * @typedef {object} Holder
 * @property {string} peerId
 * @property {string[]} ips public addresses it announces
 * @property {string | null} aleph the Aleph core channel node's name, by IP; null when none
 * @property {{ country: string, countryCode: string, city: string, network: string } | null} place
 */

/**
 * Where to ask. In E2E builds only, the fake Aleph on 127.0.0.1 – the one the
 * test's bridge names, or the one a test put in localStorage – answers all.
 *
 * @param {string} [apiHost] the Aleph API in use
 * @returns {{ routing: string, geo: string }}
 */
export function holderEndpoints(apiHost) {
	// Written inline so every other build drops it.
	if (import.meta.env.VITE_E2E === 'true') {
		const base =
			globalThis.localStorage?.getItem(E2E_HOLDERS_URL_KEY) ??
			(apiHost?.startsWith('http://127.0.0.1:') ? apiHost : null);
		if (base) return { routing: base, geo: `${base}/geo` };
	}
	return { routing: ROUTING, geo: GEO };
}

/** Addresses no one outside can reach say nothing about where a backup lies. */
const isPublic = (/** @type {string} */ ip) =>
	!/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80:)/i.test(ip);

/**
 * The public IPs in a peer's multiaddrs.
 *
 * @param {Array<{ toString(): string } | string>} addrs
 */
export function publicIps(addrs) {
	/** @type {string[]} */
	const ips = [];
	for (const addr of addrs) {
		const m = /^\/ip[46]\/([^/]+)/.exec(String(addr));
		if (m && isPublic(m[1]) && !ips.includes(m[1])) ips.push(m[1]);
	}
	return ips;
}

/** A logger that says nothing: the client wants one. */
const quiet = () => Object.assign(() => {}, { error() {}, trace() {}, enabled: false });
const logger = { forComponent: quiet };

/**
 * The peers that announce a CID, through Helia's delegated routing client.
 *
 * @param {string} cid
 * @param {{ url: string, limit?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ peerId: string, addrs: string[] }[]>}
 */
export async function routingProviders(cid, { url, limit = MAX_HOLDERS, signal }) {
	const { delegatedRoutingV1HttpApiClient } = await import(
		'@helia/delegated-routing-v1-http-api-client'
	);
	const client = delegatedRoutingV1HttpApiClient({ url, cacheTTL: 0, timeout: 30_000 })({
		logger: /** @type {any} */ (logger)
	});
	/** @type {{ peerId: string, addrs: string[] }[]} */
	const found = [];
	try {
		for await (const record of client.getProviders(CID.parse(cid), signal ? { signal } : {})) {
			found.push({ peerId: String(record.ID), addrs: record.Addrs.map(String) });
			if (found.length >= limit) break;
		}
	} finally {
		await /** @type {any} */ (client).stop?.();
	}
	return found;
}

/**
 * Aleph's core channel nodes by IP: their names, and how many are active.
 *
 * @param {{ apiHost: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ byIp: Map<string, string>, active: number }>}
 */
export async function alephNodes({ apiHost, fetch: f = fetch }) {
	const response = await f(
		`${apiHost}/api/v0/aggregates/${ALEPH_NODES_ACCOUNT}.json?keys=corechannel`
	);
	if (!response.ok) throw new Error(`Aleph did not list its nodes: ${response.status}`);
	const body = /** @type {any} */ (await response.json());
	const nodes = Array.isArray(body?.data?.corechannel?.nodes) ? body.data.corechannel.nodes : [];
	/** @type {Map<string, string>} */
	const byIp = new Map();
	let active = 0;
	for (const node of nodes) {
		if (node?.status === 'active') active++;
		const m = /^\/ip[46]\/([^/]+)/.exec(String(node?.multiaddress ?? ''));
		if (m) byIp.set(m[1], String(node?.name ?? '').trim() || m[1]);
	}
	return { byIp, active };
}

/**
 * Where an IP is, as ipwho.is says.
 *
 * @param {string} ip
 * @param {{ url: string, fetch?: typeof fetch }} options
 * @returns {Promise<Holder['place']>}
 */
export async function placeOf(ip, { url, fetch: f = fetch }) {
	const response = await f(`${url}/${encodeURIComponent(ip)}`);
	if (!response.ok) return null;
	const body = /** @type {any} */ (await response.json().catch(() => null));
	if (!body || body.success === false) return null;
	return {
		country: String(body.country ?? ''),
		countryCode: String(body.country_code ?? ''),
		city: String(body.city ?? ''),
		network: String(body.connection?.org ?? body.connection?.isp ?? '')
	};
}

/**
 * How many holders each network or country has, most first: eight nodes at
 * one hoster are less spread than eight nodes say.
 *
 * @param {Holder[]} holders
 * @param {'network' | 'country'} by
 * @returns {{ name: string, count: number }[]}
 */
export function spread(holders, by) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const h of holders) {
		const name = h.place?.[by];
		if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Who holds a backup: the peers announcing its CID, named where they are
 * Aleph's nodes, and placed.
 *
 * @param {object} params
 * @param {string} params.cid
 * @param {string} params.apiHost Aleph's API
 * @param {{ routing: string, geo: string }} [params.endpoints]
 * @param {typeof routingProviders} [params.providers]
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<{ holders: Holder[], alephActive: number | null, placed: boolean }>}
 */
export async function whoHolds({
	cid,
	apiHost,
	endpoints = holderEndpoints(apiHost),
	providers = routingProviders,
	fetch: f = fetch
}) {
	const [peers, nodes] = await Promise.all([
		providers(cid, { url: endpoints.routing }),
		alephNodes({ apiHost, fetch: f }).catch(() => null)
	]);
	const ips = [...new Set(peers.flatMap((p) => publicIps(p.addrs)))];
	/** @type {Map<string, Holder['place']>} */
	const places = new Map();
	await Promise.all(
		ips.map(async (ip) =>
			places.set(ip, await placeOf(ip, { url: endpoints.geo, fetch: f }).catch(() => null))
		)
	);
	const holders = peers.map((p) => {
		const own = publicIps(p.addrs);
		const named = own.map((ip) => nodes?.byIp.get(ip)).find(Boolean) ?? null;
		const place = own.map((ip) => places.get(ip)).find(Boolean) ?? null;
		return { peerId: p.peerId, ips: own, aleph: named, place };
	});
	return {
		holders,
		alephActive: nodes ? nodes.active : null,
		placed: [...places.values()].some(Boolean)
	};
}
