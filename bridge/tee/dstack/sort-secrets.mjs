// SPDX-License-Identifier: AGPL-3.0-or-later
//
// sort-secrets.mjs <run dir>: what the start sent, sorted into the tmpfs the
// hosted bridge reads (#696). The dstack counterpart of the Aleph image's
// belege-bridge-run (#583); the names and the layout are the same:
//
//   <run>/secrets/<account>     the keychain's accounts (keychain.js, secretFileOf); `llm`
//                               only with a model in LibertAI's attested enclave (#754)
//   <run>/bridge.json           from bridge_config, with the hosted settings on top
//   <run>/node/peer-key         from bridge_peer_key (base64), so the peer id stays
//   <run>/enablebanking.sealed  from enablebanking_sealed
//   <run>/start.json            from bridge_start: the books and the start this VM answers
//                               (not secret; registrar.mjs binds the quote to it)
//
// Input: BELEGE_BRIDGE_SECRETS, a JSON object name → string. Unknown names
// are dropped. Nothing is printed but names and counts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The same names as the case list in bridge/rootfs/files/belege-bridge-run:
// change both together.
const ACCOUNT =
	/^(hibiscus|imap|llm|kraken|paperless|enablebanking|coingecko|bitcoin|alchemy|aleph_backup|bridge_auth|portal_[a-z0-9]+(_[a-z0-9]+)*)$/;
const FILES = ['bridge_config', 'bridge_peer_key', 'enablebanking_sealed', 'bridge_start'];
/** An account's secret: the keychain's own limit (keychain.js). */
const MAX = 64 * 1024;
/** bridge.json with many devices, a sealed file with its sessions. */
const MAX_FILE = 256 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The node's key from base64, or null when it is not clean base64: the bridge
 * then makes its own key instead of failing on a broken one.
 *
 * @param {string} text
 */
export function peerKeyFrom(text) {
	const clean = text.replace(/\s+/g, '');
	if (!BASE64.test(clean) || clean.length % 4) return null;
	const key = Buffer.from(clean, 'base64');
	return key.length && key.toString('base64') === clean ? key : null;
}

/**
 * @param {string} raw the JSON from the environment, or undefined
 * @returns {Record<string, string>}
 */
export function parseSecrets(raw) {
	if (!raw) return {};
	let all;
	try {
		all = JSON.parse(raw);
	} catch {
		throw new Error('BELEGE_BRIDGE_SECRETS is not JSON');
	}
	if (!all || typeof all !== 'object' || Array.isArray(all))
		throw new Error('BELEGE_BRIDGE_SECRETS is not an object');
	/** @type {Record<string, string>} */
	const out = {};
	for (const [name, value] of Object.entries(all)) {
		if (typeof value !== 'string') continue;
		if (ACCOUNT.test(name) ? value.length <= MAX : FILES.includes(name) && value.length <= MAX_FILE)
			out[name] = value;
	}
	return out;
}

/**
 * The start this VM answers, from `bridge_start` ({ books, at_ms }), or null.
 *
 * @param {string | undefined} raw
 */
