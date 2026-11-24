// Le Space Credits (#593, the service of #591): a balance in euro cents for
// Belege, topped up through Stripe without an account, drawn on by Le Space's
// own services (the KI service, a hosted bridge). The account is the address
// of the books' own Aleph key (backup/keeper.js), which syncs with the books,
// so every own device sees the same balance. Every request is signed with it
// (EIP-191 over one line); nothing else identifies the person.
//
// Stripe's script never runs here: the payment page lives on the service's
// own origin (`/pay`), in a frame of the dialog, and tells this page by
// postMessage that it is done. The message is a hint only; the balance read
// back from the service is the truth.

import { ensureBackupKey } from '../backup/keeper.js';
import { getSetting, setSetting } from '../store/settings.js';

/** The service, its own origin. */
export const CREDITS_URL = 'https://credits.le-space.de';
/** This app's product: a credit bought here never pays for another product. */
export const PRODUCT = 'belege';
/** The signed line's version, as the service checks it. */
export const SCHEME = 'ls-credits/v1';
/** In E2E builds only: where a fake service runs, set by the test. */
export const E2E_CREDITS_URL_KEY = 'belege.e2e.creditsUrl';
/** The settings record that says the person switched Le Space Credits on. */
export const ON_SETTING = 'credits/on';

/** The top-ups, as the service sells them (le-space-credits products.js). */
export const TOPUPS = Object.freeze([
	{ id: 'topup-10', cents: 1000 },
	{ id: 'topup-25', cents: 2500 },
	{ id: 'topup-50', cents: 5000 }
]);

/**
 * The hosted bridge's plans (le-space-credits products.js, PLANS.belege): hours
 * of the VM a period pays, at Aleph's price for a confidential VM of 2 compute
 * units; the price in credits (1 credit = 1 cent).
 */
export const BRIDGE_PLANS = Object.freeze([
	{ id: 'bridge-s', hours: 60, credits: 700 },
	{ id: 'bridge-m', hours: 176, credits: 1600 },
	{ id: 'bridge-always', hours: 730, credits: 5900 }
]);

/** @returns {string} */
export function creditsUrl() {
	// Written inline so every other build drops it.
	if (import.meta.env.VITE_E2E === 'true') {
		const base = globalThis.localStorage?.getItem(E2E_CREDITS_URL_KEY);
		if (base) return base.replace(/\/+$/, '');
	}
	return CREDITS_URL;
}

/** The one line a request signs. @param {{ method: string, path: string, address: string, timestamp: number }} r */
export const canonical = ({ method, path, address, timestamp }) =>
	`${SCHEME}\n${method.toUpperCase()}\n${path}\n${PRODUCT}\n${address}\n${timestamp}`;

export class CreditsError extends Error {
	/** @param {string} message @param {number} status @param {string} code */
	constructor(message, status, code) {
		super(message);
		this.name = 'CreditsError';
		this.status = status;
		this.code = code;
	}
}

/**
 * A client for this person's account. The key is the books' own Aleph key;
 * the curve code loads only here, when the card is used.
 *
 * @param {{ key: Uint8Array, base?: string, fetch?: typeof fetch, now?: () => number }} p
 */
