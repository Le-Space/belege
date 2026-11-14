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

/**
 * What the card shows of one kept integration: its non-secret values, and of
 * the secret part only whether it is kept.
 *
 * @typedef {{ id: string, fields: { key: string, value: string }[], secret: boolean }} KeptEntry
 */

/** A value to show: text or a number, one line, of a sane length; else nothing. @param {unknown} v */
function shown(v) {
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	if (typeof v !== 'string') return '';
	return v
		.replace(/\p{Cc}+/gu, ' ')
		.trim()
		.slice(0, 200);
}

/** An address without what could be a credential in it: no user, password, query or fragment. @param {unknown} v */
function shownUrl(v) {
	try {
		const url = new URL(String(v ?? ''));
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
		return shown(`${url.origin}${url.pathname === '/' ? '' : url.pathname}`);
	} catch {
		return '';
	}
}

/**
 * Which values of a kept section are not secret, by name: everything else –
 * every account's value, and any field not listed here – is never shown.
 *
 * @type {{ id: string, account: string, section?: string, fields?: (config: any) => Record<string, string> }[]}
 */
const SHOWN = [
	{
		id: 'mail',
		account: 'imap',
		section: 'mail',
		fields: (c) => ({
			host: shown(c.host),
			port: shown(c.port),
			user: shown(c.user),
			accountingAddress: shown(c.accountingAddress)
		})
	},
	{
		id: 'llm',
		account: 'llm',
		section: 'llm',
		fields: (c) => ({
			model: shown(c.model),
			itemHash: shown(c.tee?.itemHash),
			measurement: shown(c.tee?.measurement)
		})
	},
	{ id: 'kraken', account: 'kraken', section: 'kraken' },
	{
		id: 'paperless',
		account: 'paperless',
		section: 'paperless',
		fields: (c) => ({ baseUrl: shownUrl(c.baseUrl) })
	},
	{ id: 'enablebanking', account: 'enablebanking', section: 'enablebanking' },
	{ id: 'alchemy', account: 'alchemy' },
	{ id: 'coingecko', account: 'coingecko' },
	{ id: 'bitcoin', account: 'bitcoin' }
];

/**
 * What is kept, for the card: per integration its non-secret values and
 * whether its secret part is there. No secret, no file and no field that is
 * not named in `SHOWN` is in what this returns.
 *
 * @param {HostedSettings} kept
 * @returns {KeptEntry[]}
 */
export function keptView(kept) {
	const clean = cleanSettings(kept);
	/** @type {KeptEntry[]} */
	const out = [];
	for (const { id, account, section, fields } of SHOWN) {
		const config = section ? clean.config[section] : undefined;
		const secret = Object.hasOwn(clean.secrets, account);
		if (!config && !secret) continue;
		out.push({
			id,
			fields: Object.entries(config && fields ? fields(config) : {})
				.filter(([, value]) => value)
				.map(([key, value]) => ({ key, value })),
			secret
		});
	}
	return out;
}
