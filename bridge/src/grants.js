// What each device of the books may do with this bridge over the stream
// (Le-Space/belege#579, M2). The node's gate decides who gets in (node.js);
// this decides what a device that got in may call.
//
// Scopes. Every command of commands.js names the scope it needs
// (`bridge:bank:read`, `bridge:llm`, …). A device holds a set of them. A
// device the books list without saying which scopes – every device paired
// before #579, and one added without a choice – holds all of them: what it
// could do before, it can do now. A device added in the app with boxes ticked
// comes as `{ peerId, initial }`: a device new to the bridge gets those, one
// it knows keeps what it holds. Nothing more is granted by itself; a
// device that is not on the books' list holds nothing. The device that paired
// the bridge, or the bridge's owner over HTTP, sets one device's scopes
// (`device.scopes`, commands.js): a subset of those offered, kept until set
// again – telling the device list again keeps them.
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
//
// Usage (#579, item 7). Per device and command: how often it was let through,
// how often refused, and when last – for the Geräte card. Command names,
// counts and times only; never an argument, an answer or an error's text. It
// goes with the device's grant, and is written at most once a minute (and at
// stop), so a call is no file write.

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

/**
 * Scopes only the device that paired the bridge holds, whatever the list
 * says: handing the bridge's settings to a hosted bridge (#728) gives away
 * its accounts' secrets, and setting what each device may call would let a
 * device widen its own – so a member's device or any other device may not.
 * No list grants or takes them: the device that paired the bridge cannot
 * lock itself out of managing it.
 */
export const HOLDER_ONLY = new Set(['bridge:settings:export', 'bridge:grants:manage']);

/**
 * The scopes a device's set is made of: those offered, but the holder's own.
 *
 * @param {string[]} all what the bridge offers (scopesOf)
 */
export const settableOf = (all) => all.filter((s) => !HOLDER_ONLY.has(s));

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
/** A command's name as the catalogue has it (`mail.search`). */
const COMMAND = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;
/** At most this many commands are counted per device: the catalogue has fewer. */
const MAX_COMMANDS = 100;
/** Usage is written at most this often. */
const USAGE_SAVE_MS = 60_000;
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
 * The books' device list as a device sends it: a peer id alone (what the
 * device holds; all scopes for a new one, as before #579),
 * `{ peerId, scopes }` (exactly these), or `{ peerId, initial }` (what the
 * device was given when it was added to the books: these for a device new
 * to the bridge, what it holds for one it knows).
 *
 * @param {unknown} list
 * @param {string[]} all the scopes the bridge offers
 * @returns {Map<string, Wanted>} peer id → what it is to hold
 */
export function parseDevices(list, all) {
	if (!Array.isArray(list) || list.length > 64) {
		throw new UcepError('INVALID_ARGUMENTS', 'devices must be up to 64 entries');
	}
	/** @type {Map<string, Wanted>} */
	const out = new Map();
	for (const entry of list) {
		if (typeof entry === 'string' && PEER_ID.test(entry)) {
			out.set(entry, null);
			continue;
		}
		const peerId = /** @type {any} */ (entry)?.peerId;
		const initial = /** @type {any} */ (entry)?.initial;
		const scopes = initial ?? /** @type {any} */ (entry)?.scopes;
		if (
			typeof peerId !== 'string' ||
			!PEER_ID.test(peerId) ||
			!Array.isArray(scopes) ||
			scopes.length > 32 ||
			!scopes.every((s) => typeof s === 'string' && SCOPE.test(s))
		) {
			throw new UcepError(
				'INVALID_ARGUMENTS',
				'a device is a peer id, { peerId, scopes } or { peerId, initial }'
			);
		}
		// A scope the bridge does not offer is dropped, not kept for later. What
		// a device starts with never holds what only the holder holds.
		const offered = initial ? settableOf(all) : all;
		const kept = [...new Set(scopes)].filter((s) => offered.includes(s)).sort();
		out.set(peerId, initial ? { initial: kept } : kept);
	}
	return out;
}

/**
 * What a device is to hold: these scopes; null: as held, all for a new
 * device; `{ initial }`: these for a device new to the bridge, as held for one
 * it knows.
 *
 * @typedef {string[] | null | { initial: string[] }} Wanted
 */

/**
 * @typedef {object} Use
 * @property {number} calls let through
 * @property {number} refused refused by scope, expiry or limit
 * @property {number} lastAt
 */

/**
 * @typedef {object} Grant
 * @property {string[]} scopes
 * @property {number} grantedAt
 * @property {number} lastUsedAt
 * @property {Record<string, Use>} [usage] per command name
 */

/** @param {unknown} n */
const count = (n) =>
	Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0 ? /** @type {number} */ (n) : 0;

/**
 * A device's usage as the file had it: known shapes only, so an edited file
 * brings nothing else back.
 *
 * @param {unknown} raw
 * @returns {Record<string, Use>}
 */
