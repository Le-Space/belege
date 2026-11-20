// LibertAI confidential inference (#416): the model runs in an AMD SEV-SNP
// confidential VM with a GPU in confidential mode, and the bridge proves that
// before any text goes to it – the AMD signature chain, that the report binds
// the TLS key served, that the launch measurement is the pinned one, that the
// guest cannot be debugged (`@libertai/confidential-inference`). The TLS
// session ends inside the enclave: api.libertai.io, whose TLS ends at
// LibertAI's gateway, is never used for a request.
//
// setup:llm pins a deployment (its item hash and measurement, `config.llm.tee`).
// A replaced deployment is not followed: the pin no longer answers, every
// request fails with LLM_ATTESTATION_FAILED, and setup:llm re-pins once the
// person confirms. There is no fallback to the gateway.
//
// An enclave that cannot be reached is not a failed proof: the node maps the
// enclave's port to a high port of its own, and a network that blocks such
// ports (a VPN exit, a firewall) looks the same as an enclave that is gone.
// So the bridge looks for itself (`reachOf`): does the node answer on 443
// while the enclave's port does not? The error then says which.

import net from 'node:net';

/** An IPv4 address on the internet: not this machine, not a private or link-local network. @param {string} ip */
function isPublicIPv4(ip) {
	if (net.isIP(ip) !== 4) return false;
	const [a, b] = ip.split('.').map(Number);
	return !(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

/** The one code every failed proof ends in. */
export const ATTESTATION_FAILED = 'LLM_ATTESTATION_FAILED';

/** The enclave's address did not take a connection: the network, not the proof. */
export const ENCLAVE_UNREACHABLE = 'LLM_ENCLAVE_UNREACHABLE';

/**
 * Why the enclave was not reached, as far as the bridge can tell:
 *   port     its port takes no connection, the node answers on 443 – most
 *            often a network that blocks the port, else the enclave restarting
 *   host     the node does not answer on 443 either
 *   unknown  no cross-check possible (an address of the enclave's own, say)
 *
 * @typedef {{ kind: 'port' | 'host' | 'unknown', port: number | null, code: string }} Reach
 */

/**
 * One TCP connection, nothing sent: null when it opens, else why not.
 *
 * @param {string} host @param {number} port @param {number} [ms]
 * @returns {Promise<string | null>}
 */
export function tcpProbe(host, port, ms = 3000) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const done = (/** @type {string | null} */ code) => {
			socket.destroy();
			resolve(code);
		};
		socket.setTimeout(ms, () => done('ETIMEDOUT'));
		socket.once('connect', () => done(null));
		socket.once('error', (/** @type {any} */ e) => done(String(e?.code ?? 'ECONNFAILED')));
	});
}

/** The first `code` down an error's causes (undici: `fetch failed`, the cause says why). @param {any} error */
function networkCode(error) {
	for (let e = error, i = 0; e && i < 5; e = e.cause, i++) {
		if (typeof e.code === 'string' && /^E[A-Z_]+$/.test(e.code)) return e.code;
		if (/did not answer in time/.test(String(e.message))) return 'ETIMEDOUT';
	}
	return null;
}

/**
 * What the bridge finds when it looks itself: the enclave's port, then the
 * node's 443. Only for a public IPv4 address with a mapped port – that is
 * where a node answers on 443 at all.
 *
 * @param {string} origin `https://host:port` of the enclave
 * @param {{ code?: string | null, probe?: typeof tcpProbe }} [deps]
 * @returns {Promise<Reach>}
 */
export async function reachOf(origin, { code = null, probe = tcpProbe } = {}) {
	let url;
	try {
		url = new URL(origin);
	} catch {
		return { kind: 'unknown', port: null, code: code ?? 'unknown' };
	}
	const host = url.hostname;
	const port = Number(url.port) || 443;
	const checkable = isPublicIPv4(host) && port !== 443;
	if (!checkable) return { kind: 'unknown', port, code: code ?? 'unknown' };
	const why = code ?? (await probe(host, port));
	// It answers now: whatever it was, it was not the port.
	if (!why) return { kind: 'unknown', port, code: 'unknown' };
	return { kind: (await probe(host, 443)) === null ? 'port' : 'host', port, code: why };
}

/** A reach, said for the log and the error. @param {Reach} r */
export function reachMessage(r) {
	const at = r.port ? ` on port ${r.port}` : '';
	if (r.kind === 'port') {
		return `the model's enclave takes no connection${at} (${r.code}) while its node answers on 443: this network probably blocks the port (VPN, firewall), or the enclave is restarting`;
	}
	if (r.kind === 'host') {
		return `the node of the model's enclave does not answer, neither${at} (${r.code}) nor on 443: no way to it from this network, or the node is down`;
	}
	return `the model's enclave takes no connection${at} (${r.code})`;
}

/**
 * The addresses a failed `connect` names, when every one of them only failed
 * to connect – none failed its proof, the deployment itself was found.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function unreachedOrigins(message) {
	const lines = String(message)
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(1);
	/** @type {string[]} */
	const origins = [];
	for (const line of lines) {
		const m = /^(https:\/\/\S+?): (fetch failed|.* did not answer in time)$/.exec(line);
		if (!m) return [];
		origins.push(m[1]);
	}
	return origins;
}

