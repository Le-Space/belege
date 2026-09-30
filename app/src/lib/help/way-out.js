// A way out for an error (issue #200, step 4): what to do about it, as a
// command to copy or a page to open, beside the message itself.
//
// Errors travel through the app as their message (a string in a card's
// state). The bridge client notes which kind each of its messages was
// (`noteWayOut`); a card hands the message to `wayOutOf` and shows what comes
// back. Only the few messages the client itself makes are noted.

/**
 * @typedef {'unreachable' | 'unknown-device' | 'origin' | 'mail' | 'llm' | 'hibiscus' | 'kraken'} WayOutKind
 */

/**
 * @typedef {object} WayOut
 * @property {WayOutKind} kind the text is `help.wayOut.<kind>` in the catalogue
 * @property {string} [command] for the terminal
 * @property {string} [href] a page of the app
 */

/** @type {Record<WayOutKind, Omit<WayOut, 'kind'>>} */
const WAYS = {
	unreachable: { command: 'pnpm bridge', href: '/integrationen/bridge' },
	'unknown-device': { href: '/integrationen/bridge' },
	origin: { href: '/integrationen/bridge' },
	mail: { command: 'pnpm setup:mail' },
	llm: { command: 'pnpm setup:llm', href: '/integrationen/ki' },
	hibiscus: { command: 'pnpm setup:hibiscus' },
	kraken: { command: 'pnpm setup:kraken' }
};

/** @type {Map<string, WayOutKind>} */
const noted = new Map();

/**
 * Which way out belongs to a bridge answer, or null.
 *
 * @param {number} status 0 when nothing answered
 * @param {{ code?: string, error?: string } | null | undefined} body
 * @returns {WayOutKind | null}
 */
export function wayOutKind(status, body) {
	if (status === 0) return 'unreachable';
	if (status === 401) return 'unknown-device';
	if (status === 403 && body?.error === 'origin not allowed') return 'origin';
	if (body?.code === 'MAIL_NOT_SET_UP') return 'mail';
	if (body?.code === 'LLM_NOT_SET_UP') return 'llm';
	// The bridge names the setup command in these two answers.
	const said = String(body?.error ?? '');
	if (status === 503 && said.includes('setup:hibiscus')) return 'hibiscus';
	if (status === 503 && said.includes('setup:kraken')) return 'kraken';
	return null;
}

/**
 * Remember what kind a message was.
 *
 * @param {string} message
 * @param {WayOutKind | null} kind
 */
export function noteWayOut(message, kind) {
	if (kind) noted.set(message, kind);
}

/**
 * The way out for a message, or null when there is none to offer.
 *
 * @param {unknown} message
 * @returns {WayOut | null}
 */
export function wayOutOf(message) {
	const kind = typeof message === 'string' ? noted.get(message) : undefined;
	return kind ? { kind, ...WAYS[kind] } : null;
}
