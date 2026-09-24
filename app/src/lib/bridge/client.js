// The app's side of the bridge on 127.0.0.1 (see bridge/README.md).

export const DEFAULT_BRIDGE_URL = import.meta.env?.VITE_BRIDGE_URL || 'http://127.0.0.1:8765';

export class BridgeError extends Error {
	/** @param {string} message @param {number} status */
	constructor(message, status) {
		super(message);
		this.name = 'BridgeError';
		this.status = status;
	}
}

/**
 * @typedef {object} BridgeAccount
 * @property {string} id
 * @property {string} ibanMasked
 * @property {string} ibanLast4
 * @property {string} name
 * @property {string} currency
 * @property {number | null} balanceCents
 * @property {string | null} balanceDate
 */

/**
 * @param {{ url?: string, token?: string | null, fetch?: typeof fetch }} [options]
 */
export function createBridgeClient({
	url = DEFAULT_BRIDGE_URL,
	token = null,
	fetch: f = fetch
} = {}) {
	const base = url.replace(/\/+$/, '');

	/** @param {string} path @param {RequestInit} [init] */
	async function call(path, init = {}) {
		let res;
		try {
			res = await f(`${base}${path}`, {
				...init,
				headers: {
					...(init.body ? { 'Content-Type': 'application/json' } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					...(init.headers ?? {})
				},
				cache: 'no-store',
				credentials: 'omit'
			});
		} catch {
			throw new BridgeError(
				'Die Bridge ist nicht erreichbar (läuft sie, und ist diese Adresse in appOrigins erlaubt?).',
				0
			);
		}
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			const messages = /** @type {Record<number, string>} */ ({
				401: 'Die Bridge kennt dieses Gerät nicht (neu koppeln).',
				403:
					body?.error === 'origin not allowed'
						? 'Diese App-Adresse ist in der Bridge nicht erlaubt.'
						: 'Falscher Kopplungscode.',
				410: 'Kein Kopplungscode aktiv: Bridge mit --pair neu starten.'
			});
			throw new BridgeError(
				messages[res.status] ?? body?.error ?? `Bridge: HTTP ${res.status}`,
				res.status
			);
		}
		return body;
	}

	return {
		url: base,
		/** @returns {Promise<{ ok: boolean, paired: boolean, pairingOpen: boolean, hibiscus: { configured: boolean } }>} */
		health: () => call('/health'),
		/** @param {string} code @returns {Promise<string>} the token */
		async pair(code) {
			const { token } = await call('/pair', { method: 'POST', body: JSON.stringify({ code }) });
			return token;
		},
		/** @returns {Promise<BridgeAccount[]>} */
		async accounts() {
			return (await call('/hibiscus/accounts')).accounts;
		},
		/**
		 * @param {string} accountId
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<import('../bank/import.js').IncomingTransaction[]>}
		 */
		async transactions(accountId, since) {
			const q = new URLSearchParams({ account: accountId, since });
			return (await call(`/hibiscus/transactions?${q}`)).transactions;
		}
	};
}

/** @typedef {ReturnType<typeof createBridgeClient>} BridgeClient */
