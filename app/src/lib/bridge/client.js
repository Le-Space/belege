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

	/** @param {string} path @param {RequestInit} [init] @param {boolean} [binary] */
	async function call(path, init = {}, binary = false) {
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
		if (binary && res.ok) return new Uint8Array(await res.arrayBuffer());
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			const messages = /** @type {Record<number, string>} */ ({
				401: 'Die Bridge kennt dieses Gerät nicht (neu koppeln).',
				403:
					body?.error === 'origin not allowed'
						? 'Diese App-Adresse ist in der Bridge nicht erlaubt.'
						: 'Falscher Kopplungscode.',
				410: 'Kein Kopplungscode aktiv: Bridge mit --pair neu starten.',
				503:
					body?.code === 'MAIL_NOT_SET_UP'
						? 'Das Postfach ist auf der Bridge nicht eingerichtet (pnpm setup:mail).'
						: body?.code === 'LLM_NOT_SET_UP'
							? 'Das Auslesen ist auf der Bridge nicht eingerichtet (pnpm setup:llm).'
							: body?.error
			});
			if (res.status === 403 && body?.code === 'SENDER_UNVERIFIED') {
				throw new BridgeError('Der Absender ist nicht bestätigt (DKIM/SPF): erst freigeben.', 403);
			}
			if (res.status === 502 && body?.code === 'EXTRACT_FAILED') {
				const reasons = (body.attempts ?? []).map(
					(/** @type {any} */ a) => `${a.model}: ${a.reason}`
				);
				throw new BridgeError(
					`Kein Modell lieferte eine brauchbare Antwort (${reasons.join('; ')}).`,
					502
				);
			}
			throw new BridgeError(
				messages[res.status] ?? body?.error ?? `Bridge: HTTP ${res.status}`,
				res.status
			);
		}
		return body;
	}

	return {
		url: base,
		/** @returns {Promise<{ ok: boolean, paired: boolean, pairingOpen: boolean, hibiscus: { configured: boolean }, mail?: { configured: boolean, accountingAddress: string | null }, llm?: { configured: boolean, models: string[] } }>} */
		health: () => call('/health'),
		/** @param {string} code @returns {Promise<string>} the token */
		async pair(code) {
			const { token } = await call('/pair', { method: 'POST', body: JSON.stringify({ code }) });
			return token;
		},
		/** Tells the bridge to forget this device's token. */
		async unpair() {
			await call('/unpair', { method: 'POST' });
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
		},
		/**
		 * Mails to the accounting address that arrived in [since, until).
		 *
		 * @param {string} since YYYY-MM-DD
		 * @param {string | null} [until] YYYY-MM-DD, exclusive; null leaves the end open
		 * @returns {Promise<{ accountingAddress: string, messages: any[] }>}
		 */
		async mailMessages(since, until = null) {
			const q = new URLSearchParams({ since, scope: 'accounting' });
			if (until) q.set('until', until);
			return call(`/mail/messages?${q}`);
		},
		/**
		 * @param {string} id
		 * @param {string} part
		 * @returns {Promise<Uint8Array>}
		 */
		async mailAttachment(id, part) {
			const q = new URLSearchParams({ id, part });
			return /** @type {Promise<Uint8Array>} */ (call(`/mail/attachment?${q}`, {}, true));
		},
		/**
		 * The targeted search in the whole mailbox for one missing receipt: vendor
		 * text and every spelling of an amount, ± days around a day. Only the hits
		 * are read (bridge/README.md).
		 *
		 * @param {{ text?: string | null, amount?: string | null, from?: string[], around?: string | null, days?: number }} query
		 * @returns {Promise<{ messages: any[] }>} each with `matched`: the criteria that hit
		 */
		async mailSearch({ text = null, amount = null, from = [], around = null, days = 14 }) {
			const q = new URLSearchParams({ days: String(days) });
			if (text) q.set('text', text);
			if (amount) q.set('amount', amount);
			if (from.length) q.set('from', from.slice(0, 3).join(','));
			if (around) q.set('around', around);
			return call(`/mail/search?${q}`);
		},
		/**
		 * What the bridge reads receipts with: the provider's host, the models,
		 * whether a key is in its keychain (never the key), how many terms it
		 * blacks out, and the mail server id it trusts for the sender check.
		 *
		 * @returns {Promise<{ configured: boolean, provider: string | null, models: { primary: string | null, fallback: string | null }, keyConfigured: boolean, redactTerms: number, mail: { authServId: string | null } }>}
		 */
		llmStatus: () => call('/llm/status'),
		/**
		 * "Mit KI weitersuchen": the LLM suggests search words and sender domains
		 * from the booking (redacted by the bridge), the bridge searches, and the
		 * LLM picks among the hits' subjects, domains and file names.
		 *
		 * @param {{ counterparty: string, purpose?: string, amount?: string | null, around?: string | null, days?: number, knownDomains?: string[] }} body
		 * @returns {Promise<{ vendor: string | null, terms: string[], domains: string[], messages: any[], pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		mailAssist: (body) => call('/mail/assist', { method: 'POST', body: JSON.stringify(body) }),
		/**
		 * @param {{ text: string, hints?: Record<string, string>, source?: { mailId: string }, confirmedByUser?: boolean }} body
		 * @returns {Promise<{ extraction: any, model: string, usage: any, ms?: number, attempts: any[], fallback?: { used: boolean, reason: string | null }, redactions?: any, sentText?: string }>}
		 */
		async extract(body) {
			return call('/extract', { method: 'POST', body: JSON.stringify(body) });
		}
	};
}

/** @typedef {ReturnType<typeof createBridgeClient>} BridgeClient */
