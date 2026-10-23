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

/** The one code every failed proof ends in. */
export const ATTESTATION_FAILED = 'LLM_ATTESTATION_FAILED';

/** @typedef {{ provider: 'libertai', itemHash: string, measurement: string, sourceCommit: string | null, pinnedAt: string }} TeePin */

/** @param {string} message @param {unknown} [cause] */
function refused(message, cause) {
	return Object.assign(new Error(`The model's enclave could not be verified: ${message}`), {
		code: ATTESTATION_FAILED,
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
 * @param {() => Date} [p.now]
 */
export function createConfidentialFetch({
	pin,
	baseUrl,
	connect = libertaiConnect,
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
			state.error = error.message;
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
			throw error;
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
