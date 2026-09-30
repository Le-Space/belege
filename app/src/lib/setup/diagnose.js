// Why the bridge does not answer (issue #200), in the words a person can act on
// instead of "nicht erreichbar":
//
//   online       it answers this page
//   origin       it runs, but refuses this page: its address is not in the
//                bridge's appOrigins (a request without CORS gets through,
//                one with CORS does not)
//   mixed        an https page may not ask a plain-http address other than
//                this computer's own (127.0.0.1, localhost)
//   bad-url      the address is no http(s) URL
//   unreachable  nothing answers there: not started, another port, or the
//                browser blocks it
//
// The fetch is passed in, so a test decides what the network does.

/** @typedef {'online' | 'origin' | 'mixed' | 'bad-url' | 'unreachable'} BridgeDiagnosis */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * @param {string} url the bridge's address
 * @param {object} [env]
 * @param {typeof fetch} [env.fetch]
 * @param {string} [env.pageOrigin] this page's origin
 * @param {number} [env.timeoutMs]
 * @returns {Promise<BridgeDiagnosis>}
 */
export async function diagnoseBridge(
	url,
	{
		fetch = globalThis.fetch,
		pageOrigin = typeof location === 'undefined' ? '' : location.origin,
		timeoutMs = 3000
	} = {}
) {
	/** @type {URL} */
	let target;
	try {
		target = new URL(url);
	} catch {
		return 'bad-url';
	}
	if (target.protocol !== 'http:' && target.protocol !== 'https:') return 'bad-url';
	if (
		pageOrigin.startsWith('https:') &&
		target.protocol === 'http:' &&
		!LOOPBACK.has(target.hostname)
	) {
		return 'mixed';
	}
	const health = new URL('/health', target).href;
	/** @param {RequestInit} init */
	const ask = (init) => fetch(health, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	try {
		// Any answer with this page in its CORS headers: the bridge runs and lets it in.
		await ask({ mode: 'cors' });
		return 'online';
	} catch {
		// Refused, or answered without this page in its CORS headers: ask again without CORS.
	}
	try {
		await ask({ mode: 'no-cors' });
		return 'origin';
	} catch {
		return 'unreachable';
	}
}

/**
 * The commands that start the bridge, for the terminal.
 *
 * @returns {string[]}
 */
export const bridgeCommands = () => [
	'git clone https://github.com/Le-Space/belege.git',
	'cd belege',
	'pnpm install',
	'pnpm bridge'
];
