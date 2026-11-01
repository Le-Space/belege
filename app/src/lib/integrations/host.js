// Whether a bridge can run on this device at all (issue #142). The bridge is
// a Node process on a computer; a phone or tablet never has one, so the
// bridge card there must not ask "is it running?" or offer a terminal – it
// points to the computer's bridge, served over device sync instead.

/**
 * @param {{ userAgent: string, maxTouchPoints?: number }} nav
 * @returns {boolean} false on iPhone, iPad, iPod and Android; an iPad that
 *   calls itself a Macintosh is told apart by its touch points
 */
export function canHostBridge(nav) {
	const ua = nav.userAgent ?? '';
	if (/iPhone|iPad|iPod|Android/.test(ua)) return false;
	if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false;
	return true;
}

/** This browser, or true where there is no navigator (SSR, tests). */
export const hostsBridge = () =>
	typeof navigator === 'undefined' ? true : canHostBridge(navigator);
