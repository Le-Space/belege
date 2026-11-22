// How large a request to the bridge may be now, for callers that size a long
// call before they make it (#976): the account list of "✦ Konto vorschlagen"
// (booking/assist-input.js), a receipt's text (#975). The consumer of the
// bridge's node (remote-bridge.js) keeps it current: the limit the node's
// UCEP manifest states while it is connected directly or through a relay
// that grants enough, else UCEP's default. Without imports, so a page that
// only sizes a call loads no libp2p.

/** UCEP's default request limit (ucep.md §11; `LIMITS.request` of @le-space/ucep). */
export const DEFAULT_REQUEST_LIMIT = 64 * 1024;

/** @type {() => number} */
let current = () => DEFAULT_REQUEST_LIMIT;

/**
 * The bytes a request to the bridge may take now, sealed and with UCEP's
 * envelope: UCEP's default unless the bridge's node states more and is
 * reached so that it holds.
 */
export const bridgeRequestLimit = () => {
	const n = current();
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_REQUEST_LIMIT;
};

/**
 * Who knows the limit; null: nobody, the default holds.
 *
 * @param {(() => number) | null} source
 */
export function setBridgeRequestLimit(source) {
	current = source ?? (() => DEFAULT_REQUEST_LIMIT);
}

/**
 * What the bridge takes as the JSON body of a command that carries text for
 * the model (`llm.extract`, `llm.booking`, …), over HTTP and the stream alike
 * (bridge/src/commands.js MAX_EXTRACT_BODY).
 */
export const BRIDGE_BODY_LIMIT = 256 * 1024;

/**
 * The JSON a call may carry, before sealing, for a request limit: 44 KiB for
 * UCEP's 64 KiB (#972); for a bigger limit the bridge's node states (#976),
 * the same share of it (11/16, room for the seal's third and the envelope),
 * and never more than the bridge's body limit with a little room.
 *
 * @param {number} [requestLimit] bridgeRequestLimit()
 */
export function jsonBudget(requestLimit = DEFAULT_REQUEST_LIMIT) {
	if (!(requestLimit > DEFAULT_REQUEST_LIMIT)) return 44 * 1024;
	return Math.min(BRIDGE_BODY_LIMIT - 4096, Math.floor((requestLimit * 11) / 16));
}