export function startFrom(raw) {
	if (!raw) return null;
	try {
		const s = JSON.parse(raw);
		const books = String(s?.books ?? '');
		const at = String(s?.at_ms ?? '');
		if (/^[a-z0-9._-]{2,64}$/.test(books) && /^\d{1,16}$/.test(at)) return { books, at_ms: at };
	} catch {
		// not JSON: no start
	}
	return null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const MEASUREMENT = /^[0-9a-f]{32,}$/i;

/**
 * The model a hosted bridge may use (#754): one in LibertAI's attested
 * enclave, pinned by setup:llm (config.js `teePinOf`), reached at LibertAI's
 * base URL, which the bridge sends to the enclave instead
 * (llm/confidential.js). Anything else: null, and the bridge runs without a
 * model, as before.
 *
 * @param {unknown} raw config.llm
 */
export function enclaveLlm(raw) {
	const llm = /** @type {any} */ (raw);
	if (!llm || typeof llm !== 'object' || Array.isArray(llm)) return null;
	const tee = llm.tee;
	if (!tee || tee.provider !== 'libertai') return null;
	if (!HEX64.test(String(tee.itemHash)) || !MEASUREMENT.test(String(tee.measurement))) return null;
	let base;
	try {
		base = new URL(String(llm.baseUrl));
	} catch {
		return null;
	}
	if (base.protocol !== 'https:' || base.hostname !== 'api.libertai.io') return null;
	const text = (/** @type {unknown} */ v) => (typeof v === 'string' && v.length <= 200 ? v : null);
	const model = text(llm.model);
	if (!model) return null;
	return {
		baseUrl: base.toString().replace(/\/+$/, ''),
		model,
		retryModel: text(llm.retryModel) ?? model,
		redactTerms: Array.isArray(llm.redactTerms)
			? llm.redactTerms.filter((t) => typeof t === 'string').slice(0, 500)
			: [],
		redaction: ['auto', 'on', 'off'].includes(llm.redaction) ? llm.redaction : 'auto',
		configured: true,
		tee: {
			provider: 'libertai',
			itemHash: String(tee.itemHash),
			measurement: String(tee.measurement),
			sourceCommit: typeof tee.sourceCommit === 'string' ? tee.sourceCommit : null,
			pinnedAt: String(tee.pinnedAt ?? '')
		}
	};
}

/**
 * The bridge.json the hosted bridge runs with: the owner's, with what a
 * hosted bridge must have. No inbound port: the node's WebSocket stays on
 * 127.0.0.1 and nothing is announced; the node is reached through the
 * books' relays.
 *
 * @param {string | undefined} raw
 */
export function hostedConfig(raw) {
	let config = {};
	try {
		const parsed = raw ? JSON.parse(raw) : {};
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
	} catch {
		config = {};
	}
	const bridge =
		config.bridge && typeof config.bridge === 'object' && !Array.isArray(config.bridge)
			? config.bridge
			: {};
	const node =
		config.node && typeof config.node === 'object' && !Array.isArray(config.node)
			? config.node
			: {};
	// A model only in LibertAI's attested enclave (#754, before it none: #251);
	// no LAN relay and no paired tokens of a computer's bridge (settings taken
	// over, #728). Change both together with bridge/rootfs/files/belege-bridge-run.
	const { llm: rawLlm, lanRelay: _lanRelay, pairedTokens: _pairedTokens, ...rest } = config;
	const llm = enclaveLlm(rawLlm);
	return {
		...rest,
		...(llm ? { llm } : {}),
		bridge: { ...bridge, port: 8765 },
		node: { ...node, enabled: true, wsPort: 9097, announce: [] }
	};
}

/**
 * @param {string} run
 * @param {Record<string, string | undefined>} env
 */
export function sortSecrets(run, env) {
	const secrets = parseSecrets(env.BELEGE_BRIDGE_SECRETS);
	mkdirSync(join(run, 'secrets'), { recursive: true, mode: 0o700 });
	mkdirSync(join(run, 'node'), { recursive: true, mode: 0o700 });
	const config = hostedConfig(secrets.bridge_config);
	let accounts = 0;
	for (const [name, value] of Object.entries(secrets)) {
		if (!ACCOUNT.test(name)) continue;
		// The model's key only beside a model in the attested enclave (#754).
		if (name === 'llm' && !('llm' in config)) continue;
		writeFileSync(join(run, 'secrets', name), value, { mode: 0o600 });
		accounts++;
	}
	const key = secrets.bridge_peer_key ? peerKeyFrom(secrets.bridge_peer_key) : null;
	if (key) writeFileSync(join(run, 'node', 'peer-key'), key, { mode: 0o600 });
	if (secrets.enablebanking_sealed)
		writeFileSync(join(run, 'enablebanking.sealed'), secrets.enablebanking_sealed, { mode: 0o600 });
	const start = startFrom(secrets.bridge_start);
	if (start) writeFileSync(join(run, 'start.json'), JSON.stringify(start), { mode: 0o644 });
	writeFileSync(join(run, 'bridge.json'), JSON.stringify(config), {
		mode: 0o600
	});
	return {
		accounts,
		peerKey: Boolean(key),
		config: Boolean(secrets.bridge_config),
		start: Boolean(start),
		llm: 'llm' in config
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const run = process.argv[2];
	if (!run) {
		console.error('usage: sort-secrets.mjs <run dir>');
		process.exit(2);
	}
	try {
		const r = sortSecrets(run, process.env);
		console.error(
			`[tee] secrets: ${r.accounts} accounts, peer key ${r.peerKey ? 'yes' : 'no'}, config ${r.config ? 'yes' : 'no'}, start ${r.start ? 'yes' : 'no'}, model in the enclave ${r.llm ? 'yes' : 'no'}`
		);
	} catch (e) {
		console.error(`[tee] ${/** @type {Error} */ (e).message}; starting unarmed`);
		sortSecrets(run, {});
	}
}
