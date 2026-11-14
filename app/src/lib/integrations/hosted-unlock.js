// While a hosted bridge's VM boots, its unlock is tried again (#587). What
// this file decides: whether an error means "not yet" (try again) or that
// trying again will not help (stop and say why), and what of an error the
// card may show – the reason, cut short and without anything that could be
// a key, a token or a long hash. A person can cancel the waiting; the pause
// between tries ends then at once.

/** A VM that is not the one to trust: no secret went out, and none will. */
const REFUSED = /no secret goes out|measurement|not pinned|refused the secrets/i;

/** The VM or the way to it is not up yet: the agent, the relay, the node's proxy. */
const NOT_YET =
	/closed|timed out|timeout|Bad Gateway|Service Unavailable|Gateway Time|WebSocket to .* failed|ECONNREFUSED|ECONNRESET|fetch failed|Failed to fetch|NetworkError|Load failed|answered 5\d\d|\(5\d\d\)|not answering yet/i;

/**
 * Trying again does not change these: Aleph or the guest refusing the request
 * (4xx), an INSTANCE Aleph does not hold, a runtime that is not there, a
 * missing passphrase.
 */
const FATAL =
	/answered 4\d\d|\(4\d\d\)|holds no running INSTANCE|names no node|not an INSTANCE hash|passphrase|vm-images|instance runtime|not a STORE|runtime bundle|runtime manifest|pins no SEV-SNP|not sev-snp/i;

/** @param {unknown} error */
const messageOf = (error) =>
	String(
		error && typeof error === 'object' && 'message' in error
			? /** @type {any} */ (error).message
			: (error ?? '')
	);

/**
 * An error trying again will not help with, whatever its text: something
 * missing on this side (no relay with /attest, no key, no passphrase).
 *
 * @param {string} message
 */
export function fatal(message) {
	const error = new Error(message);
	/** @type {any} */ (error).fatal = true;
	return error;
}

/** The error a cancelled wait ends with. */
export function cancelled() {
	const error = new Error('cancelled');
	error.name = 'AbortError';
	return error;
}

/** @param {unknown} error */
export const isCancelled = (error) =>
	Boolean(error && typeof error === 'object' && /** @type {any} */ (error).name === 'AbortError');

/**
 * Whether the unlock of a booting VM is worth another try.
 *
 * @param {unknown} error
 * @returns {'retry' | 'stop'}
 */
export function unlockVerdict(error) {
	if (isCancelled(error)) return 'stop';
	if (error && typeof error === 'object' && /** @type {any} */ (error).fatal) return 'stop';
	const why = messageOf(error);
	if (REFUSED.test(why)) return 'stop';
	if (NOT_YET.test(why)) return 'retry';
	if (FATAL.test(why)) return 'stop';
	return 'retry';
}

/**
 * The reason to show: one line, at most `max` characters, with URLs cut at
 * their query, long hex and base64 runs shortened, and anything named a
 * passphrase, password, token, secret or key blanked. Plain text: the card
 * shows it as text, never as HTML.
 *
 * @param {unknown} error @param {number} [max]
 */
export function reasonOf(error, max = 240) {
	const text = messageOf(error)
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\b((?:wss?|https?):\/\/[^\s?#]+)[?#]\S*/gi, '$1')
		.replace(
			/\b(passphrase|password|passwort|token|secret|bearer|key)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
			'$1$2…'
		)
		.replace(/\b(?:0x)?[0-9a-f]{40,}\b/gi, (m) => `${m.slice(0, 10)}…`)
		.replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '…')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wait `ms`, or less when `signal` aborts: then with `cancelled()`.
 *
 * @param {number} ms @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function pause(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(cancelled());
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(cancelled());
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
