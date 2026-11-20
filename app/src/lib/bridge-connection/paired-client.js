// The client for the books' paired bridge (#844, B5): moved out of
// session.svelte.js unchanged.
import { readBridgeRecord } from './record.js';
import { llmFromStatus, redactionFromStatus } from '$lib/llm-redaction.js';
import { cleanMatchingSettings } from '$lib/matching/classify.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 */

/** @type {SessionContext} */
let ctx;

/** @param {SessionContext} context */
export function bindSession(context) {
	ctx = context;
}

/**
 * Ask the paired bridge whether it blacks out what goes to its model; never
 * throws, an unknown answer leaves null.
 */
export async function refreshLlmRedaction() {
	try {
		const client = await pairedClient();
		if (!client) return;
		const status = await client.llmStatus();
		ctx.app.llmRedaction = redactionFromStatus(status);
		ctx.app.llmModel = llmFromStatus(status);
	} catch {
		// Offline or an older bridge: the cautious wording stays.
	}
}

/** Bridge client from the sealed settings, or null when none is paired. */
export async function pairedClient() {
	if (!ctx.session) return null;
	const saved = await readBridgeRecord(ctx.session.store.settings);
	const { createBridgeClient, pairedWith, setRedactTerms } = await import('../bridge/client.js');
	if (!pairedWith(saved)) return null;
	// The company's names are blacked out in whatever goes to the language model (#226).
	setRedactTerms(() => cleanMatchingSettings(ctx.app.matchingSettings).companyNames);
	return createBridgeClient({ url: saved.url, token: saved.token ?? null });
}
