// Whether a mail really comes from the domain in its From: line, as the
// receiving server judged it (RFC 8601 `Authentication-Results`).
//
// Look-alike phishing uses the words of real invoices (docs/phase-0.md), so a
// receipt is only taken without a question when DKIM, SPF or DMARC passed for
// the sender's own domain. A pass for some other domain (a mailing service
// signing with its own key, a look-alike that signs for itself but claims
// someone else in From:) is no pass.
//
// A mail our own server accepted from a logged-in sender (`auth=pass`, how
// Mailu marks a forward you send to the accounting address) carries no DKIM
// or SPF result at all; it passes when that sender's domain is the From:
// domain – the server checked the login, which is more than DKIM proves.
//
// Which header counts: a sender can put any `Authentication-Results` into its
// mail. Our server adds its own on top, so only the topmost one is read, or,
// when `authServId` is configured, only those our server (that id) wrote.

/** @typedef {'pass' | 'fail' | 'none'} Verdict */

/**
 * @typedef {object} AuthResult
 * @property {Verdict} verdict
 * @property {string | null} dkim the best DKIM result: pass, fail, none, …
 * @property {string | null} spf
 * @property {string | null} dmarc
 * @property {string | null} domain the From: domain it was judged for
 */

const FAILING = new Set(['fail', 'softfail', 'permerror', 'policy']);

/**
 * The raw header block (as imapflow's `headers` fetch returns it) → the values
 * of every header with this name, unfolded, in order.
 *
 * @param {string} block
 * @param {string} name lower case
 * @returns {string[]}
 */
export function headerValues(block, name) {
	const unfolded = String(block ?? '').replace(/\r?\n[ \t]+/g, ' ');
	/** @type {string[]} */
	const out = [];
	for (const line of unfolded.split(/\r?\n/)) {
		const i = line.indexOf(':');
		if (i > 0 && line.slice(0, i).trim().toLowerCase() === name) out.push(line.slice(i + 1).trim());
	}
	return out;
}

/** @param {string} a @param {string} b */
function aligned(a, b) {
	if (!a || !b) return false;
	a = a.toLowerCase();
	b = b.toLowerCase();
	// Relaxed alignment, approximated: the same domain or one inside the other
	// (mail.vendor.example signs for vendor.example).
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** @param {string | null | undefined} address */
export function domainOf(address) {
	const m = /@([^@\s>]+)\s*>?\s*$/.exec(String(address ?? ''));
	return m ? m[1].toLowerCase() : '';
}

/**
 * @param {string} value one header's value
 * @returns {{ servId: string, results: { method: string, result: string, props: Record<string, string> }[] }}
 */
export function parseAuthenticationResults(value) {
	// Comments in parentheses carry nothing we need and may contain `;`.
	const clean = String(value ?? '').replace(/\([^()]*\)/g, ' ');
	const [servPart, ...rest] = clean.split(';');
	const servId = (servPart ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
	const results = [];
	for (const part of rest) {
		const tokens = part.trim().split(/\s+/).filter(Boolean);
		const head = tokens.shift();
		const m = head ? /^([a-z0-9-]+)=([a-z]+)$/i.exec(head) : null;
		if (!m) continue;
		/** @type {Record<string, string>} */
		const props = {};
		for (const t of tokens) {
			const p = /^([a-z0-9.-]+)=(.+)$/i.exec(t);
			if (p) props[p[1].toLowerCase()] = p[2].replace(/^"|"$/g, '');
		}
		results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props });
	}
	return { servId, results };
}

/**
 * @param {object} params
 * @param {string} params.headers the raw header block
 * @param {string} params.from the From: address
 * @param {string | null} [params.authServId]
 * @returns {AuthResult}
 */
export function authVerdict({ headers, from, authServId = null }) {
	const domain = domainOf(from) || null;
	const all = headerValues(headers, 'authentication-results').map(parseAuthenticationResults);
	const trusted = authServId
		? all.filter((h) => h.servId === authServId.toLowerCase())
		: all.slice(0, 1);
	const results = trusted.flatMap((h) => h.results);

	/** @param {string} method */
	const of = (method) => results.filter((r) => r.method === method);
	const dkim = of('dkim');
	const spf = of('spf');
	const dmarc = of('dmarc');

	const dkimPass = dkim.some(
		(r) =>
			r.result === 'pass' &&
			aligned(r.props['header.d'] ?? domainOf(r.props['header.i']), domain ?? '')
	);
	const spfPass = spf.some(
		(r) =>
			r.result === 'pass' &&
			aligned(
				domainOf(r.props['smtp.mailfrom']) ||
					r.props['smtp.mailfrom'] ||
					r.props['smtp.helo'] ||
					'',
				domain ?? ''
			)
	);
	const dmarcPass = dmarc.some((r) => r.result === 'pass');
	const submitted = of('auth').some(
		(r) =>
			r.result === 'pass' &&
			aligned(domainOf(r.props['smtp.mailfrom']) || domainOf(r.props['smtp.auth']), domain ?? '')
	);
	const dmarcFail = dmarc.some((r) => FAILING.has(r.result));
	const anyFail = [...dkim, ...spf, ...dmarc].some((r) => FAILING.has(r.result));

	// A pass for another domain than From: only (a mailing service's own
	// signature, or a look-alike signing for itself) proves nothing: `none`,
	// so the app asks.
	/** @type {Verdict} */
	let verdict = 'none';
	if (!dmarcFail && (dmarcPass || dkimPass || spfPass || submitted)) verdict = 'pass';
	else if (anyFail) verdict = 'fail';

	/** @param {typeof dkim} list */
	const best = (list) =>
		list.length === 0
			? null
			: (
					list.find((r) => r.result === 'pass') ??
					list.find((r) => FAILING.has(r.result)) ??
					list[0]
				).result;
	return { verdict, dkim: best(dkim), spf: best(spf), dmarc: best(dmarc), domain };
}
