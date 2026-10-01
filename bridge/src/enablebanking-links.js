// Enable Banking, step 2 (issue #224): linking a bank, and unlinking it.
//
//   banks(country)   the banks Enable Banking offers in a country (cached an hour)
//   start(...)       a link begins: the bridge makes a random `state`, keeps it
//                    for 30 minutes, and Enable Banking answers with the bank's
//                    URL; the browser goes there
//   finish(...)      the bank sent the browser back to the app's page with a
//                    one-time `code`; the app hands code and state here. The
//                    state must be one this bridge made and not used yet, so a
//                    code from someone else's link is refused. The code becomes
//                    a session, kept in the sealed file
//   list()           the linked banks, with the day their consent ends
//   unlink(id)       the session is closed at Enable Banking and forgotten here
//   accounts()       every linked account, and whether it may leave the bridge
//   transactions(uid, since)
//                    an allowed account's booked transactions from a day on
//
// Step 3: only accounts whose IBAN ends in one of `enablebanking.ibanSuffixes`
// (pnpm setup:enablebanking -- --accounts) leave the bridge, like Hibiscus's.
// An allowed account carries its IBAN key (enablebanking-normalize.js), so the
// app can continue an account a statement file already brought.
// What leaves for the app: the bank, the country, the consent's end and, per
// account, the last four characters of its IBAN, its name and currency. The
// full IBAN stays in the sealed file; which accounts may leave the bridge at
// all is step 3's allow-list. The log gets counts and kinds, never a bank
// name, an IBAN or a code.

import { randomUUID } from 'node:crypto';

import { EnableBankingError } from './enablebanking.js';
import { ibanKey, normalizeEnableBankingTransaction } from './enablebanking-normalize.js';
import { ibanAllowed } from './normalize.js';

/** How long a started link waits for its answer. */
const PENDING_MS = 30 * 60_000;
const MAX_PENDING = 10;
const BANKS_TTL_MS = 60 * 60_000;
/** The longest consent asked for, also when a bank allows more. */
const MAX_CONSENT_DAYS = 180;

/** @param {string} message @param {string} code @param {number} [status] */
const refuse = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

const isState = (/** @type {unknown} */ s) =>
	typeof s === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const isCode = (/** @type {unknown} */ c) =>
	typeof c === 'string' && /^[A-Za-z0-9._~-]{8,512}$/.test(c);
export const isSessionId = (/** @type {unknown} */ id) =>
	typeof id === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * @typedef {object} Bank
 * @property {string} name as Enable Banking names it; the key for a link
 * @property {string} country
 * @property {('personal' | 'business')[]} psuTypes
 * @property {number} maxConsentDays
 * @property {boolean} beta
 */

/**
 * @typedef {object} LinkedAccount what the app sees of an account
 * @property {string} uid Enable Banking's id of the account within the session
 * @property {string} ibanLast4
 * @property {string} name
 * @property {string} currency
 */

/**
 * @typedef {object} Link
 * @property {string} id the session id
 * @property {string} bank
 * @property {string} country
 * @property {'personal' | 'business'} psuType
 * @property {string | null} validUntil ISO
 * @property {string} linkedAt ISO
 * @property {LinkedAccount[]} accounts
 */

/**
 * @param {object} options
 * @param {ReturnType<typeof import('./enablebanking.js').createEnableBankingClient>} options.client
 * @param {ReturnType<typeof import('./enablebanking.js').enableBankingSecrets>} options.secrets
 * @param {string} options.redirectUrl as registered for the application
 * @param {() => string[]} [options.allowedSuffixes] the IBAN suffixes that may leave the bridge
 * @param {number} [options.maxPages] of transactions per fetch
 * @param {() => number} [options.now]
 * @param {(line: string) => void} [options.log]
 */
