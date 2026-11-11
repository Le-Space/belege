// What a hosted bridge starts with besides its pairing (#728): the accounts
// it reads (mail, Enable Banking, Kraken, Alchemy, Paperless, CoinGecko, a
// Bitcoin zpub, portal passwords) and the integrations' non-secret settings.
// Kept in the books' sealed settings – typed in a card or taken over from the
// bridge on a computer – and handed only to an attested VM at its start,
// next to what pairing needs (hosted-bridge.js `hostedSecrets`).
//
// Not here: Hibiscus (it stays on the computer, a VM cannot reach it), the
// language model (a hosted bridge runs without one), and the bridge's own
// keys, origins and tokens.

/** The sealed settings record. */
export const HOSTED_SETTINGS_KEY = 'bridge/hosted-settings';

/** The accounts a hosted bridge reads (bridge/src/keychain.js, sort-secrets.mjs). */
const ACCOUNT =
	/^(?:imap|kraken|paperless|enablebanking|coingecko|bitcoin|alchemy|portal:[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The parts of bridge.json that belong to these integrations. */
export const SECTIONS = /** @type {const} */ ([
	'mail',
	'portals',
	'kraken',
	'paperless',
	'enablebanking'
]);

/** The bridge's own limit for one secret (keychain.js). */
const MAX_SECRET = 64 * 1024;

/**
 * @typedef {{ config: Record<string, Record<string, any>>, secrets: Record<string, string> }} HostedSettings
 */

/** @returns {HostedSettings} */
export const emptySettings = () => ({ config: {}, secrets: {} });

/** @param {unknown} v */
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

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
	if (isObject(r?.config)) {
		for (const section of SECTIONS) {
			const value = r.config[section];
			if (isObject(value)) out.config[section] = JSON.parse(JSON.stringify(value));
		}
	}
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
		secrets: { ...a.secrets, ...b.secrets }
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
