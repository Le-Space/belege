// An Enable Banking API on 127.0.0.1 for tests (issue #224), as strict as the
// real one about what it checks: the JWT's header (RS256, `kid` = a known
// application) and claims (issuer, audience, issued now, valid at most a day),
// and its signature against the application's public key. A rate limit can
// be switched on.
//
// Linking (step 2): GET /aspsps, POST /auth (the bank and the redirect URL
// must be known, the consent no longer than the bank allows), the bank's page
// at /bank/consent – no JWT, a browser goes there – which sends the browser
// back to the redirect URL with a one-time code (or `error=access_denied` when
// the test says no), POST /sessions (each code once), DELETE /sessions/<id>.
// Fetching (step 3): GET /accounts/<uid>/transactions from `date_from`, in
// pages, while a session is open.
// All banks, IBANs and names are made up.

import http from 'node:http';
import { createPublicKey, createVerify, generateKeyPairSync, randomUUID } from 'node:crypto';

export const FAKE_EB_APP_ID = '00000000-0000-4000-8000-0000000000eb';

/** A made-up application key, generated once per test run (2048 bits: quick). */
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const FAKE_EB_PRIVATE_KEY = /** @type {string} */ (
	pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
);

/** Two made-up banks in Germany. */
export const FAKE_EB_BANKS = [
	{
		name: 'Beispielbank',
		country: 'DE',
		psu_types: ['personal', 'business'],
		maximum_consent_validity: 180 * 86400
	},
	{
		name: 'Musterbank Privat',
		country: 'DE',
		psu_types: ['personal'],
		maximum_consent_validity: 90 * 86400
	}
];

/** What a link to the Beispielbank brings: two accounts. */
export const FAKE_EB_ACCOUNTS = [
	{
		uid: 'acc-0001',
		account_id: { iban: 'DE00 0000 0000 0000 0012 34' },
		name: 'Geschäftskonto',
		currency: 'EUR'
	},
	{
		uid: 'acc-0002',
		account_id: { iban: 'DE00000000000000005678' },
		name: 'Tagesgeld',
		currency: 'EUR'
	}
];

/** A day `n` days before today, as Enable Banking writes dates. @param {number} n */
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * The Geschäftskonto's transactions (acc-0001), newest first as banks send
 * them: an income, a direct debit, a fee without a counterparty, and one still
 * pending. Dates relative to today, so a first fetch (90 days) finds them.
 */
export function sampleEnableBankingTransactions() {
	return [
		{
			entry_reference: 'EB-REF-0004',
			status: 'PDNG',
			booking_date: daysAgo(1),
			transaction_amount: { amount: '15.00', currency: 'EUR' },
			credit_debit_indicator: 'DBIT',
			creditor: { name: 'Bäckerei Beispiel' },
			remittance_information: ['Vormerkung']
		},
		{
			entry_reference: 'EB-REF-0003',
			status: 'BOOK',
			booking_date: daysAgo(3),
			value_date: daysAgo(3),
			transaction_amount: { amount: '4.90', currency: 'EUR' },
			credit_debit_indicator: 'DBIT',
			remittance_information: ['Kontoführung'],
			bank_transaction_code: { description: 'Abschluss' }
		},
		{
			entry_reference: 'EB-REF-0002',
			status: 'BOOK',
			booking_date: daysAgo(10),
			value_date: daysAgo(10),
			transaction_amount: { amount: '119.00', currency: 'EUR' },
			credit_debit_indicator: 'DBIT',
			creditor: { name: 'Wolkenfabrik Hosting GmbH' },
			creditor_account: { iban: 'DE00000000000000002222' },
			remittance_information: ['RE-1001', 'Kundennummer 4711'],
			bank_transaction_code: { description: 'Basislastschrift' }
		},
		{
			entry_reference: 'EB-REF-0001',
			status: 'BOOK',
			booking_date: daysAgo(20),
			value_date: daysAgo(19),
			transaction_amount: { amount: '2380.00', currency: 'EUR' },
			credit_debit_indicator: 'CRDT',
			debtor: { name: 'Kundin Beispiel AG' },
			debtor_account: { iban: 'DE00000000000000001111' },
			remittance_information: ['Rechnung 2026-001']
		}
	];
}

