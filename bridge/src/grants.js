// What each device of the books may do with this bridge over the stream
// (Le-Space/belege#579, M2). The node's gate decides who gets in (node.js);
// this decides what a device that got in may call.
//
// Scopes. Every command of commands.js names the scope it needs
// (`bridge:bank:read`, `bridge:llm`, …). A device holds a set of them. A
// device the books list without saying which scopes – every device paired
// before #579, and every device the app tells today – holds all of them: what
// it could do before, it can do now. Nothing more is granted by itself; a
// device that is not on the books' list holds nothing.
//
// Expiry. A device's scopes lapse when it has not used the bridge for
// `idleDays` (90). It is refused `GRANT_EXPIRED` until the device that paired
// the bridge renews it. That device's own scopes do not lapse: it holds the
// pairing, and taking the pairing away is "Kopplung lösen".
//
// Limits. What costs money is counted per device: calls to the language
// model a minute, its tokens a day, backups an hour – so a stolen phone
// cannot run up the model's bill or the Aleph credits before it is removed.
// Above a limit the call is refused `RATE_LIMITED`. The counters live in
// memory: a restart of the bridge starts them again.
//
// What is kept: per device its scopes, when they were granted and when last
// used – in `<config dir>/node/device-grants.json`, beside UCEP's grants.
// Peer ids, scope names and times; never an argument or an answer.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { UcepError } from '@le-space/ucep';

/**
 * @typedef {object} Limits
 * @property {number} llmPerMinute calls to the language model a minute, per device
 * @property {number} llmTokensPerDay the model's tokens a day (UTC), per device
 * @property {number} backupPerHour backup calls an hour, per device
 * @property {number} idleDays a device's scopes lapse after this many days unused
 */

/** @type {Limits} */
export const DEFAULT_LIMITS = Object.freeze({
	llmPerMinute: 30,
	llmTokensPerDay: 2_000_000,
	backupPerHour: 10,
	idleDays: 90
});

