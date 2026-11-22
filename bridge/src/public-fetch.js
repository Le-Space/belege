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
//
// And an answer is read up to a limit (`maxBytes`, 32 MiB by default): a host
// that sends more – by its Content-Length, or as the bytes arrive – has the
// read fail, so no named host can fill the bridge's memory.
import { lookup as dnsLookup } from 'node:dns/promises';

import { isPrivateAddress } from '@le-space/chains/http';

/** What one answer may be at most, unless the caller says otherwise. */
export const MAX_ANSWER_BYTES = 32 * 1024 * 1024;

/** The error a read over the limit fails with. */
const tooLarge = () =>
	Object.assign(new Error('the answer is larger than allowed'), { code: 'ANSWER_TOO_LARGE' });

/**
 * The same response, its body cut off with an error once it passes `max` bytes.
 *
 * @param {Response} res
 * @param {number} max
 * @returns {Response}
 */
function capped(res, max) {
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > max) {
		res.body?.cancel().catch(() => {});
		throw tooLarge();
	}
	if (!res.body) return res;
	let seen = 0;
	const counted = res.body.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > max) controller.error(tooLarge());
				else controller.enqueue(chunk);
			}
		})
	);
	return new Response(counted, {
		status: res.status,
		statusText: res.statusText,
		headers: res.headers
	});
}

/** @param {string} hostname */
const isAddress = (hostname) =>
	hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

/**
 * @param {typeof fetch} f
 * @param {object} [options]
 * @param {(hostname: string, options: { all: true }) => Promise<{ address: string }[]>} [options.lookup]
 * @param {boolean} [options.allowLoopback] tests: `127.0.0.1` and `localhost` are let through
 * @param {number} [options.maxBytes] the most one answer may be
 * @returns {typeof fetch}
 */
export function publicOnlyFetch(
	f,
	{ lookup = dnsLookup, allowLoopback = false, maxBytes = MAX_ANSWER_BYTES } = {}
) {
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
		return capped(await f(input, init), maxBytes);
	};
}