export async function createCreditsClient({
	key,
	base = creditsUrl(),
	fetch: f = fetch,
	now = () => Date.now()
}) {
	const { alephAddressOf, alephSign } = await import('../backup/aleph-signer.js');
	const address = alephAddressOf(key);
	// One use per timestamp on the service: two requests in one second wait.
	let last = 0;

	/** @param {string} method @param {string} path @param {Record<string, unknown>} [body] */
	async function call(method, path, body) {
		let timestamp = Math.floor(now() / 1000);
		if (timestamp <= last) timestamp = last + 1;
		last = timestamp;
		const query = method === 'GET' ? `?product=${PRODUCT}` : '';
		const res = await f(`${base}${path}${query}`, {
			method,
			headers: {
				...(body ? { 'content-type': 'application/json' } : {}),
				'x-ls-address': address,
				'x-ls-timestamp': String(timestamp),
				'x-ls-signature': alephSign(key, canonical({ method, path, address, timestamp }))
			},
			...(body ? { body: JSON.stringify({ product: PRODUCT, ...body }) } : {})
		});
		/** @type {any} */
		let out = null;
		try {
			out = await res.json();
		} catch {
			out = null;
		}
		if (!res.ok)
			throw new CreditsError(
				String(out?.error ?? `HTTP ${res.status}`),
				res.status,
				String(out?.code ?? 'HTTP')
			);
		return out;
	}

	return {
		address,
		/** @returns {Promise<Balance>} */
		balance: () => call('GET', '/v1/balance'),
		/** @returns {Promise<Purchase[]>} the newest first */
		purchases: async () => {
			const out = await call('GET', '/v1/purchases');
			return Array.isArray(out?.purchases) ? out.purchases : [];
		},
		/**
		 * The terms in force, an announced version, and the declaration on
		 * withdrawal a top-up needs.
		 * @returns {Promise<PublishedTerms>}
		 */
		terms: async () => publishedTerms(await call('GET', '/v1/terms'), base),
		/** Agree to a version of the terms. @param {string} version */
		acceptTerms: (version) => call('POST', '/v1/terms/accept', { version }),
		/**
		 * @param {string} packageId @param {string} [locale]
		 * @param {string | null} [waiver] the version of the declaration on withdrawal the person ticked
		 * @returns {Promise<{ client_secret: string }>}
		 */
		checkout: (packageId, locale, waiver) =>
			call('POST', '/v1/checkout', {
				package: packageId,
				...(locale ? { locale } : {}),
				...(waiver ? { waiver } : {})
			}),
		/** @returns {Promise<{ refund_id: string, state: string }>} */
		refund: () => call('POST', '/v1/refund', {}),
		/**
		 * Choose a plan, paid from the balance; its first period opens right away.
		 * @param {string} planId @returns {Promise<{ package: Balance['package'] }>}
		 */
		choosePlan: (planId) => call('PUT', '/v1/package', { package: planId }),
		/**
		 * "Verträge hier kündigen" (§ 312k BGB): end the plan at its period's
		 * end. Never waits for the terms; the service confirms it by mail when
		 * Stripe has an address. 409 SUBSCRIBED for a Stripe subscription.
		 * @returns {Promise<{ package: Balance['package'] }>}
		 */
		endPlan: () => call('PUT', '/v1/package', { package: null }),
		/**
		 * "Vertrag widerrufen" (§ 356a BGB): with `quote` only what can still be
		 * withdrawn; without, the withdrawal itself (409 NOTHING_TO_WITHDRAW
		 * once nothing can). Never gated by the terms; the service mails the
		 * receipt when Stripe has an address.
		 * @param {boolean} quote @returns {Promise<Withdrawal>}
		 */
		withdraw: async (quote) => withdrawalOf(await call('POST', '/v1/withdrawal', { quote })),
		/**
		 * Let `delegate` start, forget and forward the VM that Le Space's
		 * sub-account for these books pays (Aleph's `security` aggregate).
		 * 409 NO_PLAN without a running period.
		 *
		 * @param {string} delegate
		 * @returns {Promise<VmAuthorization>}
		 */
		vmAuthorize: (delegate) => call('POST', '/v1/vm/authorize', { delegate })
	};
}

/**
 * @typedef {{
 *   product: string,
 *   address: string,
 *   credits: number,
 *   reserved: number,
 *   lines_this_month: { ki: number, vm: number, transfer: number, refund?: number },
 *   package?: { id: string, state: string, billing?: string, period_start: string | null, period_end: string | null, hours_left: number | null } | null,
 *   refund?: { id: string, state: string, credits: number | null, created_at: string, done_at?: string | null } | null,
 *   mode?: 'test' | 'live' | null,
 *   terms?: unknown,
 *   vm?: { owner: string, delegates: string[] } | null
 * }} Balance
 */

/**
 * @typedef {{
 *   owner: string,
 *   delegate: string,
 *   types: string[],
 *   aggregate_keys: string[],
 *   hours_left: number | null,
 *   period_end: string | null,
 *   revoke_at: string | null
 * }} VmAuthorization
 */

/**
 * @typedef {{
 *   id: string,
 *   product: string,
 *   package: string,
 *   amount_cents: number,
 *   credits: number,
 *   stripe_invoice_url: string | null,
 *   created_at: string
 * }} Purchase
 */

/**
 * What the service says about a withdrawal (POST /v1/withdrawal): the
 * contracts that can still be withdrawn (a quote) or were withdrawn, each with
 * when it was concluded and until when it could be withdrawn; for a withdrawal
 * when it was received, and the refund request it opened. Everything in it
 * is the service's word, shown as text.
 *
 * @typedef {{ subject: string, what: string, concludedAt: string | null, until: string | null }} WithdrawalItem
 * @typedef {{ quote: boolean, items: WithdrawalItem[], receivedAt: string | null, refund: boolean }} Withdrawal
 *
 * @param {any} body
 * @returns {Withdrawal}
 */
export function withdrawalOf(body) {
	const list = Array.isArray(body?.withdrawable)
		? body.withdrawable
		: Array.isArray(body?.withdrawn)
			? body.withdrawn
			: [];
	const iso = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v : null);
	return {
		quote: body?.quote === true,
		items: list
			.filter((/** @type {any} */ i) => i && typeof i === 'object')
			.map((/** @type {any} */ i) => ({
				subject: String(i.subject ?? ''),
				what: String(i.what ?? ''),
				concludedAt: iso(i.concluded_at),
				until: iso(i.until)
			})),
		receivedAt: iso(body?.received_at),
		refund: Boolean(body?.refund)
	};
}

/**
 * A page of the service the card may link to: https (or the E2E fake) on the
 * service's own origin, nothing else. Null for anything else.
 *
 * @param {unknown} url @param {string} [base]
 * @returns {string | null}
 */
