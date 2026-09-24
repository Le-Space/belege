// "Portal öffnen": many vendors put their customer portal into the purpose of
// a direct debit ("… Ihre Rechnung finden Sie unter www.vodafone.de/meinkabel").
// The detail view offers it as a link, so the missing invoice is one click
// away. Pure.
//
// Careful, because the purpose is text from a third party:
//   - only a host name that is written out in the purpose (or stored with the
//     partner), with a known top-level domain – never an arbitrary string, an
//     IP address, a `javascript:` or `data:` URL, or a user:password@;
//   - an e-mail address is not a portal (`rechnung@vodafone.de`);
//   - always https, whatever the purpose says; the path only of plain URL
//     characters, no query, no fragment;
//   - the page shows the host, and opens it with rel="noopener noreferrer".

/** Top-level domains a vendor portal plausibly has; "Rechnung.pdf" has none of them. */
const TLDS = new Set([
	'de',
	'com',
	'net',
	'org',
	'eu',
	'at',
	'ch',
	'fr',
	'nl',
	'be',
	'lu',
	'it',
	'es',
	'uk',
	'ie',
	'io',
	'co',
	'info',
	'biz',
	'app',
	'dev',
	'cloud',
	'online',
	'shop',
	'store',
	'tech',
	'digital',
	'services'
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A host name as a portal may have: two labels or more, letters, digits and
 * hyphens, a known top-level domain.
 *
 * @param {string} host lower case
 */
export function plausibleHost(host) {
	if (host.length > 253) return false;
	const labels = host.split('.');
	if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
	return TLDS.has(/** @type {string} */ (labels.at(-1)));
}

// scheme? then a host (not after an @ or a word character), then a path.
const CANDIDATE =
	/(?<![@\w.-])(?:(https?):\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,24})(\/[A-Za-z0-9/._~%-]*)?(?=$|[\s,;)\]"'<>?#]|\.(?:\s|$))/gi;

/**
 * The first portal URL written in a text, or null.
 *
 * @param {unknown} text
 * @returns {{ url: string, host: string } | null}
 */
export function findPortalUrl(text) {
	const s = String(text ?? '');
	for (const m of s.matchAll(CANDIDATE)) {
		const [, scheme, rawHost, rawPath = ''] = m;
		const host = rawHost.toLowerCase();
		// Without a scheme, only a www. host counts: "Abschlag.Vertrag" is no web address.
		if (!scheme && !host.startsWith('www.')) continue;
		if (!plausibleHost(host)) continue;
		const path = rawPath.replace(/[.]+$/, '');
		const url = safeUrl(`https://${host}${path}`);
		if (url) return url;
	}
	return null;
}

/**
 * A stored URL (a partner's portal), checked by the same rules; http becomes https.
 *
 * @param {unknown} value
 * @returns {{ url: string, host: string } | null}
 */
export function safeUrl(value) {
	if (typeof value !== 'string' || value.length > 500 || /\s/.test(value.trim())) return null;
	let u;
	try {
		u = new URL(value.trim());
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	if (u.username || u.password || u.port) return null;
	const host = u.hostname.toLowerCase();
	if (!plausibleHost(host)) return null;
	if (!/^[A-Za-z0-9/._~%-]*$/.test(u.pathname)) return null;
	return { url: `https://${host}${u.pathname === '/' ? '' : u.pathname}`, host };
}

/**
 * The portal for a booking: from its purpose, else from a partner of the same
 * name that has one stored (`portalUrl`).
 *
 * @param {Record<string, any>} tx
 * @param {Record<string, any>[]} [partners]
 * @returns {{ url: string, host: string, from: 'purpose' | 'partner' } | null}
 */
export function portalLink(tx, partners = []) {
	const fromPurpose = findPortalUrl(tx.purpose);
	if (fromPurpose) return { ...fromPurpose, from: 'purpose' };
	const name = String(tx.counterparty ?? '')
		.trim()
		.toLowerCase();
	if (!name) return null;
	const partner = partners.find(
		(p) =>
			!p.deleted &&
			String(p.name ?? '')
				.trim()
				.toLowerCase() === name &&
			p.portalUrl
	);
	const stored = partner ? safeUrl(partner.portalUrl) : null;
	return stored ? { ...stored, from: 'partner' } : null;
}
