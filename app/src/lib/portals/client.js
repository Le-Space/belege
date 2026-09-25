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
 * @property {{ at: string, ok: boolean, count?: number, refused?: number, code?: string, step?: string | null } | null} lastRun
 * @property {string | null} running login, fetch, logout, record
 * @property {boolean} [recordable] the bridge can record this portal ("Portal aufzeichnen")
 * @property {boolean} [recorded] a recorded recipe is saved for it
 * @property {boolean} [review] a stopped recording waits to be saved or discarded
 * @property {boolean} [credentials] the bridge can store credentials from here ("Zugangsdaten speichern")
 * @property {boolean} [hasCredentials] a user name and a password are stored on the bridge
 * @property {'bundled' | 'local'} [source] local: a portal of your own ("Neues Portal aufzeichnen")
 * @property {boolean} [pending] a new portal being recorded, never saved yet
 * @property {string} [host] the portal's site, e.g. claude.ai
 */

/**
 * @typedef {object} RecordedStep
 * @property {'click' | 'page'} kind
 * @property {string} [role] link, button, tab, menuitem, element
 * @property {string} [label] the control's name, digits as #
 * @property {boolean} [download]
 * @property {boolean} [usable] false: no stable selector, left out of the recipe
 * @property {string} [path] a page, masked
 * @property {string} [host] on another host than the portal's site
 */

/**
 * @typedef {object} RecordingReview
 * @property {string} at
 * @property {boolean} download
 * @property {number} pausedOnLogin
 * @property {RecordedStep[]} steps
 * @property {string[]} [hosts] other hosts the way passed through: each needs a yes before saving
 * @property {boolean} [invoice] the downloaded invoice was kept and comes with the save
 */

/**
 * @typedef {object} RecordingSaved
 * @property {boolean} saved
 * @property {string} recipeVersion
 * @property {number} route
 * @property {string[]} [allowedHosts]
 * @property {PortalInvoice[]} [invoices] the invoice downloaded while recording
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
	PORTAL_UNKNOWN_INVOICE: 'portals.error.unknownInvoice',
	PORTAL_RECORDING_OFF: 'portals.error.recordingOff',
	PORTAL_NOT_RECORDED: 'portals.error.notRecorded',
	PORTAL_RECORDING_NO_DOWNLOAD: 'portals.error.noDownload',
	PORTAL_RECORDING_UNUSABLE: 'portals.error.unusable',
	PORTAL_RECIPE_REJECTED: 'portals.error.rejected',
	PORTAL_NO_RECORDED_RECIPE: 'portals.error.noRecipe',
	PORTAL_CREDENTIALS_CANCELLED: 'portals.error.credentialsCancelled',
	PORTAL_CREDENTIALS_EMPTY: 'portals.error.credentialsEmpty',
	PORTAL_CREDENTIALS_INVALID: 'portals.error.credentialsInvalid',
	PORTAL_CREDENTIALS_UNSUPPORTED: 'portals.error.credentialsUnsupported',
	PORTAL_CREDENTIALS_OFF: 'portals.error.credentialsOff',
	PORTAL_HOSTS_UNCONFIRMED: 'portals.error.hostsUnconfirmed',
	PORTAL_NEW_INVALID: 'portals.error.newInvalid',
	PORTAL_NOT_LOCAL: 'portals.error.notLocal'
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
		logout: (id) => call(`${at(id)}/logout`, { method: 'POST' }),
		/** "Portal aufzeichnen": opens the window on the portal's start page. @param {string} id */
		recordStart: (id) => call(`${at(id)}/record/start`, { method: 'POST' }),
		/**
		 * Ends the recording; the steps for review.
		 *
		 * @param {string} id
		 * @returns {Promise<RecordingReview>}
		 */
		recordStop: (id) => call(`${at(id)}/record/stop`, { method: 'POST' }),
		/**
		 * @param {string} id
		 * @param {string[]} [hosts] the other hosts the user confirmed
		 * @returns {Promise<RecordingSaved>}
		 */
		recordSave: (id, hosts = []) =>
			call(`${at(id)}/record/save`, { method: 'POST', body: JSON.stringify({ hosts }) }),
		/**
		 * "Neues Portal aufzeichnen": a portal of your own, recorded at once.
		 *
		 * @param {{ name: string, startUrl: string }} body
		 * @returns {Promise<{ id: string, recording: boolean }>}
		 */
		recordNew: (body) => call('/portals/new', { method: 'POST', body: JSON.stringify(body) }),
		/** "Portal entfernen": a portal of your own, recipe and profile. @param {string} id */
		remove: (id) => call(`${at(id)}/remove`, { method: 'POST' }),
		/** @param {string} id */
		recordDiscard: (id) => call(`${at(id)}/record/discard`, { method: 'POST' }),
		/** The saved recipe override, as JSON to share. @param {string} id */
		exportRecipe: (id) => call(`${at(id)}/recipe/export`),
		/**
		 * "Zugangsdaten speichern": the user name only. The bridge asks for the
		 * password in a window on its Mac; it never passes through here.
		 *
		 * @param {string} id
		 * @param {string} username
		 * @returns {Promise<{ hasCredentials: boolean }>}
		 */
		saveCredentials: (id, username) =>
			call(`${at(id)}/credentials`, { method: 'POST', body: JSON.stringify({ username }) }),
		/** @param {string} id @returns {Promise<{ hasCredentials: boolean }>} */
		deleteCredentials: (id) => call(`${at(id)}/credentials`, { method: 'DELETE' })
	};
}

/** @typedef {ReturnType<typeof createPortalClient>} PortalClient */