/**
 * @param {object} [options]
 * @param {string} [options.appId]
 * @param {string} [options.publicKey] PEM; defaults to the made-up key's
 * @param {string} [options.environment]
 * @param {boolean} [options.active]
 * @param {string[]} [options.redirectUrls]
 * @param {number} [options.rateLimit] requests allowed before 429; Infinity by default
 * @param {() => number} [options.now] ms
 * @param {boolean} [options.deny] the bank page answers `access_denied`
 * @param {Record<string, any[]>} [options.transactions] by account uid; acc-0001 has the sample
 * @param {number} [options.pageSize] transactions per page, paged with `continuation_key`
 * @param {string} [options.bankUrl] where the bank page is said to be; the fake's own by default.
 *   A browser test points it at the app's origin and routes it here: a cross-site
 *   navigation would lose Chrome's virtual authenticator.
 */
export async function startFakeEnableBanking({
	appId = FAKE_EB_APP_ID,
	publicKey,
	environment = 'SANDBOX',
	active = true,
	redirectUrls = ['https://belege.le-space.de/integrationen/bank/verbunden'],
	rateLimit = Infinity,
	now = Date.now,
	deny = false,
	transactions = { 'acc-0001': sampleEnableBankingTransactions(), 'acc-0002': [] },
	pageSize = 2,
	bankUrl
} = {}) {
	const key = publicKey ? createPublicKey(publicKey) : pair.publicKey;
	const state = {
		requests: 0,
		refused: /** @type {string[]} */ ([]),
		/** @type {Map<string, { redirectUrl: string, state: string, validUntil: string, bank: string }>} */
		auths: new Map(),
		/** @type {Map<string, { used: boolean, auth: string }>} */
		codes: new Map(),
		/** @type {Map<string, { open: boolean }>} */
		sessions: new Map(),
		deny,
		transactionPages: 0,
		/** @type {number | null} a bank that grants fewer days than asked for */
		sessionDays: /** @type {number | null} */ (null)
	};

	/** @param {string | undefined} header @returns {string | null} why it is refused */
	function checkJwt(header) {
		const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(header ?? '');
		if (!m) return 'no bearer token';
		let head, claims;
		try {
			head = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
			claims = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8'));
		} catch {
			return 'not a JWT';
		}
		if (head.alg !== 'RS256' || head.typ !== 'JWT') return 'algorithm';
		if (head.kid !== appId) return 'unknown application';
		if (claims.iss !== 'enablebanking.com' || claims.aud !== 'api.enablebanking.com')
			return 'claims';
		const t = Math.floor(now() / 1000);
		if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return 'times';
		if (claims.iat > t + 60 || claims.exp <= t || claims.exp - claims.iat > 86400) return 'expired';
		const ok = createVerify('RSA-SHA256')
			.update(`${m[1]}.${m[2]}`)
			.verify(key, Buffer.from(m[3], 'base64url'));
		return ok ? null : 'signature';
	}

	/** @param {http.IncomingMessage} req @returns {Promise<any>} */
	const body = (req) =>
		new Promise((resolve) => {
			let text = '';
			req.on('data', (d) => (text += d));
			req.on('end', () => {
				try {
					resolve(JSON.parse(text));
				} catch {
					resolve(null);
				}
			});
		});

	const server = http.createServer(async (req, res) => {
		/** @param {number} status @param {unknown} body */
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const at = new URL(req.url ?? '/', 'http://x');
		// The bank's own page: a browser comes here, without a token.
		if (req.method === 'GET' && at.pathname === '/bank/consent') {
			const auth = state.auths.get(at.searchParams.get('ref') ?? '');
			if (!auth) return send(404, { error: 'NOT_FOUND' });
			const back = new URL(auth.redirectUrl);
			if (state.deny) {
				back.searchParams.set('error', 'access_denied');
				back.searchParams.set('error_description', 'Der Nutzer hat abgebrochen');
			} else {
				const code = randomUUID();
				state.codes.set(code, { used: false, auth: at.searchParams.get('ref') ?? '' });
				back.searchParams.set('code', code);
			}
			back.searchParams.set('state', auth.state);
			res.writeHead(302, { location: back.href });
			return res.end();
		}
		state.requests++;
		const why = checkJwt(req.headers.authorization);
		if (why) {
			state.refused.push(why);
			return send(401, { code: 401, error: 'UNAUTHORIZED', message: `JWT refused: ${why}` });
		}
		if (state.requests > rateLimit) {
			return send(429, { code: 429, error: 'TOO_MANY_REQUESTS', message: 'Rate limit' });
		}
		const path = at.pathname;
		if (req.method === 'GET' && path === '/aspsps') {
			const country = at.searchParams.get('country');
			return send(200, { aspsps: FAKE_EB_BANKS.filter((b) => b.country === country) });
		}
		if (req.method === 'POST' && path === '/auth') {
			const b = await body(req);
			const bank = FAKE_EB_BANKS.find(
				(x) => x.name === b?.aspsp?.name && x.country === b?.aspsp?.country
			);
			if (!bank) return send(422, { code: 422, error: 'ASPSP_NOT_FOUND', message: 'no such bank' });
			if (!redirectUrls.includes(b.redirect_url)) {
				return send(422, { code: 422, error: 'REDIRECT_URI_NOT_ALLOWED', message: 'redirect' });
			}
			if (!bank.psu_types.includes(b.psu_type)) {
				return send(422, { code: 422, error: 'PSU_TYPE_NOT_SUPPORTED', message: 'psu' });
			}
			const until = Date.parse(b.access?.valid_until ?? '');
			if (!(until > now()) || until - now() > bank.maximum_consent_validity * 1000 + 60_000) {
				return send(422, { code: 422, error: 'WRONG_ACCESS_VALID_UNTIL', message: 'valid_until' });
			}
			if (typeof b.state !== 'string' || !b.state) {
				return send(422, { code: 422, error: 'WRONG_REQUEST_PARAMETERS', message: 'state' });
			}
			const ref = randomUUID();
			state.auths.set(ref, {
				redirectUrl: b.redirect_url,
				state: b.state,
				validUntil: b.access.valid_until,
				bank: bank.name
			});
			const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
			return send(200, {
				url: `${bankUrl ?? `http://127.0.0.1:${port}`}/bank/consent?ref=${ref}`,
				authorization_id: ref
			});
		}
		if (req.method === 'POST' && path === '/sessions') {
			const b = await body(req);
			const code = state.codes.get(b?.code);
			if (!code || code.used) {
				return send(422, { code: 422, error: 'WRONG_AUTHORIZATION_CODE', message: 'code' });
			}
			code.used = true;
			const auth = /** @type {any} */ (state.auths.get(code.auth));
			const id = randomUUID();
			state.sessions.set(id, { open: true });
			return send(200, {
				session_id: id,
				accounts: auth.bank === 'Beispielbank' ? FAKE_EB_ACCOUNTS : [],
				aspsp: { name: auth.bank, country: 'DE' },
				psu_type: 'business',
				access: {
					valid_until:
						state.sessionDays === null
							? auth.validUntil
							: new Date(now() + state.sessionDays * 86_400_000).toISOString()
				}
			});
		}
		const txAccount = /^\/accounts\/([A-Za-z0-9-]+)\/transactions$/.exec(path)?.[1];
		if (req.method === 'GET' && txAccount) {
			const open = [...state.sessions.values()].some((x) => x.open);
			if (!open || !(txAccount in transactions)) {
				return send(422, { code: 422, error: 'ACCOUNT_DOES_NOT_EXIST', message: 'no' });
			}
			const from = at.searchParams.get('date_from') ?? '';
			const all = transactions[txAccount].filter((t) => (t.booking_date ?? '') >= from);
			const start = Number(at.searchParams.get('continuation_key') ?? 0);
			const next = start + pageSize;
			state.transactionPages++;
			return send(200, {
				transactions: all.slice(start, next),
				continuation_key: next < all.length ? String(next) : null
			});
		}
		const session = /^\/sessions\/([0-9a-f-]{36})$/.exec(path)?.[1];
		if (req.method === 'DELETE' && session) {
			const s = state.sessions.get(session);
			if (!s?.open) return send(422, { code: 422, error: 'SESSION_DOES_NOT_EXIST', message: 'no' });
			s.open = false;
			return send(200, { message: 'OK' });
		}
		if (req.method === 'GET' && path === '/application') {
			return send(200, {
				name: 'Beispiel Belege',
				kid: appId,
				environment,
				redirect_urls: redirectUrls,
				active,
				countries: ['DE']
			});
		}
		// For the client's hardening: an answer that tries to send it elsewhere.
		if (path === '/moved') {
			res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
			return res.end();
		}
		if (path === '/huge') {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(`"${'x'.repeat(64 * 1024)}"`);
		}
		send(404, { code: 404, error: 'NOT_FOUND', message: 'Not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		state,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}