export function creditsPage(url, base = creditsUrl()) {
	if (typeof url !== 'string') return null;
	try {
		const u = new URL(url, base);
		return u.origin === new URL(base).origin && !u.username ? u.href : null;
	} catch {
		return null;
	}
}

/**
 * What the service publishes of its terms (GET /v1/terms), reduced to what
 * the card shows. Everything in it is the service's word: shown as text, a
 * link only to the service's own origin.
 *
 * @typedef {{ version: string, url: string | null, changes: string[], effectiveAt: string | null, publishedAt: string | null }} TermsVersion
 * @typedef {{ current: TermsVersion | null, pending: TermsVersion | null, withdrawal: { version: string, de: string, en: string } | null }} PublishedTerms
 *
 * @param {any} body @param {string} [base]
 * @returns {PublishedTerms}
 */
export function publishedTerms(body, base = creditsUrl()) {
	const one = (/** @type {any} */ v) =>
		v?.version
			? {
					version: String(v.version),
					url: creditsPage(v.url, base),
					changes: (Array.isArray(v.changes) ? v.changes : v.changes ? [v.changes] : []).map(
						String
					),
					effectiveAt: typeof v.effectiveAt === 'string' ? v.effectiveAt : null,
					publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : null
				}
			: null;
	const w = body?.withdrawal;
	return {
		current: one(body?.current),
		pending: one(body?.pending),
		withdrawal:
			w?.version && typeof w.de === 'string' && w.de.trim()
				? {
						version: String(w.version),
						de: w.de,
						en: typeof w.en === 'string' && w.en.trim() ? w.en : w.de
					}
				: null
	};
}

/**
 * Where this account stands with the terms (`terms` of GET /v1/balance).
 * `dueVersion` is the version to agree to before a purchase (the service
 * refuses one with 412 TERMS until then): the service says it (`due`, since
 * le-space-credits#115) – a new customer is asked for the newest published
 * version, one who agreed to the version in force only from the day the next
 * takes effect. While it does not say, the version in force not agreed to yet.
 * `announced` is a published, coming version not agreed to and not due: an
 * existing customer may agree early; it binds them from `pendingEffectiveAt`.
 *
 * @param {any} t
 */
export function termsOf(t) {
	const version = (/** @type {any} */ v) =>
		v && typeof v === 'object' ? (v.version ? String(v.version) : null) : v ? String(v) : null;
	const accepted = version(t?.accepted);
	const current = version(t?.current);
	const pending = version(t?.pending);
	const told = Boolean(t && typeof t === 'object' && 'due' in t);
	const dueVersion = told ? version(t.due) : current && accepted !== current ? current : null;
	const date = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v : null);
	return {
		accepted,
		acceptedAt: date(t?.accepted?.accepted_at),
		current,
		pending,
		pendingEffectiveAt: date(t?.pending?.effectiveAt),
		pendingPublishedAt: date(t?.pending?.publishedAt),
		dueVersion,
		due: Boolean(dueVersion),
		announced: Boolean(
			pending && accepted !== pending && pending !== current && pending !== dueVersion
		)
	};
}

/**
 * An invoice link the card may open: only Stripe's hosted invoice pages. The
 * link comes from the service, but a link is opened only when it is one.
 *
 * @param {unknown} url
 * @returns {url is string}
 */
export function isInvoiceUrl(url) {
	if (typeof url !== 'string') return false;
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && u.hostname === 'invoice.stripe.com' && !u.username;
	} catch {
		return false;
	}
}

/**
 * The payment page for a Checkout: on the service's origin, the secret and
 * this page's origin in the fragment, so neither reaches a server log.
 *
 * @param {string} clientSecret @param {string} origin @param {string} [base]
 */
export const payUrl = (clientSecret, origin, base = creditsUrl()) =>
	`${base}/pay#cs=${encodeURIComponent(clientSecret)}&origin=${encodeURIComponent(origin)}`;

/**
 * Is this the payment page saying it is done? Only from the service's own
 * origin, and only that one message.
 *
 * @param {{ origin: string, data: unknown }} event @param {string} [base]
 */
export const isPaidMessage = (event, base = creditsUrl()) =>
	event.origin === new URL(base).origin &&
	/** @type {any} */ (event.data)?.type === 'ls-credits:paid';

/**
 * The books' Aleph key, made if the books have none yet, and whether the
 * person has switched Le Space Credits on (nothing is asked before).
 *
 * @param {import('../store/repository.js').Collection} settings
 */
export async function loadCredits(settings) {
	const on = (await getSetting(settings, ON_SETTING)) === true;
	return { on, key: on ? await ensureBackupKey(settings) : null };
}

/** @param {import('../store/repository.js').Collection} settings @param {boolean} on */
export async function setCreditsOn(settings, on) {
	await setSetting(settings, ON_SETTING, on);
	return loadCredits(settings);
}

/** Euro from credits (1 credit = 1 cent). @param {number} credits @param {string} locale */
export const euro = (credits, locale) =>
	new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(credits / 100);
