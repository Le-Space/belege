// What a device called at the bridge's own node (#579, item 7), as the
// bridge counts it: per command its name, how often let through, how often
// refused, and when last. Nothing else is kept – no argument, no answer.

/**
 * @typedef {{ command: string, calls: number, refused: number, lastAt: number }} Use
 */

/**
 * A device's usage as the bridge sent it: known shapes only, newest first.
 *
 * @param {unknown} usage
 * @returns {Use[]}
 */
export function usageList(usage) {
	if (!Array.isArray(usage)) return [];
	/** @param {unknown} n */
	const count = (n) =>
		Number.isSafeInteger(n) && /** @type {number} */ (n) > 0 ? /** @type {number} */ (n) : 0;
	return usage
		.filter(
			(u) =>
				u && typeof u.command === 'string' && /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/.test(u.command)
		)
		.slice(0, 100)
		.map((u) => ({
			command: u.command,
			calls: count(u.calls),
			refused: count(u.refused),
			lastAt: count(u.lastAt)
		}))
		.sort((a, b) => b.lastAt - a.lastAt || a.command.localeCompare(b.command));
}

/**
 * All calls of a device, let through and refused.
 *
 * @param {Use[]} list
 */
export function usageTotal(list) {
	return list.reduce((t, u) => ({ calls: t.calls + u.calls, refused: t.refused + u.refused }), {
		calls: 0,
		refused: 0
	});
}
