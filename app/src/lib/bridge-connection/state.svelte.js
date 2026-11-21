// The bridge connection, as the app has it right now (#844, B6): one state,
// decided by `connectionOf` (state.js) from the facts gathered in facts.js.
// What a page asks about the connection – does it answer through an own
// device, over the stream, is it a hosted one, which one is expected – is a
// selector on it, so no two pages can answer differently.
import { app } from '$lib/session.svelte.js';
import { bridge } from '$lib/integrations/bridge-state.svelte.js';
import { hosted } from '$lib/integrations/hosted-status.svelte.js';
import { factsFrom } from './facts.js';
import { connectionOf } from './state.js';

/** @returns {import('./state.js').Connection} */
export const connection = () =>
	connectionOf(factsFrom({ bridge, route: app.sync.bridgeRoute, hosted, now: Date.now() }));

/** @param {import('./state.js').Connection} c */
export const viaDeviceOf = (c) => c.state === 'reachable' && c.route === 'device';
/** @param {import('./state.js').Connection} c */
export const viaStreamOf = (c) =>
	c.state === 'reachable' && (c.route === 'stream-sync' || c.route === 'stream-loopback');
/** @param {import('./state.js').Connection} c @returns {'aleph' | 'near' | null} */
export const hostedAnswersOf = (c) =>
	viaStreamOf(c) && (c.expected === 'aleph' || c.expected === 'near') ? c.expected : null;
/** @param {import('./state.js').Connection} c @returns {'aleph' | 'near' | 'local' | null} */
export const expectedOf = (c) => (c.expected === 'computer' ? 'local' : c.expected);

/**
 * The bridge answers, but through an own device's (a phone using the Mac's,
 * #142): pairing, setup and unpairing belong to that device.
 */
export const bridgeViaDevice = () => viaDeviceOf(connection());

/** The bridge answers over the stream, from its own node (#573): a device of the books. */
export const bridgeViaStream = () => viaStreamOf(connection());

/** A hosted bridge answers this device right now (over the stream, never over HTTP). */
export const hostedBridgeAnswers = () => hostedAnswersOf(connection());

/** Which bridge the books expect to answer: a hosted one, the one on a computer, or none. */
export const booksExpectedBridge = () => expectedOf(connection());
