// A fetch for hosts a caller may name (a chain node, an indexer, an API of
// the person's own): it reaches the public internet and nothing else.
//
// `checkEndpoint` (@le-space/chains) refuses a URL whose host is written as a
// private or local one. A name can still resolve to such an address, so the
// name is resolved here, right before the request, and the request is not
// made when any of its addresses is this machine, a private or link-local
// network, or the like (AGENTS.md, "Bridge": no private addresses).
//
// The answer is the same as for a host that is down: the caller learns
// nothing about what is behind a name.
import { lookup as dnsLookup } from 'node:dns/promises';

import { isPrivateAddress } from '@le-space/chains/http';

/** @param {string} hostname */
const isAddress = (hostname) =>
	hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

/**
 * @param {typeof fetch} f
 * @param {object} [options]
 * @param {(hostname: string, options: { all: true }) => Promise<{ address: string }[]>} [options.lookup]
 * @param {boolean} [options.allowLoopback] tests: `127.0.0.1` and `localhost` are let through
 * @returns {typeof fetch}
 */
export function publicOnlyFetch(f, { lookup = dnsLookup, allowLoopback = false } = {}) {
	return async function publicFetch(input, init) {
		const url = new URL(
			typeof input === 'string' || input instanceof URL ? input : /** @type {Request} */ (input).url
		);
		const host = url.hostname;
		const loopback = host === '127.0.0.1' || host === 'localhost';
		if (!(allowLoopback && loopback)) {
			/** @type {string[]} */
			let addresses;
			if (isAddress(host)) {
				addresses = [host];
			} else {
				// A name that does not resolve: let the request fail as it would.
				addresses = await lookup(host, { all: true }).then(
					(found) => found.map((a) => a.address),
					() => []
				);
			}
			if (addresses.some(isPrivateAddress)) {
				throw Object.assign(new TypeError('fetch failed'), { code: 'NOT_PUBLIC' });
			}
		}
		return f(input, init);
	};
}
