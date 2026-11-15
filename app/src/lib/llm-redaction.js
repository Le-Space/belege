// What the AI hints may say about redaction (ai-text.js, #431, #423).

/**
 * What the AI hints may say, from the bridge's /llm/status: true blacked out,
 * false unredacted to a model on its own computer (the bridge says `local`),
 * 'enclave' unredacted into the attested enclave of a confidential model (the
 * bridge says `enclave`, #416), null not known – an older bridge without
 * either counts as not known.
 *
 * @param {any} status
 * @returns {boolean | 'enclave' | null}
 */
export function redactionFromStatus(status) {
	if (!status?.configured) return null;
	const r = status.redaction;
	if (r?.active === true) return true;
	if (r?.active === false && r?.enclave === true) return 'enclave';
	if (r?.active === false && r?.local === true) return false;
	return null;
}

/**
 * The bridge's model as the cost hints beside the AI buttons price it
 * (stats/ai-estimate.js): the host it asks, the model, and whether it runs on
 * the bridge's own computer. Null without a model set up.
 *
 * @param {any} status what `/llm/status` answered
 * @returns {{ provider: string | null, model: string | null, local: boolean } | null}
 */
export function llmFromStatus(status) {
	if (!status?.configured) return null;
	return {
		provider: typeof status.provider === 'string' ? status.provider : null,
		model: typeof status.models?.primary === 'string' ? status.models.primary : null,
		local: status.redaction?.local === true
	};
}
