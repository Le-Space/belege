// The bridge's libp2p front door: the commands of commands.js over the UCEP
// extension `belege-bridge` on the bridge's own node (node.js), as one
// command, `request` (Le-Space/belege#574, milestone M1 of #567).
//
//   request { method, path, body? }  →  { status, contentType, json | base64 }
//
// A request names the method and the path the app calls the command by over
// HTTP today – `GET /mail/search?text=…`, `POST /extract` – with the JSON
// body where there is one. It is dispatched onto the same table as the HTTP
// front door (server.js), with the same body limit per command and the same
// answer, so a device sees over the stream what it would see over HTTP, and
// the app's bridge client (#575) needs no second set of calls. This is the
// shape the desktop's forwarding of #142 has used (sync/remote-bridge.js).
//
// Who may call is settled before this runs: the node's gate lets a device of
// the books through (it proved the bridge's key and is on the device list),
// and nobody else reaches the extension (node.js). What it may call is
// settled here, once the command is known: `authorize` checks the device's
// scopes, their expiry and the limits on what costs (grants.js, #579).
//
// Not over the stream: pairing and unpairing (`session.*`: HTTP has its own,
// the node its own), shares (`share.*`: read by an assistant over HTTP), and
// a command whose body is bytes (`backup.put`, up to 256 MiB): that goes as a
// block over the proved connection in M2 (#578). An answer of bytes (a mail
// attachment, a Paperless original) goes base64 while it fits UCEP's limit –
// 1 MiB on a direct connection or through a relay that grants at least 32 MiB
// (the books' own), 64 KiB through one that grants less (js-libp2p's default
// 128 KiB). Above it, on an armed node, the bytes are sealed as blocks and the
// answer names their CID: the device fetches them over bitswap through the
// proved connection (blocks.js, #578). Without that, `TOO_LARGE`, before
// anything is encoded.

import { LIMITS, UcepError } from '@le-space/ucep';
import { checkArgs, commandInput, command as protocolCommand } from '@le-space/bridge-protocol';

import { MAX_BODY, errorJson, findCommand, statusOf } from './commands.js';

/** The commands HTTP keeps to itself. */
export const HTTP_ONLY = new Set([
	'session.pair',
	'session.unpair',
	'share.read',
	'share.create',
	'share.list',
	'share.revoke'
]);

const METHODS = new Set(['GET', 'POST', 'DELETE']);
/** A path with its query; the HTTP front door's header limit is 16 KiB. */
const MAX_PATH = 8192;
/** Room for the answer's envelope (status, content type, request id) under UCEP's limit. */
const ENVELOPE = 512;

/**
 * Whether a command is offered over the stream.
 *
 * @param {import('./commands.js').Command} command
 */
export const offered = (command) => !HTTP_ONLY.has(command.name) && command.body !== 'bytes';

/**
 * @typedef {{ status: number, contentType: string, json?: unknown, base64?: string, block?: { cid: string, size: number } }} StreamAnswer
 *   what `request` answers: JSON as it is, bytes as base64 with their mime type – or, too big for
 *   that, as sealed blocks to fetch over bitswap (blocks.js, #578): the root CID and the bytes' size
 */

/** @typedef {(bytes: Uint8Array) => Promise<{ cid: string, size: number }>} Shelve */

/**
 * One request onto the table.
 *
 * @param {object} p
 * @param {import('./commands.js').Command[]} p.commands the table (commands.js)
 * @param {Record<string, unknown> | null} p.args `{ method, path, body? }` as the device sent them
 * @param {boolean} p.limited the connection is relayed with a data limit below 32 MiB: UCEP allows 64 KiB, not 1 MiB
 * @param {Shelve} [p.shelve] bytes too big for the answer, sealed as blocks for the caller (node.js, armed)
 * @param {(command: import('./commands.js').Command) => Promise<void>} [p.authorize] may the caller run
 *   this command? Throws the UCEP error that says why not (grants.js)
 * @param {(command: import('./commands.js').Command, json: unknown) => void} [p.spent] the command's
 *   JSON answer, for what it cost (the model's tokens)
 * @param {(line: string) => void} [p.log] the command's name and the error's code; never the arguments
 * @returns {Promise<StreamAnswer>}
 */
export async function answerRequest({
	commands,
	args,
	limited,
	shelve,
	authorize = async () => {},
	spent = () => {},
	log = () => {}
}) {
	const method = String(args?.method ?? '');
	if (!METHODS.has(method)) throw new UcepError('INVALID_ARGUMENTS', 'method');
	const target = typeof args?.path === 'string' ? args.path : '';
	if (!target.startsWith('/') || target.startsWith('//') || target.length > MAX_PATH) {
		throw new UcepError('INVALID_ARGUMENTS', 'path');
	}
	const url = new URL(target, 'http://bridge');
	if (url.host !== 'bridge') throw new UcepError('INVALID_ARGUMENTS', 'path');
	const path = url.pathname.replace(/\/+$/, '') || '/';

	// A device is what the token's owner is: a share's read by its id is not for it.
	const found = findCommand(commands, { method, path, hasToken: true });
	if (!found) return { status: 404, contentType: JSON_TYPE, json: { error: 'not found' } };
	const { command, params } = found;
	if (!offered(command)) {
		throw new UcepError(
			'INVALID_ARGUMENTS',
			command.body === 'bytes'
				? `${command.name} takes bytes: not over the stream`
				: `${command.name} is not offered over the stream`
		);
	}
	const kind = command.body ?? (command.method === 'GET' ? 'none' : 'json');
	const body = kind === 'json' && args?.body !== undefined ? args.body : {};
	return runCommand({
		command,
		input: { query: url.searchParams, params, body },
		limited,
		shelve,
		authorize,
		spent,
		log
	});
}

