// The invite as a link (#148): the QR code a device shows holds a whole URL,
// `https://belege.le-space.de/#qr=<signed invite>`, so a phone's own camera
// opens Belege at it. The invite rides in the fragment, which a browser never
// sends to the server. The page takes it out of the address at once, keeps it
// for this tab (sessionStorage, so the reload a mode switch needs does not
// lose it) and, once the passkey has opened the books, the network menu
// answers it – the answer is shown as a code for the inviting device to scan.
// An invite is valid ten minutes (the library's); so is the one kept here.

/** The fragment's key. */
export const QR_LINK_KEY = 'qr';
/** Where the tab keeps an invite that came by link. */
export const PENDING_KEY = 'belege.qr.invite';
/** As long as an invite is valid. */
export const PENDING_MS = 10 * 60_000;

/**
 * The invite as a link to this page.
 *
 * @param {string} code
 * @param {string} base the app's root, e.g. `https://belege.le-space.de/`
 */
export const inviteLink = (code, base) =>
	`${base.replace(/#.*$/, '')}#${QR_LINK_KEY}=${encodeURIComponent(code)}`;

/**
 * The code in what was scanned or pasted: a link's fragment, or the code itself.
 *
 * @param {string} text
 */
export function codeFrom(text) {
	const trimmed = String(text ?? '').trim();
	const hash = /#(.*)$/.exec(trimmed)?.[1];
	if (/^https?:\/\//i.test(trimmed) && hash) {
		const value = new URLSearchParams(hash).get(QR_LINK_KEY);
		if (value) return value.trim();
	}
	return trimmed;
}

/**
 * An invite in the address: kept for this tab, taken out of the address.
 *
 * @param {{ location: { hash: string, pathname: string, search: string }, storage: Storage | undefined, replace: (url: string) => void, now?: () => number }} p
 * @returns {string | null} the invite, when there was one
 */
export function takeLinkedInvite({ location, storage, replace, now = Date.now }) {
	const params = new URLSearchParams(location.hash.replace(/^#/, ''));
	const code = params.get(QR_LINK_KEY);
	if (!code) return null;
	try {
		storage?.setItem(PENDING_KEY, JSON.stringify({ code, at: now() }));
	} catch {
		// No storage (a private window that refuses it): this page load still has it.
	}
	params.delete(QR_LINK_KEY);
	const rest = params.toString();
	replace(`${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
	return code;
}

/**
 * The invite this tab keeps, while it is valid.
 *
 * @param {Storage | undefined} storage
 * @param {() => number} [now]
 * @returns {string | null}
 */
export function pendingInvite(storage, now = Date.now) {
	try {
		const kept = JSON.parse(storage?.getItem(PENDING_KEY) ?? 'null');
		if (kept && typeof kept.code === 'string' && now() - Number(kept.at) < PENDING_MS) {
			return kept.code;
		}
		storage?.removeItem(PENDING_KEY);
	} catch {
		// Nothing readable kept.
	}
	return null;
}

/** @param {Storage | undefined} storage */
export function clearPendingInvite(storage) {
	try {
		storage?.removeItem(PENDING_KEY);
	} catch {
		// Nothing to clear.
	}
}

/**
 * Opened in iOS Safari, not from the home screen: there the installed app
 * keeps its books apart from Safari's, so Safari has none of them.
 *
 * @param {{ userAgent: string, maxTouchPoints?: number, standalone?: boolean }} nav
 * @param {boolean} standaloneDisplay `matchMedia('(display-mode: standalone)').matches`
 */
export function iosOutsideApp(nav, standaloneDisplay) {
	const ios =
		/iPhone|iPad|iPod/.test(nav.userAgent) ||
		(/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
	return ios && !standaloneDisplay && !nav.standalone;
}