/** @typedef {{ provider: 'libertai', itemHash: string, measurement: string, sourceCommit: string | null, pinnedAt: string }} TeePin */

/** @param {string} message @param {unknown} [cause] */
function refused(message, cause) {
	return Object.assign(new Error(`The model's enclave could not be verified: ${message}`), {
		code: ATTESTATION_FAILED,
		...(cause ? { cause } : {})
	});
}

/** @param {Reach} reach @param {unknown} [cause] */
function unreachable(reach, cause) {
	return Object.assign(new Error(reachMessage(reach)), {
		code: ENCLAVE_UNREACHABLE,
		reach,
		...(cause ? { cause } : {})
	});
}

/** The library's connect, loaded only when a TEE is set up. */
async function libertaiConnect(/** @type {any} */ opts) {
	const { connect } = await import('@libertai/confidential-inference');
	return connect(opts);
}

/**
 * A fetch that reaches only the pinned enclave, attested. It takes requests
 * addressed to the configured base URL (`https://api.libertai.io/v1/…`) and
 * sends them, path and all, to the enclave instead.
 *
 * @param {object} p
 * @param {TeePin} p.pin
 * @param {string} p.baseUrl the configured one, which requests are addressed to
 * @param {typeof libertaiConnect} [p.connect]
 * @param {typeof tcpProbe} [p.probe] how the bridge looks at an address that did not answer
 * @param {() => Date} [p.now]
 */
export function createConfidentialFetch({
	pin,
	baseUrl,
	connect = libertaiConnect,
	probe = tcpProbe,
	now = () => new Date()
}) {
	const base = baseUrl.replace(/\/+$/, '');
	/** @type {Promise<any> | null} */
	let endpoint = null;
	/** @type {{ verifiedAt: string | null, error: string | null, baseURL: string | null }} */
	const state = { verifiedAt: null, error: null, baseURL: null };

	async function attested() {
		endpoint ??= (async () => {
			let found;
			try {
				found = await connect({ itemHash: pin.itemHash, signal: AbortSignal.timeout(60_000) });
			} catch (/** @type {any} */ error) {
				// Found, but no address took a connection: the network, not the proof.
				const origins = unreachedOrigins(error?.message);
				if (origins.length) {
					const origin = origins.find((o) => net.isIP(new URL(o).hostname) === 4) ?? origins[0];
					throw unreachable(await reachOf(origin, { probe }), error);
				}
				throw refused(String(error?.message ?? error).slice(0, 200), error);
			}
			if (found.measurement !== pin.measurement) {
				throw refused(
					'its measurement is not the pinned one – run `pnpm setup:llm` to look and re-pin'
				);
			}
			state.verifiedAt = now().toISOString();
			state.baseURL = found.baseURL;
			state.error = null;
			return found;
		})().catch((error) => {
			// The next request tries again; this one fails, with no fallback.
			endpoint = null;
			// Not reached is not "the proof failed": the status keeps what it said.
			if (error.code !== ENCLAVE_UNREACHABLE) state.error = error.message;
			throw error;
		});
		return endpoint;
	}

	/** @type {typeof fetch} */
	async function confidentialFetch(input, init) {
		const url = String(input instanceof Request ? input.url : input);
		if (!url.startsWith(`${base}/`)) throw refused(`not addressed to ${base}: ${url.slice(0, 80)}`);
		const tee = await attested();
		const target = `${tee.baseURL.replace(/\/+$/, '')}/${url.slice(base.length + 1)}`;
		try {
			return await tee.fetch(target, init);
		} catch (/** @type {any} */ error) {
			// A new connection is proved again; one that fails its proof says so.
			if (error?.name === 'AttestationError' || /attest/i.test(String(error?.message))) {
				endpoint = null;
				state.error = String(error.message).slice(0, 200);
				throw refused(state.error, error);
			}
			// The request's own deadline: this text took too long, the enclave is there.
			if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
			const code = networkCode(error);
			if (!code) throw error;
			// The node may have given the enclave another port: look it up afresh next time.
			endpoint = null;
			throw unreachable(await reachOf(tee.baseURL, { code, probe }), error);
		}
	}

	return {
		fetch: confidentialFetch,
		/** What `/llm/status` shows: the pin, and how the last proof went. */
		status: () => ({
			provider: pin.provider,
			itemHash: pin.itemHash,
			measurement: pin.measurement,
			sourceCommit: pin.sourceCommit,
			pinnedAt: pin.pinnedAt,
			verifiedAt: state.verifiedAt,
			error: state.error
		})
	};
}

/**
 * The deployment a model has now, proved: what setup:llm shows before it pins.
 *
 * @param {string} model
 * @param {{ connect?: typeof libertaiConnect, now?: () => Date }} [deps]
 * @returns {Promise<TeePin>}
 */
export async function findDeployment(
	model,
	{ connect = libertaiConnect, now = () => new Date() } = {}
) {
	let found;
	try {
		found = await connect({ model, signal: AbortSignal.timeout(60_000) });
	} catch (/** @type {any} */ error) {
		throw refused(String(error?.message ?? error).slice(0, 200), error);
	}
	return {
		provider: 'libertai',
		itemHash: found.itemHash,
		measurement: found.measurement,
		sourceCommit: found.sourceCommit ?? null,
		pinnedAt: now().toISOString()
	};
}
