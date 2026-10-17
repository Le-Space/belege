// What the AI hints may say about redaction (ai-text.js, #431, #423).

/**
 * What the AI hints may say, from the bridge's /llm/status: true blacked out,
 * false unredacted to a model on its own computer (the bridge says `local`),
 * null not known – an older bridge without `local` counts as not known.
 *
 * @param {any} status
 * @returns {boolean | null}
 */
export function redactionFromStatus(status) {
	if (!status?.configured) return null;
	const r = status.redaction;
	if (r?.active === true) return true;
	if (r?.active === false && r?.local === true) return false;
	return null;
}
