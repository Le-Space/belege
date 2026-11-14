// Which node a hosted bridge starts on (#587): the best of Aleph's list,
// unless the books remember better. A node whose attestation could not be
// checked – AMD's key server has no certificate for its processor at the
// firmware level it reports – is not preselected again and is marked in the
// list; the node the last successful unlock ran on is preferred. The person
// can still pick any node by hand. Nothing here changes the check itself: a
// VM whose attestation cannot be verified gets nothing.

/** The sealed record: which nodes failed this way and when, and where the last unlock held. */
export const NODES_SETTING = 'bridge/hosted-nodes';

/** At most this many nodes are remembered as not checkable; the oldest go first. */
const MAX_REMEMBERED = 32;

const HASH = /^[0-9a-f]{64}$/;
const isIso = (/** @type {unknown} */ v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * @typedef {{ unverifiable: Record<string, string>, lastUnlocked: { crn: string, at: string } | null }} NodeHistory
 */

/**
 * What the books remember about nodes, from whatever the setting holds.
 *
 * @param {unknown} value
 * @returns {NodeHistory}
 */
export function nodeHistoryOf(value) {
	const v = /** @type {any} */ (value);
	/** @type {Record<string, string>} */
	const unverifiable = {};
	if (v?.unverifiable && typeof v.unverifiable === 'object') {
		for (const [crn, at] of Object.entries(v.unverifiable)) {
			if (HASH.test(crn) && isIso(at)) unverifiable[crn] = /** @type {string} */ (at);
		}
	}
	const last = v?.lastUnlocked;
	return {
		unverifiable,
		lastUnlocked:
			HASH.test(String(last?.crn ?? '')) && isIso(last?.at) ? { crn: last.crn, at: last.at } : null
	};
}

/**
 * The attestation could not be checked because AMD's key server (KDS) has
 * no certificate (VCEK) for the node's processor at its firmware level: a
 * property of the node, not of the VM or the books.
 *
 * @param {unknown} error
 */
export function isUnverifiableNode(error) {
	const message = String(
		error && typeof error === 'object' && 'message' in error
			? /** @type {any} */ (error).message
			: (error ?? '')
	);
	return /AMD KDS answered 404 for the VCEK/i.test(message);
}

/**
 * @param {NodeHistory} history @param {string} crn @param {string} at ISO time
 * @returns {NodeHistory}
 */
export function noteUnverifiable(history, crn, at) {
	if (!HASH.test(crn)) return history;
	const entries = Object.entries({ ...history.unverifiable, [crn]: at })
		.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
		.slice(0, MAX_REMEMBERED);
	return { ...history, unverifiable: Object.fromEntries(entries) };
}

/**
 * An unlock held on this node: it is checkable (again), and the one to prefer.
 *
 * @param {NodeHistory} history @param {string} crn @param {string} at ISO time
 * @returns {NodeHistory}
 */
export function noteUnlocked(history, crn, at) {
	if (!HASH.test(crn)) return history;
	const unverifiable = Object.fromEntries(
		Object.entries(history.unverifiable).filter(([hash]) => hash !== crn)
	);
	return { unverifiable, lastUnlocked: { crn, at } };
}

/**
 * The node to preselect: where the last unlock held, if it has room; else
 * the best with room that was not uncheckable last time; a node marked so
 * only when there is no other.
 *
 * @param {{ hash: string, fits: boolean }[]} nodes best first (hosted-vm.js confidentialNodes)
 * @param {NodeHistory} history
 * @returns {string} its hash, '' without nodes
 */
export function preferredNode(nodes, history) {
	const bad = (/** @type {{ hash: string }} */ n) => Boolean(history.unverifiable[n.hash]);
	const last = nodes.find((n) => n.hash === history.lastUnlocked?.crn);
	if (last && last.fits && !bad(last)) return last.hash;
	return (
		(
			nodes.find((n) => n.fits && !bad(n)) ??
			nodes.find((n) => !bad(n)) ??
			nodes.find((n) => n.fits) ??
			nodes[0]
		)?.hash ?? ''
	);
}
