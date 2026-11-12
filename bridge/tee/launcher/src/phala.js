// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phala Cloud's API, as far as the launcher needs it: provision the bridge's
// compose, create the VM from it with the browser's encrypted env, delete it,
// and fetch the collateral a quote is verified with. The API key never leaves
// this module and is never logged.

export const API = 'https://cloud-api.phala.com/api/v1';
/** Phala's quote verifier; the NEAR Shade Agent SDK fetches collateral from it too. */
export const VERIFY = 'https://cloud-api.phala.network/api/v1/attestations/verify';

const printable = (/** @type {unknown} */ v, /** @type {number} */ max) =>
	String(v ?? '')
		.replace(/[^\x20-\x7e]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);

/**
 * Why Phala refused, for the operator's log: its error code, its message and
 * the fields it names (`kms_id=…`), never our request. A bare status said
 * nothing when a KMS stopped answering (`ERR-02-009`); this does.
 *
 * @param {Response} res
 */
export async function phalaReason(res) {
	const text = await res.text().catch(() => '');
	/** @type {any} */
	let d = null;
	try {
		d = JSON.parse(text);
	} catch {
		// not JSON: a proxy's page, say
	}
	if (!d || typeof d !== 'object') {
		const t = printable(text.replace(/<[^>]*>/g, ' '), 160);
		return t ? ` (${t})` : '';
	}
	const code = /^[A-Z0-9-]{1,32}$/.test(String(d.error_code)) ? String(d.error_code) : '';
	const said = d.message ?? d.detail ?? d.error;
	// FastAPI's 422: [{ loc: ['body', 'image'], msg: '…' }, …]
	const message = printable(
		Array.isArray(said)
			? said
					.slice(0, 3)
					.map((/** @type {any} */ x) =>
						[Array.isArray(x?.loc) ? x.loc.join('.') : '', x?.msg].filter(Boolean).join(': ')
					)
					.join('; ')
			: typeof said === 'string'
				? said
				: '',
		240
	);
	const fields = (Array.isArray(d.details) ? d.details : [])
		.filter(
			(/** @type {any} */ x) =>
				typeof x?.field === 'string' &&
				typeof x?.value === 'string' &&
				/^[a-z_]{1,32}$/.test(x.field) &&
				/^[\w.:-]{1,64}$/.test(x.value)
		)
		.slice(0, 3)
		.map((/** @type {any} */ x) => `${x.field}=${x.value}`);
	const parts = [code, message, ...fields].filter(Boolean);
	return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * @param {{ apiKey: string, fetchImpl?: typeof fetch }} o
 */
export function phalaClient({ apiKey, fetchImpl = fetch }) {
	if (!apiKey) throw new Error('no Phala API key');
	/** @param {string} path @param {any} [body] @param {string} [method] */
	async function call(path, body, method = body ? 'POST' : 'GET') {
		const res = await fetchImpl(`${API}${path}`, {
			method,
			headers: {
				'X-API-Key': apiKey,
				'user-agent': 'belege-bridge-launcher',
				...(body ? { 'content-type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined,
			redirect: 'error'
		});
		if (!res.ok)
			throw new Error(
				`Phala ${method} ${path.split('/').slice(0, 3).join('/')}: HTTP ${res.status}` +
					(await phalaReason(res))
			);
		return res.status === 204 ? null : res.json();
	}
	return {
		/** @param {any} body the provision request (provision.mjs's provisionBody) */
		async provision(body) {
			const d = await call('/cvms/provision', body);
			const kms = String(d.kms_info?.slug ?? '');
			if (!/^[a-z0-9-]{1,64}$/.test(kms) || !/^[0-9a-f]{40}$/.test(String(d.app_id)))
				throw new Error('Phala provision: no KMS or app id');
			// The KMS's signature over the env key, so the browser need not take
			// the key on the launcher's word (env-key.js on the start page).
			const k = await call(`/kms/${kms}/pubkey/${d.app_id}`);
			if (k?.public_key !== d.app_env_encrypt_pubkey)
				throw new Error('Phala: the KMS names another env key');
			return {
				appId: d.app_id,
				composeHash: d.compose_hash,
				envPublicKey: d.app_env_encrypt_pubkey,
				kms,
				envKeySignature: String(k.signature ?? '')
			};
		},
		/** @param {{ appId: string, composeHash: string, encryptedEnv: string }} o */
		async create({ appId, composeHash, encryptedEnv }) {
			const d = await call('/cvms', {
				app_id: appId,
				compose_hash: composeHash,
				encrypted_env: encryptedEnv
			});
			return { id: d.id, status: d.status };
		},
		/** @param {string} id */
		async remove(id) {
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('not a VM id');
			await call(`/cvms/${id}`, undefined, 'DELETE');
		},
		/**
		 * The collateral for a quote, as the contract's `DstackAttestation` takes it.
		 *
		 * @param {string} quoteHex
		 */
		async collateral(quoteHex) {
			const form = new FormData();
			form.append('hex', quoteHex.replace(/^0x/, ''));
			const res = await fetchImpl(VERIFY, { method: 'POST', body: form, redirect: 'error' });
			if (!res.ok) throw new Error(`Phala verify: HTTP ${res.status}`);
			const c = (await res.json()).quote_collateral;
			if (!c) throw new Error('Phala verify: no collateral');
			return {
				pck_crl_issuer_chain: c.pck_crl_issuer_chain || '',
				root_ca_crl: c.root_ca_crl || '',
				pck_crl: c.pck_crl || '',
				tcb_info_issuer_chain: c.tcb_info_issuer_chain || '',
				tcb_info: c.tcb_info || '',
				tcb_info_signature: c.tcb_info_signature || '',
				qe_identity_issuer_chain: c.qe_identity_issuer_chain || '',
				qe_identity: c.qe_identity || '',
				qe_identity_signature: c.qe_identity_signature || ''
			};
		}
	};
}
