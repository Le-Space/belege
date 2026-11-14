// SPDX-License-Identifier: AGPL-3.0-or-later
// @le-space/bridge-protocol: the Belege bridge's commands, their schemas and
// how HTTP carries them (Le-Space/belege#577). Imported by the bridge and by
// every client, in a browser and in Node.

import { command } from './catalogue.js';
import { check } from './schema.js';

export { COMMANDS, DEVICE_SCOPES, PROTOCOL_VERSION, command } from './catalogue.js';
export { check } from './schema.js';
export { commandInput, httpRequest, pathParams, toQuery } from './http.js';
export {
	BLOCK_CHUNK_BYTES,
	BLOCK_KEY_INFO,
	BLOCK_VERSION,
	MAX_BLOCK_ANSWER,
	bridgeBlockKey
} from './blocks.js';

/**
 * The problems of a call's arguments; [] when they fit. An unknown command
 * is a problem too.
 *
 * @param {string} name
 * @param {unknown} args
 * @returns {string[]}
 */
export function checkArgs(name, args) {
	const spec = command(name);
	if (!spec) return [`unknown command ${name}`];
	return check(spec.request, args ?? {});
}

/**
 * The problems of a JSON answer; [] when it fits, and for a command that
 * answers bytes or text.
 *
 * @param {string} name
 * @param {unknown} answer
 * @returns {string[]}
 */
export function checkAnswer(name, answer) {
	const spec = command(name);
	if (!spec) return [`unknown command ${name}`];
	return spec.answer === 'json' && spec.response ? check(spec.response, answer) : [];
}
