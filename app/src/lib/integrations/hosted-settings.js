// What a hosted bridge starts with besides its pairing (#728): the accounts
// it reads (mail, Enable Banking, Kraken, Alchemy, Paperless, CoinGecko, a
// Bitcoin zpub) and the integrations' non-secret settings.
// Kept in the books' sealed settings – typed in a card or taken over from the
// bridge on a computer – and handed only to an attested VM at its start,
// next to what pairing needs (hosted-bridge.js `hostedSecrets`).
//
// The language model only in LibertAI's attested enclave, pinned by
// setup:llm on the computer (#754): taken over, never typed in here.
//
// Not here: Hibiscus (it stays on the computer, a VM cannot reach it), any
// other language model, portal passwords (a hosted image has no browser to
// log in with), and the bridge's own keys, origins and tokens.

/** The sealed settings record. */
export const HOSTED_SETTINGS_KEY = 'bridge/hosted-settings';

/** The accounts a hosted bridge reads (bridge/src/keychain.js, sort-secrets.mjs). */
const ACCOUNT = /^(?:imap|llm|kraken|paperless|enablebanking|coingecko|bitcoin|alchemy)$/;

/** The parts of bridge.json that belong to these integrations. */
export const SECTIONS = /** @type {const} */ ([
	'mail',
	'llm',
	'kraken',
	'paperless',
	'enablebanking'
]);

/** The bridge's own limit for one secret (keychain.js). */
const MAX_SECRET = 64 * 1024;

/** Files a hosted bridge reads beside bridge.json, sealed already (sort-secrets.mjs, belege-bridge-run). */
const FILES = /** @type {const} */ (['enablebanking_sealed']);
const MAX_FILE = 1024 * 1024;

/**
 * @typedef {{ config: Record<string, Record<string, any>>, secrets: Record<string, string>, files: Record<string, string> }} HostedSettings
 */

/** @returns {HostedSettings} */
export const emptySettings = () => ({ config: {}, secrets: {}, files: {} });

/** @param {unknown} v */
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * A model in LibertAI's attested enclave, pinned (bridge/src/config.js
 * `teePinOf`; the VM checks the same in sort-secrets.mjs `enclaveLlm`).
 *
 * @param {any} llm
 */
export function isEnclaveLlm(llm) {
	const tee = llm?.tee;
	if (!tee || tee.provider !== 'libertai') return false;
	if (!/^[0-9a-f]{64}$/.test(String(tee.itemHash))) return false;
	if (!/^[0-9a-f]{32,}$/i.test(String(tee.measurement))) return false;
	try {
		const base = new URL(String(llm.baseUrl));
		return base.protocol === 'https:' && base.hostname === 'api.libertai.io';
	} catch {
		return false;
	}
}

/**
 * Only what a hosted bridge reads, checked: known accounts with text of a
 * sane size, and the known sections of bridge.json as objects.
 *
 * @param {unknown} raw
 * @returns {HostedSettings}
 */
export function cleanSettings(raw) {
	const out = emptySettings();
	const r = /** @type {any} */ (raw);
	if (isObject(r?.secrets)) {
		for (const [account, value] of Object.entries(r.secrets)) {
			if (!ACCOUNT.test(account)) continue;
			if (typeof value !== 'string' || !value || value.length > MAX_SECRET) continue;
			out.secrets[account] = value;
		}
	}
	if (isObject(r?.files)) {
		for (const name of FILES) {
			const value = r.files[name];
			if (typeof value === 'string' && value && value.length <= MAX_FILE) out.files[name] = value;
		}
	}
	if (isObject(r?.config)) {
		for (const section of SECTIONS) {
			const value = r.config[section];
			if (isObject(value)) out.config[section] = JSON.parse(JSON.stringify(value));
		}
	}
	// A model only in the attested enclave, and its key only beside it (#754).
	if (out.config.llm && !isEnclaveLlm(out.config.llm)) delete out.config.llm;
	if (!out.config.llm) delete out.secrets.llm;
	return out;
}

/**
 * `b` over `a`: a section or an account in `b` replaces the one in `a`.
 *
 * @param {HostedSettings} a @param {HostedSettings} b
 * @returns {HostedSettings}
 */
export const mergeSettings = (a, b) =>
	cleanSettings({
		config: { ...a.config, ...b.config },
		secrets: { ...a.secrets, ...b.secrets },
		files: { ...a.files, ...b.files }
	});

/** The file a hosted bridge reads an account from (keychain.js `secretFileOf`). @param {string} account */
export const secretFileOf = (account) => account.toLowerCase().replace(/[^a-z0-9_]/g, '_');

/**
 * What the VM starts with: the pairing's secrets with the kept accounts
 * added, and the kept sections in `bridge_config` beside the pairing's
 * `node` (which stays the pairing's).
 *
 * @param {Record<string, string>} secrets from `hostedSecrets`
 * @param {HostedSettings} kept
 * @returns {Record<string, string>}
 */
export function withHostedSettings(secrets, kept) {
	const clean = cleanSettings(kept);
	/** @type {Record<string, string>} */
	const out = { ...secrets };
	for (const [account, value] of Object.entries(clean.secrets)) {
		out[secretFileOf(account)] = value;
	}
	for (const [name, value] of Object.entries(clean.files)) out[name] = value;
	let config = {};
	try {
		const parsed = JSON.parse(secrets.bridge_config ?? '{}');
		if (isObject(parsed)) config = parsed;
	} catch {
		config = {};
	}
	out.bridge_config = JSON.stringify({ ...clean.config, ...config });
	return out;
}

/**
 * What is kept, by name only, for the cards: never a value.
 *
 * @param {HostedSettings} kept
 * @returns {{ accounts: string[], sections: string[] }}
 */
export function keptNames(kept) {
	const clean = cleanSettings(kept);
	return {
		accounts: Object.keys(clean.secrets).sort(),
		sections: Object.keys(clean.config).sort()
	};
}
