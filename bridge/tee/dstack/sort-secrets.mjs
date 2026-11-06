// SPDX-License-Identifier: AGPL-3.0-or-later
//
// sort-secrets.mjs <run dir>: what the start sent, sorted into the tmpfs the
// hosted bridge reads (#696). The dstack counterpart of the Aleph image's
// belege-bridge-run (#583); the names and the layout are the same:
//
//   <run>/secrets/<account>     the keychain's accounts (keychain.js, secretFileOf)
//   <run>/bridge.json           from bridge_config, with the hosted settings on top
//   <run>/node/peer-key         from bridge_peer_key (base64), so the peer id stays
//   <run>/enablebanking.sealed  from enablebanking_sealed
//
// Input: BELEGE_BRIDGE_SECRETS, a JSON object name → string. Unknown names
// are dropped. Nothing is printed but names and counts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The same names as the case list in bridge/rootfs/files/belege-bridge-run:
// change both together.
const ACCOUNT =
	/^(hibiscus|imap|kraken|paperless|enablebanking|coingecko|bitcoin|alchemy|aleph_backup|bridge_auth|portal_[a-z0-9]+(_[a-z0-9]+)*)$/;
const FILES = ['bridge_config', 'bridge_peer_key', 'enablebanking_sealed'];
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
	const { llm: _llm, ...rest } = config;
	return {
		...rest,
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
	let accounts = 0;
	for (const [name, value] of Object.entries(secrets)) {
		if (!ACCOUNT.test(name)) continue;
		writeFileSync(join(run, 'secrets', name), value, { mode: 0o600 });
		accounts++;
	}
	const key = secrets.bridge_peer_key ? peerKeyFrom(secrets.bridge_peer_key) : null;
	if (key) writeFileSync(join(run, 'node', 'peer-key'), key, { mode: 0o600 });
	if (secrets.enablebanking_sealed)
		writeFileSync(join(run, 'enablebanking.sealed'), secrets.enablebanking_sealed, { mode: 0o600 });
	writeFileSync(join(run, 'bridge.json'), JSON.stringify(hostedConfig(secrets.bridge_config)), {
		mode: 0o600
	});
	return {
		accounts,
		peerKey: Boolean(key),
		config: Boolean(secrets.bridge_config)
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
			`[tee] secrets: ${r.accounts} accounts, peer key ${r.peerKey ? 'yes' : 'no'}, config ${r.config ? 'yes' : 'no'}`
		);
	} catch (e) {
		console.error(`[tee] ${/** @type {Error} */ (e).message}; starting unarmed`);
		sortSecrets(run, {});
	}
}