/**
 * One command by its name, the arguments as the catalogue describes them
 * (@le-space/bridge-protocol, #577): checked against the command's schema,
 * then run as `request` runs it. An argument the schema does not expect is
 * refused before anything runs; the command's own checks follow.
 *
 * @param {object} p
 * @param {import('./commands.js').Command} p.command a command of the table, offered over the stream
 * @param {unknown} p.args the arguments as the device sent them
 * @param {boolean} p.limited
 * @param {Shelve} [p.shelve]
 * @param {(command: import('./commands.js').Command) => Promise<void>} [p.authorize]
 * @param {(command: import('./commands.js').Command, json: unknown) => void} [p.spent]
 * @param {(line: string) => void} [p.log]
 * @returns {Promise<StreamAnswer>}
 */
export async function answerNamed({
	command,
	args,
	limited,
	shelve,
	authorize,
	spent,
	log = () => {}
}) {
	const problems = checkArgs(command.name, args ?? {});
	if (problems.length) {
		log(`${command.name} over the stream: refused INVALID_ARGUMENTS`);
		throw new UcepError('INVALID_ARGUMENTS', problems.join('; ').slice(0, 500));
	}
	/** @type {import('./commands.js').Input} */
	let input;
	try {
		input = { ...commandInput(command.name, /** @type {any} */ (args ?? {})), token: null };
	} catch (/** @type {any} */ error) {
		throw new UcepError('INVALID_ARGUMENTS', error.message);
	}
	// A path the table's matcher refuses (a chain the wallets do not have) is unknown, as over HTTP.
	if (typeof command.path === 'function') {
		const spec = protocolCommand(command.name);
		const path = (spec?.path ?? '').replace(/\{([a-zA-Z]+)\}/g, (_, k) =>
			encodeURIComponent(input.params[k] ?? '')
		);
		const params = command.path(path);
		if (!params) return { status: 404, contentType: JSON_TYPE, json: { error: 'not found' } };
		input.params = params;
	}
	return runCommand({ command, input, limited, shelve, authorize, spent, log });
}

/**
 * A command onto its `run`, for `request` and for a call by name alike: the
 * device's scopes first, then the body limit, then the answer in UCEP's limits.
 *
 * @param {object} p
 * @param {import('./commands.js').Command} p.command
 * @param {Omit<import('./commands.js').Input, 'token'> & { token?: null }} p.input
 * @param {boolean} p.limited
 * @param {Shelve} [p.shelve]
 * @param {(command: import('./commands.js').Command) => Promise<void>} [p.authorize]
 * @param {(command: import('./commands.js').Command, json: unknown) => void} [p.spent]
 * @param {(line: string) => void} [p.log]
 * @returns {Promise<StreamAnswer>}
 */
async function runCommand({
	command,
	input,
	limited,
	shelve,
	authorize = async () => {},
	spent = () => {},
	log = () => {}
}) {
	try {
		await authorize(command);
	} catch (/** @type {any} */ error) {
		if (error instanceof UcepError) log(`${command.name} over the stream: refused ${error.code}`);
		throw error;
	}

	try {
		const kind = command.body ?? (command.method === 'GET' ? 'none' : 'json');
		const body = kind === 'json' ? (input.body ?? {}) : {};
		if (kind === 'json') {
			const limit = command.bodyLimit ?? MAX_BODY;
			if (Buffer.byteLength(JSON.stringify(body) ?? '') > limit) {
				throw Object.assign(new Error('Body too large'), { status: 413 });
			}
		}
		const answer = await command.run({
			query: input.query,
			params: input.params,
			body,
			token: null
		});
		if ('bytes' in answer) {
			const max = limited ? LIMITS.limitedResponse : LIMITS.response;
			if (Math.ceil(answer.bytes.length / 3) * 4 + ENVELOPE > max) {
				// Too big for the answer: sealed blocks, fetched over bitswap (#578).
				if (shelve) {
					const block = await shelve(answer.bytes);
					log(`${command.name} over the stream: ${block.size} bytes as blocks`);
					return { status: answer.status, contentType: answer.mime, block };
				}
				throw new UcepError(
					'TOO_LARGE',
					limited ? 'open a direct connection first' : 'too big for a stream'
				);
			}
			return {
				status: answer.status,
				contentType: answer.mime,
				base64: Buffer.from(answer.bytes).toString('base64')
			};
		}
		if ('text' in answer) {
			return {
				status: answer.status,
				contentType: answer.contentType,
				base64: Buffer.from(answer.text, 'utf8').toString('base64')
			};
		}
		spent(command, answer.json);
		return { status: answer.status, contentType: JSON_TYPE, json: answer.json };
	} catch (/** @type {any} */ error) {
		if (error instanceof UcepError) throw error;
		// The same answer as over HTTP (server.js): the bridge's own message, never bank data, mail or receipt text.
		const { json, line } = errorJson(error);
		log(`${command.name} over the stream: ${line}`);
		return { status: statusOf(error), contentType: JSON_TYPE, json };
	}
}

const JSON_TYPE = 'application/json; charset=utf-8';