export function usageOf(raw) {
	/** @type {Record<string, Use>} */
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [name, u] of Object.entries(raw).slice(0, MAX_COMMANDS)) {
		if (!COMMAND.test(name) || !u || typeof u !== 'object') continue;
		const use = /** @type {any} */ (u);
		out[name] = { calls: count(use.calls), refused: count(use.refused), lastAt: count(use.lastAt) };
	}
	return out;
}

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
	/** @type {ReturnType<typeof setTimeout> | null} usage waiting to be written */
	let usageTimer = null;

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
					lastUsedAt: Number(g.lastUsedAt) || 0,
					usage: usageOf(g.usage)
				});
			}
		} catch {
			// No file yet: every device the books list holds what it held before.
		}
	}

	function save() {
		if (usageTimer) {
			clearTimeout(usageTimer);
			usageTimer = null;
		}
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
		 * again renews nothing. A device without scopes (null) keeps what it
		 * holds; a new one gets every scope. `{ initial }` is for a new device
		 * only: one the bridge knows keeps what it holds.
		 *
		 * @param {Map<string, Wanted>} devices
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
			for (const [peer, wanted] of devices) {
				const had = grants.get(peer);
				if (had && (wanted === null || !Array.isArray(wanted))) continue;
				const scopes = wanted === null ? [...all] : Array.isArray(wanted) ? wanted : wanted.initial;
				if (had && had.scopes.join(' ') === scopes.join(' ')) continue;
				grants.set(peer, {
					scopes,
					grantedAt: now(),
					lastUsedAt: had?.lastUsedAt ?? 0,
					usage: had?.usage ?? {}
				});
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
				grants.set(peer, { scopes: [...all], grantedAt: now(), lastUsedAt: 0, usage: {} });
				changed = true;
			}
			if (changed) await save();
		},

		/**
		 * One device's scopes, as the device that paired the bridge or the
		 * owner over HTTP ticked them: a subset of those offered, the holder's
		 * own (HOLDER_ONLY) not among them. An unknown name is refused, not
		 * dropped: the caller should know it set less than it asked.
		 *
		 * @param {string} peer a device with a grant
		 * @param {unknown} scopes
		 * @returns {Promise<string[]>} the scopes it holds now
		 */
		async setScopes(peer, scopes) {
			await load();
			const settable = settableOf(all);
			if (
				!Array.isArray(scopes) ||
				scopes.length > 32 ||
				!scopes.every((s) => typeof s === 'string' && settable.includes(s))
			) {
				throw new UcepError(
					'INVALID_ARGUMENTS',
					`scopes must be some of: ${settable.join(', ')}`.slice(0, 500)
				);
			}
			const g = grants.get(peer);
			if (!g) throw new UcepError('INVALID_ARGUMENTS', 'peerId must be a device of the books');
			const next = [...new Set(/** @type {string[]} */ (scopes))].sort();
			// What only the holder holds stays as it was in the list: authorize does not read it.
			const kept = g.scopes.filter((s) => HOLDER_ONLY.has(s));
			const want = [...new Set([...next, ...kept])].sort();
			if (want.join(' ') !== g.scopes.join(' ')) {
				g.scopes = want;
				g.grantedAt = now();
				await save();
			}
			return next;
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
			if (HOLDER_ONLY.has(scope)) {
				if (!holder) throw new UcepError('SCOPE_MISSING', scope);
			} else if (scope && !g.scopes.includes(scope)) {
				throw new UcepError('SCOPE_MISSING', scope);
			}
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
		 * One call of a command by a device, let through or refused: counted,
		 * by the command's name only. Written within a minute.
		 *
		 * @param {string} peer
		 * @param {string} command its name (`mail.search`)
		 * @param {boolean} ok let through
		 */
		record(peer, command, ok) {
			const g = grants.get(peer);
			if (!g || !COMMAND.test(command)) return;
			const usage = (g.usage ??= {});
			if (!usage[command] && Object.keys(usage).length >= MAX_COMMANDS) return;
			const use = (usage[command] ??= { calls: 0, refused: 0, lastAt: 0 });
			if (ok) use.calls++;
			else use.refused++;
			use.lastAt = now();
			if (!usageTimer) {
				usageTimer = setTimeout(() => {
					usageTimer = null;
					save().catch(() => {});
				}, USAGE_SAVE_MS);
				usageTimer.unref?.();
			}
		},

		/** Usage not yet written goes to the file now (at stop). */
		async flush() {
			if (usageTimer) await save().catch(() => {});
			await writing.catch(() => {});
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
				expiresAt: expiresAt(g, isHolder(peerId)),
				// Per command, the most recent first: name, counts, time – no content.
				usage: Object.entries(g.usage ?? {})
					.map(([command, u]) => ({ command, ...u }))
					.sort((a, b) => b.lastAt - a.lastAt || a.command.localeCompare(b.command))
			}));
		},

		/** Tests: wait for the last write. */
		flushed: () => writing
	};
}
