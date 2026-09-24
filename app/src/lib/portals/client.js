// The app's side of the bridge's customer portals (bridge/README.md
// "Kundenportale"). Kept apart from bridge/client.js on purpose: the same
// bearer token and error handling, its own endpoints.

import { BridgeError } from '../bridge/client.js';
import { t } from '../i18n/index.js';

/**
 * @typedef {object} PortalInfo
 * @property {string} id
 * @property {string} name
 * @property {string} recipeVersion
 * @property {'logged-in' | 'needs-login' | 'never'} state
 * @property {string | null} lastLoginAt
 * @property {{ at: string, ok: boolean, count?: number, code?: string, step?: string | null } | null} lastRun
 * @property {string | null} running
 */

/**
 * @typedef {object} PortalInvoice
 * @property {string} id
 * @property {string | null} date
 * @property {string | null} period
 * @property {number | null} amountCents
 * @property {string | null} invoiceNumber
 * @property {string} fileName
 * @property {number} size
 * @property {string} sha256
 */

/** Error codes of the bridge → what the card says. */
const MESSAGES = /** @type {Record<string, string>} */ ({
	PORTAL_NEEDS_LOGIN: 'portals.error.needsLogin',
	PORTAL_BUSY: 'portals.error.busy',
	PORTAL_CANCELLED: 'portals.error.cancelled',
	PORTAL_LOGIN_TIMEOUT: 'portals.error.timeout',
	PORTAL_STEP_FAILED: 'portals.error.step',
	PORTAL_BROWSER_MISSING: 'portals.error.browser',
	PORTAL_PROFILE_IN_USE: 'portals.error.profile',
	PORTAL_UNKNOWN_INVOICE: 'portals.error.unknownInvoice'
});

export class PortalError extends BridgeError {
	/** @param {string} message @param {number} status @param {string | null} code @param {string | null} step */
	constructor(message, status, code, step) {
		super(message, status);
		this.name = 'PortalError';
		this.code = code;
		this.step = step;
	}
}

/**
 * @param {{ url: string, token: string | null, fetch?: typeof fetch }} options
 */
export function createPortalClient({ url, token, fetch: f = fetch }) {
	const base = url.replace(/\/+$/, '');

	/** @param {string} path @param {RequestInit} [init] @param {boolean} [binary] */
	async function call(path, init = {}, binary = false) {
		let res;
		try {
			res = await f(`${base}${path}`, {
				...init,
				headers: {
					...(init.body ? { 'Content-Type': 'application/json' } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				cache: 'no-store',
				credentials: 'omit'
			});
		} catch {
			throw new PortalError(t('portals.error.offline'), 0, null, null);
		}
		if (binary && res.ok) return new Uint8Array(await res.arrayBuffer());
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			const code = typeof body?.code === 'string' ? body.code : null;
			const step = typeof body?.step === 'string' ? body.step : null;
			const key = code ? MESSAGES[code] : undefined;
			const message =
				res.status === 401
					? t('portals.error.unpaired')
					: key
						? t(key, { step: step ?? '' })
						: (body?.error ?? `Bridge: HTTP ${res.status}`);
			throw new PortalError(message, res.status, code, step);
		}
		return body;
	}

	/** @param {string} id */
	const at = (id) => `/portals/${encodeURIComponent(id)}`;

	return {
		/** @returns {Promise<PortalInfo[]>} */
		async list() {
			return (await call('/portals')).portals;
		},
		/** Opens the window on the bridge's Mac; resolves once logged in. @param {string} id */
		login: (id) => call(`${at(id)}/login`, { method: 'POST' }),
		/** @param {string} id */
		cancel: (id) => call(`${at(id)}/cancel`, { method: 'POST' }),
		/**
		 * @param {string} id
		 * @param {string} since YYYY-MM
		 * @param {string[]} [known] invoice ids already in the books
		 * @returns {Promise<{ since: string, listed: number, skipped: number, invoices: PortalInvoice[], errors: { id: string, code: string }[] }>}
		 */
		fetch: (id, since, known = []) =>
			call(`${at(id)}/fetch?${new URLSearchParams({ since })}`, {
				method: 'POST',
				body: JSON.stringify({ known })
			}),
		/**
		 * @param {string} id
		 * @param {string} invoiceId
		 * @returns {Promise<Uint8Array>}
		 */
		invoice: (id, invoiceId) =>
			/** @type {Promise<Uint8Array>} */ (
				call(`${at(id)}/invoice?${new URLSearchParams({ ref: invoiceId })}`, {}, true)
			),
		/** @param {string} id */
		logout: (id) => call(`${at(id)}/logout`, { method: 'POST' })
	};
}

/** @typedef {ReturnType<typeof createPortalClient>} PortalClient */