/** The message of a `RATE_LIMITED`: which limit, so the app can say it (remote-bridge.js). */
export const LIMIT = Object.freeze({
	llmPerMinute: 'llm-per-minute',
	llmTokensPerDay: 'llm-tokens-per-day',
	backupPerHour: 'backup-per-hour'
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** lastUsedAt is written at most this often per device: a call is no file write. */
const TOUCH_MS = 60 * 60 * 1000;
const SCOPE = /^bridge:[a-z]+(:[a-z]+)?$/;
const PEER_ID = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;

/**
 * Limits from bridge.json (`node.limits`), each a positive integer, else the default.
 *
 * @param {any} raw
 * @returns {Limits}
 */
export function limitsOf(raw) {
	/** @param {keyof Limits} key */
	const pick = (key) =>
		Number.isInteger(raw?.[key]) && raw[key] > 0 ? raw[key] : DEFAULT_LIMITS[key];
	return {
		llmPerMinute: pick('llmPerMinute'),
		llmTokensPerDay: pick('llmTokensPerDay'),
		backupPerHour: pick('backupPerHour'),
		idleDays: pick('idleDays')
	};
}

/**
 * The scopes the bridge offers over the stream: those its commands name.
 *
 * @param {{ scope: string }[]} commands the offered commands (stream.js `offered`)
 */
export const scopesOf = (commands) =>
	[...new Set(commands.map((c) => c.scope).filter(Boolean))].sort();

/**
 * The books' device list as a device sends it: a peer id alone (all scopes,
 * as before #579), or `{ peerId, scopes }`.
 *
 * @param {unknown} list
 * @param {string[]} all the scopes the bridge offers
 * @returns {Map<string, string[]>} peer id → scopes
 */
export function parseDevices(list, all) {
	if (!Array.isArray(list) || list.length > 64) {
		throw new UcepError('INVALID_ARGUMENTS', 'devices must be up to 64 entries');
	}
	/** @type {Map<string, string[]>} */
	const out = new Map();
	for (const entry of list) {
		if (typeof entry === 'string' && PEER_ID.test(entry)) {
			out.set(entry, [...all]);
			continue;
		}
		const peerId = /** @type {any} */ (entry)?.peerId;
		const scopes = /** @type {any} */ (entry)?.scopes;
		if (
			typeof peerId !== 'string' ||
			!PEER_ID.test(peerId) ||
			!Array.isArray(scopes) ||
			scopes.length > 32 ||
			!scopes.every((s) => typeof s === 'string' && SCOPE.test(s))
		) {
			throw new UcepError('INVALID_ARGUMENTS', 'a device is a peer id or { peerId, scopes }');
		}
		// A scope the bridge does not offer is dropped, not kept for later.
		out.set(peerId, [...new Set(scopes)].filter((s) => all.includes(s)).sort());
	}
	return out;
}

/**
 * @typedef {object} Grant
 * @property {string[]} scopes
 * @property {number} grantedAt
 * @property {number} lastUsedAt
 */

/**
 * The tokens an answer of the language model reports: every `usage` object
 * with `prompt` and `completion` in it, as extract.js and the assists return
 * them. Bounded, so an odd answer costs nothing to walk.
 *
 * @param {unknown} value
 */
export function tokensIn(value) {
	let total = 0;
	let seen = 0;
	/** @param {unknown} v @param {number} depth */
	const walk = (v, depth) => {
		if (!v || typeof v !== 'object' || depth > 6 || ++seen > 2000) return;
		if (Array.isArray(v)) {
			for (const x of v.slice(0, 100)) walk(x, depth + 1);
			return;
		}
		for (const [key, x] of Object.entries(v)) {
			if (key === 'usage' && x && typeof x === 'object' && !Array.isArray(x)) {
				const u = /** @type {any} */ (x);
				const n = (Number(u.prompt) || 0) + (Number(u.completion) || 0);
				if (Number.isFinite(n) && n > 0) total += n;
			} else {
				walk(x, depth + 1);
			}
		}
	};
	walk(value, 0);
	return total;
}

/**
 * @param {object} p
 * @param {string} p.file `<config dir>/node/device-grants.json`
 * @param {string[]} p.scopes what the bridge offers (scopesOf)
 * @param {Limits} [p.limits]
 * @param {() => number} [p.now]
 */
export function createGrants({ file, scopes: all, limits = DEFAULT_LIMITS, now = Date.now }) {
	/** @type {Map<string, Grant>} */
	const grants = new Map();
	/** @type {Map<string, number[]>} */ const llmCalls = new Map();
	/** @type {Map<string, number[]>} */ const backupCalls = new Map();
	/** @type {Map<string, { day: string, tokens: number }>} */ const tokens = new Map();
	let loaded = false;
	/** @type {Promise<void>} */
	let writing = Promise.resolve();

	async function load() {
		if (loaded) return;
		loaded = true;
		try {
			const raw = JSON.parse(await readFile(file, 'utf8'));
			for (const [peer, g] of Object.entries(raw?.devices ?? {})) {
				if (!PEER_ID.test(peer) || !Array.isArray(g?.scopes)) continue;
				grants.set(peer, {
					scopes: g.scopes.filter((/** @type {unknown} */ s) => all.includes(String(s))),
					grantedAt: Number(g.grantedAt) || now(),
					lastUsedAt: Number(g.lastUsedAt) || 0
				});
			}
		} catch {
			// No file yet: every device the books list holds what it held before.
		}
	}

	function save() {
		const devices = Object.fromEntries(grants);
		writing = writing
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(file), { recursive: true, mode: 0o700 });
				const tmp = `${file}.${process.pid}.tmp`;
				await writeFile(tmp, `${JSON.stringify({ version: 1, devices })}\n`, { mode: 0o600 });
				await rename(tmp, file);
			});
		return writing;
	}

	/** @param {Grant} g @param {boolean} holder */
	const expiresAt = (g, holder) =>
		holder ? null : Math.max(g.grantedAt, g.lastUsedAt) + limits.idleDays * DAY_MS;

	/** @param {Map<string, number[]>} map @param {string} peer @param {number} windowMs @param {number} max */
	function within(map, peer, windowMs, max) {
		const since = now() - windowMs;
		const list = (map.get(peer) ?? []).filter((t) => t > since);
		map.set(peer, list);
		return list.length < max;
	}

	const today = () => new Date(now()).toISOString().slice(0, 10);

	return {
		/**
		 * The books' devices with their scopes: a new device is granted now, one
		 * whose scopes changed is granted anew, one that is gone loses its grant.
		 * A device whose scopes are unchanged keeps its times – telling the list
		 * again renews nothing.
		 *
		 * @param {Map<string, string[]>} devices
		 */
		async set(devices) {
			await load();
			let changed = false;
			for (const peer of [...grants.keys()]) {
				if (!devices.has(peer)) {
					grants.delete(peer);
					changed = true;
				}
			}
			for (const [peer, scopes] of devices) {
				const had = grants.get(peer);
				if (had && had.scopes.join(' ') === scopes.join(' ')) continue;
				grants.set(peer, { scopes, grantedAt: now(), lastUsedAt: had?.lastUsedAt ?? 0 });
				changed = true;
			}
			if (changed) await save();
		},

		/**
		 * At an armed start, the devices bridge.json lists: one without a grant –
		 * admitted before the bridge kept scopes, or handed over at pairing – holds
		 * all scopes, from now; a grant for a device no longer listed goes.
		 *
		 * @param {string[]} peers
		 */
		async adopt(peers) {
			await load();
			let changed = false;
			for (const peer of [...grants.keys()]) {
				if (!peers.includes(peer)) {
					grants.delete(peer);
					changed = true;
				}
			}
			for (const peer of peers) {
				if (grants.has(peer)) continue;
				grants.set(peer, { scopes: [...all], grantedAt: now(), lastUsedAt: 0 });
				changed = true;
			}
			if (changed) await save();
		},

		/** @param {string} peer the device's scopes count from now again */
		async renew(peer) {
			await load();
			const g = grants.get(peer);
			if (!g) return false;
			g.grantedAt = now();
			await save();
			return true;
		},

		/**
		 * May this device call a command of this scope now? Throws the UCEP
		 * error that says why not; counts the call when it may.
		 *
		 * @param {string} peer
		 * @param {string} scope '' for a command anyone proved may call
		 * @param {{ holder?: boolean }} [o] the device that paired the bridge: its scopes do not lapse
		 */
		async authorize(peer, scope, { holder = false } = {}) {
			await load();
			const g = grants.get(peer);
			if (!g) throw new UcepError('PAIRING_REQUIRED');
			const at = expiresAt(g, holder);
			if (at !== null && at < now()) {
				throw new UcepError(
					'GRANT_EXPIRED',
					'renew this device on the device that paired the bridge'
				);
			}
			if (scope && !g.scopes.includes(scope)) throw new UcepError('SCOPE_MISSING', scope);
			if (scope === 'bridge:llm') {
				const used = tokens.get(peer);
				if (used && used.day === today() && used.tokens >= limits.llmTokensPerDay) {
					throw new UcepError('RATE_LIMITED', LIMIT.llmTokensPerDay);
				}
				if (!within(llmCalls, peer, 60_000, limits.llmPerMinute)) {
					throw new UcepError('RATE_LIMITED', LIMIT.llmPerMinute);
				}
				llmCalls.get(peer)?.push(now());
			}
			if (scope === 'bridge:backup') {
				if (!within(backupCalls, peer, 60 * 60_000, limits.backupPerHour)) {
					throw new UcepError('RATE_LIMITED', LIMIT.backupPerHour);
				}
				backupCalls.get(peer)?.push(now());
			}
			if (now() - g.lastUsedAt > TOUCH_MS) {
				g.lastUsedAt = now();
				save().catch(() => {});
			}
		},

		/**
		 * What a call of the model cost, from its answer.
		 *
		 * @param {string} peer
		 * @param {unknown} answer the command's JSON
		 */
		spent(peer, answer) {
			const n = tokensIn(answer);
			if (!n) return;
			const day = today();
			const used = tokens.get(peer);
			tokens.set(peer, { day, tokens: (used?.day === day ? used.tokens : 0) + n });
		},

		/**
		 * Per device: scopes, last use and when they lapse – no content.
		 *
		 * @param {(peer: string) => boolean} [isHolder]
		 */
		async list(isHolder = () => false) {
			await load();
			return [...grants].map(([peerId, g]) => ({
				peerId,
				scopes: [...g.scopes],
				lastUsedAt: g.lastUsedAt || null,
				expiresAt: expiresAt(g, isHolder(peerId))
			}));
		},

		/** Tests: wait for the last write. */
		flushed: () => writing
	};
}