export function createEnableBankingLinks({
	client,
	secrets,
	redirectUrl,
	allowedSuffixes = () => [],
	maxPages = 50,
	now = Date.now,
	log = () => {}
}) {
	/** @type {Map<string, { bank: string, country: string, psuType: 'personal' | 'business', expiresAt: number }>} */
	const pending = new Map();
	/** @type {Map<string, { at: number, banks: Bank[] }>} */
	const banksCache = new Map();
	// Writes to the sealed file one after the other.
	let writing = Promise.resolve();

	/** @param {(sessions: Record<string, any>) => Record<string, any>} change */
	function updateSessions(change) {
		const next = writing.then(async () => {
			const value = /** @type {any} */ (await secrets.read());
			const sessions = change({ ...(value.sessions ?? {}) });
			await secrets.write({ ...value, sessions });
			return sessions;
		});
		writing = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}

	/** @param {string} country @returns {Promise<Bank[]>} */
	async function banks(country) {
		if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
			throw refuse('country must be a two-letter code', 'EB_COUNTRY');
		}
		const cached = banksCache.get(country);
		if (cached && now() - cached.at < BANKS_TTL_MS) return cached.banks;
		const answer = await client.request('GET', `/aspsps?country=${country}`);
		const list = (Array.isArray(answer.aspsps) ? answer.aspsps : [])
			.filter((/** @type {any} */ a) => typeof a?.name === 'string' && a.name.length <= 120)
			.map((/** @type {any} */ a) => ({
				name: a.name,
				country,
				psuTypes: (Array.isArray(a.psu_types) ? a.psu_types : []).filter(
					(/** @type {unknown} */ p) => p === 'personal' || p === 'business'
				),
				maxConsentDays: Math.floor(Number(a.maximum_consent_validity ?? 90 * 86400) / 86400) || 90,
				beta: a.beta === true
			}))
			.filter((/** @type {Bank} */ b) => b.psuTypes.length > 0)
			.sort((/** @type {Bank} */ a, /** @type {Bank} */ b) => a.name.localeCompare(b.name));
		banksCache.set(country, { at: now(), banks: list });
		log(`enablebanking: ${list.length} bank(s) in ${country}`);
		return list;
	}

	/**
	 * @param {{ bank: unknown, country: unknown, psuType?: unknown }} params
	 * @returns {Promise<{ url: string, state: string, validUntil: string }>}
	 */
	async function start({ bank, country, psuType }) {
		const offered = await banks(/** @type {string} */ (country));
		const found = offered.find((b) => b.name === bank);
		if (!found) throw refuse('no such bank in that country', 'EB_BANK');
		const type = psuType ?? (found.psuTypes.includes('business') ? 'business' : 'personal');
		if (type !== 'personal' && type !== 'business') throw refuse('psuType', 'EB_PSU_TYPE');
		if (!found.psuTypes.includes(type)) {
			throw refuse('this bank does not offer that kind of account', 'EB_PSU_TYPE');
		}
		const days = Math.min(found.maxConsentDays, MAX_CONSENT_DAYS);
		const validUntil = new Date(now() + days * 86_400_000).toISOString();
		const state = randomUUID();
		const answer = await client.request('POST', '/auth', {
			access: { valid_until: validUntil },
			aspsp: { name: found.name, country: found.country },
			state,
			redirect_url: redirectUrl,
			psu_type: type
		});
		let url;
		try {
			url = new URL(String(answer.url));
		} catch {
			url = null;
		}
		if (!url || url.protocol !== 'https:') {
			// A fake on this machine in tests; anything else is not a bank's page.
			const loopback =
				url?.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
			if (!loopback)
				throw new EnableBankingError('Enable Banking sent no https URL.', 'EB_BAD_ANSWER');
		}
		for (const [s, p] of pending) if (p.expiresAt <= now()) pending.delete(s);
		while (pending.size >= MAX_PENDING)
			pending.delete(/** @type {string} */ (pending.keys().next().value));
		pending.set(state, {
			bank: found.name,
			country: found.country,
			psuType: type,
			expiresAt: now() + PENDING_MS
		});
		log(`enablebanking: a link was started (${type}, consent for ${days} days)`);
		return { url: /** @type {URL} */ (url).href, state, validUntil };
	}

	/**
	 * @param {{ code: unknown, state: unknown }} params
	 * @returns {Promise<Link>}
	 */
	async function finish({ code, state }) {
		if (!isState(state) || !isCode(code)) throw refuse('code and state are required', 'EB_RETURN');
		const started = pending.get(/** @type {string} */ (state));
		// Used once: a second try with the same answer is refused like a stranger's.
		pending.delete(/** @type {string} */ (state));
		if (!started || started.expiresAt <= now()) {
			throw refuse(
				'This answer from the bank belongs to no link started here, or it is older than 30 minutes; start the link again.',
				'EB_STATE',
				409
			);
		}
		const s = await client.request('POST', '/sessions', { code });
		if (!isSessionId(s.session_id)) {
			throw new EnableBankingError('Enable Banking sent no session.', 'EB_BAD_ANSWER');
		}
		const record = {
			bank: started.bank,
			country: started.country,
			psuType: started.psuType,
			validUntil: typeof s.access?.valid_until === 'string' ? s.access.valid_until : null,
			linkedAt: new Date(now()).toISOString(),
			accounts: (Array.isArray(s.accounts) ? s.accounts : [])
				.filter((/** @type {any} */ a) => typeof a?.uid === 'string')
				.map((/** @type {any} */ a) => ({
					uid: a.uid,
					iban: typeof a.account_id?.iban === 'string' ? a.account_id.iban.replace(/\s+/g, '') : '',
					name: typeof a.name === 'string' ? a.name.slice(0, 120) : '',
					currency: typeof a.currency === 'string' ? a.currency.slice(0, 3) : ''
				}))
		};
		await updateSessions((sessions) => ({ ...sessions, [s.session_id]: record }));
		log(`enablebanking: a bank was linked, ${record.accounts.length} account(s)`);
		return toLink(s.session_id, record);
	}

	/** @returns {Promise<Link[]>} */
	async function list() {
		const value = /** @type {any} */ (await secrets.read());
		return Object.entries(value.sessions ?? {}).map(([id, r]) => toLink(id, r));
	}

	/** @param {unknown} id */
	async function unlink(id) {
		if (!isSessionId(id)) throw refuse('no such link', 'EB_LINK', 404);
		const known = (await list()).some((l) => l.id === id);
		if (!known) throw refuse('no such link', 'EB_LINK', 404);
		try {
			await client.request('DELETE', `/sessions/${id}`);
		} catch (error) {
			// Ended at Enable Banking already: forgetting it here is what is left.
			if (!(error instanceof EnableBankingError && error.code === 'EB_REFUSED')) throw error;
		}
		await updateSessions((sessions) => {
			delete sessions[/** @type {string} */ (id)];
			return sessions;
		});
		log('enablebanking: a bank was unlinked');
	}

	/**
	 * Every linked account, with whether it may leave the bridge. The key only
	 * for an allowed one.
	 *
	 * @returns {Promise<LinkedAccountView[]>}
	 */
	async function accounts() {
		const value = /** @type {any} */ (await secrets.read());
		const suffixes = allowedSuffixes();
		/** @type {LinkedAccountView[]} */ const out = [];
		for (const [linkId, r] of Object.entries(value.sessions ?? {})) {
			for (const a of Array.isArray(r.accounts) ? r.accounts : []) {
				const allowed = Boolean(a.iban) && ibanAllowed(a.iban, suffixes);
				out.push({
					uid: String(a.uid),
					linkId,
					bank: String(r.bank ?? ''),
					ibanLast4: String(a.iban ?? '').slice(-4),
					name: String(a.name ?? ''),
					currency: String(a.currency ?? '') || 'EUR',
					validUntil: typeof r.validUntil === 'string' ? r.validUntil : null,
					allowed,
					ibanKey: allowed ? ibanKey(a.iban) : null
				});
			}
		}
		return out;
	}

	/**
	 * @param {unknown} uid
	 * @param {unknown} since YYYY-MM-DD
	 */
	async function transactions(uid, since) {
		if (
			typeof since !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
			!Number.isFinite(Date.parse(since))
		) {
			throw refuse('since must be YYYY-MM-DD', 'EB_SINCE');
		}
		const account = (await accounts()).find((a) => a.uid === uid);
		// Not linked and not allowed answer alike: nothing about the account leaves.
		if (!account || !account.allowed || !/^[A-Za-z0-9-]{1,100}$/.test(account.uid)) {
			throw refuse('no such account', 'EB_ACCOUNT', 404);
		}
		/** @type {import('./enablebanking-normalize.js').EnableBankingTransaction[]} */
		const out = [];
		let pending = 0;
		let pages = 0;
		/** @type {string | undefined} */ let key;
		do {
			const q = new URLSearchParams({
				date_from: since,
				...(key ? { continuation_key: key } : {})
			});
			const page = await client.request('GET', `/accounts/${account.uid}/transactions?${q}`);
			for (const t of Array.isArray(page.transactions) ? page.transactions : []) {
				const n = normalizeEnableBankingTransaction(t, account);
				if (n) out.push(n);
				else pending++;
			}
			key =
				typeof page.continuation_key === 'string' && page.continuation_key
					? page.continuation_key
					: undefined;
			pages++;
		} while (key && pages < maxPages);
		log(
			`enablebanking: ${out.length} transaction(s) since ${since}, ${pending} pending, ${pages} page(s)`
		);
		return { since, transactions: out, pending, complete: !key };
	}

	return { banks, start, finish, list, unlink, accounts, transactions };
}

/**
 * @typedef {object} LinkedAccountView
 * @property {string} uid
 * @property {string} linkId
 * @property {string} bank
 * @property {string} ibanLast4
 * @property {string} name
 * @property {string} currency
 * @property {string | null} validUntil
 * @property {boolean} allowed whether it may leave the bridge
 * @property {string | null} ibanKey only when allowed
 */

/** @param {string} id @param {any} r @returns {Link} */
function toLink(id, r) {
	return {
		id,
		bank: String(r.bank ?? ''),
		country: String(r.country ?? ''),
		psuType: r.psuType === 'personal' ? 'personal' : 'business',
		validUntil: typeof r.validUntil === 'string' ? r.validUntil : null,
		linkedAt: String(r.linkedAt ?? ''),
		accounts: (Array.isArray(r.accounts) ? r.accounts : []).map((/** @type {any} */ a) => ({
			uid: String(a.uid),
			ibanLast4: String(a.iban ?? '').slice(-4),
			name: String(a.name ?? ''),
			currency: String(a.currency ?? '')
		}))
	};
}
