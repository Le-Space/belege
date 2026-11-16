// Non-secret configuration: ~/.config/belege/bridge.json, mode 0600.
//
// Holds the Hibiscus host and port, the pinned certificate fingerprint, the
// IBAN suffixes that may leave the bridge, the app origins CORS lets in, the
// SHA-256 hashes of paired tokens (never a token), the mail server and the
// accounting address, the LLM provider's URL and models, the terms to
// black out before text goes to it, and a customer portal's user name. No password, token or API key is here:
// they live in the macOS keychain (keychain.js).

import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { DEFAULT_LIMITS, limitsOf } from './grants.js';
import { DEFAULT_LAN_RELAY_PORT } from './lan-relay-port.js';

export const DEFAULT_PORT = 8765;

/** A public name with a TLS WebSocket in front of the node's own: nothing else may be announced. */
export const ANNOUNCE =
	/^\/dns[46]?\/(?=.{1,253}\/)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+\/tcp\/([1-9]\d{0,4})\/tls\/ws$/;

export function defaultConfigPath() {
	return process.env.BELEGE_BRIDGE_CONFIG || join(homedir(), '.config', 'belege', 'bridge.json');
}

/**
 * @typedef {object} BridgeConfig
 * @property {{ port: number }} bridge
 * @property {string[]} appOrigins
 * @property {{ host: string, port: number, certSha256: string | null, ibanSuffixes: string[] }} hibiscus
 * @property {{ hash: string, createdAt: string }[]} pairedTokens
 * @property {MailConfig} mail
 * @property {LlmConfig} llm
 * @property {Record<string, import('./portals/index.js').PortalConfig>} portals customer portals, by id
 * @property {KrakenConfig} kraken
 * @property {PaperlessConfig} paperless
 * @property {EnableBankingConfig} enablebanking
 * @property {{ configured: boolean }} alephBackup set by setup:aleph once the backup key is in
 *   the keychain (aleph-backup.js, issue #77)
 * @property {LanRelayConfig} lanRelay
 * @property {NodeConfig} node the bridge's own libp2p node (node.js, #573)
 */

/**
 * @typedef {object} NodeConfig
 * @property {boolean} enabled off: no node, HTTP only
 * @property {string[]} relays the relays the books use, from the handover
 * @property {string[]} devices the books' devices (peer ids), from the handover and `devices`
 * @property {number} wsPort the WebSocket on 127.0.0.1 for the browser on this machine; 0 picks one
 * @property {string[]} announce public WebSocket addresses a proxy in front of that WebSocket
 *   serves, `/dns4/<host>/tcp/443/tls/ws` (the hosted VM's Caddy, #583); announced besides the relays
 * @property {import('./grants.js').Limits} limits per device: the model's calls and tokens, backups, and when unused scopes lapse (grants.js)
 */

/**
 * @typedef {object} LanRelayConfig the relay for own devices in the own network (lan-relay.js)
 * @property {string | null} host an IPv4 address of this Mac in the private network; null: off
 * @property {number} port UDP
 */

/**
 * @typedef {object} KrakenConfig
 * @property {boolean} configured set by setup:kraken once a key is in the keychain
 * @property {string} baseUrl https://api.kraken.com; tests point it at a fake on 127.0.0.1
 */

/**
 * @typedef {object} PaperlessConfig a Paperless-ngx as a receipt source (paperless.js, issue #318)
 * @property {boolean} configured set by setup:paperless once the API token is in the keychain
 * @property {string} baseUrl on this machine (http on loopback) or https; never a LAN address over http
 */

/**
 * @typedef {object} EnableBankingConfig the own Enable Banking application (issue #224)
 * @property {boolean} configured set by setup:enablebanking once the key is sealed
 * @property {string | null} appId the application id; not secret
 * @property {string} baseUrl https://api.enablebanking.com; tests point it at a fake on 127.0.0.1
 * @property {string} redirectUrl as registered for the application: the app's page
 * @property {string[]} ibanSuffixes accounts whose IBAN ends so may leave the bridge (setup --accounts)
 */

/**
 * @typedef {object} MailConfig
 * @property {string | null} host
 * @property {number} port
 * @property {string | null} user
 * @property {'implicit' | 'starttls' | 'none'} tls `none` only for a server on this machine (tests)
 * @property {string} accountingAddress the alias receipts are sent to
 * @property {string | null} authServId when set, only `Authentication-Results` of this server count
 */

/**
 * @typedef {object} LlmConfig
 * @property {string} baseUrl OpenAI-compatible, `…/chat/completions` is appended
 * @property {string} model
 * @property {string} retryModel
 * @property {string[]} redactTerms blacked out before any text leaves (own name, family names)
 * @property {'auto' | 'on' | 'off'} redaction whether text is blacked out before it goes to the
 *   model (#423): `off` only for a loopback base URL whose model setup:llm was told runs on this
 *   machine; `auto` (not asked yet, e.g. a config from before #423) and `on` black out
 * @property {boolean} configured set by setup:llm once a key is in the keychain
 * @property {import('./llm/confidential.js').TeePin | null} tee a confidential model (#416): the
 *   enclave setup:llm pinned; every request goes to it, attested, or fails – never to the gateway
 * @property {string | null} cloudOnPurpose when the person chose a provider on the internet on
 *   purpose (setup:llm, or the question about the old DeepSeek default: llm/default-choice.js);
 *   null: never chosen, so a DeepSeek from the old default is asked about once
 */

export const DEFAULT_ACCOUNTING_ADDRESS = 'buchhaltung@le-space.de';

/** @returns {MailConfig} */
export function defaultMailConfig() {
	return {
		host: null,
		port: 993,
		user: null,
		tls: 'implicit',
		accountingAddress: DEFAULT_ACCOUNTING_ADDRESS,
		authServId: null
	};
}

/** Ollama on this machine, OpenAI-compatible (docs/ollama.md): the default model since 2026-11-16. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
/**
 * The default model: Qwen3 4B Instruct 2507, 4-bit (2.5 GB). Answers JSON
 * without "thinking" first, reads German, English and other languages, and
 * runs on a laptop with 16 GB. The 30B one in docs/ollama.md reads better
 * but needs 32 GB; setup:llm offers to name it instead.
 */
export const OLLAMA_DEFAULT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

/** What was the default until 2026-11-16 (DeepSeek, China): a config that still has it is asked once. */
export const OLD_DEFAULT_LLM = Object.freeze({
	baseUrl: 'https://api.deepseek.com',
	model: 'deepseek-flash',
	retryModel: 'deepseek-v4-pro'
});

/** @returns {LlmConfig} */
export function defaultLlmConfig() {
	return {
		baseUrl: OLLAMA_BASE_URL,
		model: OLLAMA_DEFAULT_MODEL,
		retryModel: OLLAMA_DEFAULT_MODEL,
		redactTerms: [],
		redaction: 'auto',
		configured: false,
		tee: null,
		cloudOnPurpose: null
	};
}

/**
 * The llm section as stored, with today's defaults. A config never set up
 * (`configured` false) that still holds the old default (written by a bridge
 * before 2026-11-16) gets the new one: nobody chose DeepSeek there.
 *
 * @param {any} raw the stored `llm` section
 * @returns {LlmConfig}
 */
function llmOf(raw) {
	const d = defaultLlmConfig();
	const stored = raw && typeof raw === 'object' ? { ...raw } : {};
	if (stored.configured !== true && stored.baseUrl === OLD_DEFAULT_LLM.baseUrl) {
		delete stored.baseUrl;
		if (stored.model === OLD_DEFAULT_LLM.model) delete stored.model;
		if (stored.retryModel === OLD_DEFAULT_LLM.retryModel) delete stored.retryModel;
	}
	return {
		...d,
		...stored,
		redactTerms: Array.isArray(stored.redactTerms) ? stored.redactTerms.map(String) : [],
		redaction: ['auto', 'on', 'off'].includes(stored.redaction) ? stored.redaction : 'auto',
		tee: teePinOf(stored.tee),
		cloudOnPurpose:
			typeof stored.cloudOnPurpose === 'string' && stored.cloudOnPurpose
				? stored.cloudOnPurpose
				: null
	};
}

/** A pin as setup:llm writes it, or null. @param {any} raw @returns {import('./llm/confidential.js').TeePin | null} */
function teePinOf(raw) {
	if (!raw || raw.provider !== 'libertai') return null;
	if (
		!/^[0-9a-f]{64}$/.test(String(raw.itemHash)) ||
		!/^[0-9a-f]{32,}$/i.test(String(raw.measurement))
	)
		return null;
	return {
		provider: 'libertai',
		itemHash: String(raw.itemHash),
		measurement: String(raw.measurement),
		sourceCommit: typeof raw.sourceCommit === 'string' ? raw.sourceCommit : null,
		pinnedAt: String(raw.pinnedAt ?? '')
	};
}

/** A base URL on this machine. @param {string} baseUrl */
export function isLoopbackUrl(baseUrl) {
	try {
		return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname);
	} catch {
		return false;
	}
}

/**
 * Whether the bridge sends text as it is (#423): a model on this machine sees
 * nothing leave it, and redaction would only cost reading quality.
 *
 * Only when setup:llm was told so (`off`) and one of two holds:
 *   - the base URL is loopback – a loopback URL may also be a proxy that
 *     forwards to a provider, so setup:llm asks whether the model runs here;
 *   - a confidential model is pinned (`tee`, #416): every request goes to the
 *     attested enclave and its TLS ends inside it; setup:llm asks whether to
 *     black out anyway, and the default is not to.
 * A config from before #423 has no answer (`auto`) and blacks out until
 * setup:llm asks; `off` with any other URL blacks out too.
 *
 * @param {Pick<LlmConfig, 'baseUrl' | 'redaction'> & { tee?: LlmConfig['tee'] }} llm
 */
export function redactionOff(llm) {
	return llm.redaction === 'off' && (isLoopbackUrl(llm.baseUrl) || Boolean(llm.tee));
}

/** Text unredacted because it goes into an attested enclave, not to this machine. @param {Pick<LlmConfig, 'baseUrl' | 'redaction' | 'tee'>} llm */
export const redactionOffForEnclave = (llm) =>
	redactionOff(llm) && Boolean(llm.tee) && !isLoopbackUrl(llm.baseUrl);

/** @returns {BridgeConfig} */
export function defaultConfig() {
	return {
		bridge: { port: DEFAULT_PORT },
		appOrigins: ['http://localhost:5173', 'https://belege.le-space.de'],
		hibiscus: { host: '127.0.0.1', port: 8080, certSha256: null, ibanSuffixes: [] },
		pairedTokens: [],
		mail: defaultMailConfig(),
		llm: defaultLlmConfig(),
		portals: {},
		kraken: { configured: false, baseUrl: 'https://api.kraken.com' },
		paperless: { configured: false, baseUrl: 'http://127.0.0.1:8000' },
		enablebanking: {
			configured: false,
			appId: null,
			baseUrl: 'https://api.enablebanking.com',
			redirectUrl: 'https://belege.le-space.de/integrationen/bank/verbunden',
			ibanSuffixes: []
		},
		alephBackup: { configured: false },
		lanRelay: { host: null, port: DEFAULT_LAN_RELAY_PORT },
		node: {
			enabled: true,
			relays: [],
			devices: [],
			wsPort: 0,
			announce: [],
			limits: { ...DEFAULT_LIMITS }
		}
	};
}

/**
 * Kraken's API over https, or a fake on this machine (tests). Anything else is ignored.
 *
 * @param {unknown} value
 */
function krakenBaseUrl(value) {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
		return url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
			? value.replace(/\/+$/, '')
			: null;
	} catch {
		return null;
	}
}

/**
 * Where Paperless-ngx answers: https, or http on this machine – never plain http
 * to another host in the network. No credentials in it; a path prefix may stay.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function paperlessBaseUrl(value) {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value.trim());
		const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
		if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) return null;
		if (url.username || url.password || url.search || url.hash) return null;
		return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
	} catch {
		return null;
	}
}

/**
 * A redirect URL: https, or http on this machine (a local app, tests).
 *
 * @param {unknown} value
 */
export function redirectUrlOf(value) {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value.trim());
		const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
		return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
			!url.username &&
			!url.password &&
			!url.hash
			? url.href
			: null;
	} catch {
		return null;
	}
}

/**
 * @param {any} raw
 * @returns {BridgeConfig}
 */
export function withDefaults(raw) {
	const d = defaultConfig();
	return {
		bridge: { ...d.bridge, ...(raw?.bridge ?? {}) },
		appOrigins: Array.isArray(raw?.appOrigins) ? raw.appOrigins.map(String) : d.appOrigins,
		hibiscus: {
			...d.hibiscus,
			...(raw?.hibiscus ?? {}),
			ibanSuffixes: Array.isArray(raw?.hibiscus?.ibanSuffixes)
				? raw.hibiscus.ibanSuffixes.map(String)
				: []
		},
		pairedTokens: Array.isArray(raw?.pairedTokens) ? raw.pairedTokens : [],
		mail: { ...d.mail, ...(raw?.mail ?? {}) },
		llm: llmOf(raw?.llm),
		portals:
			raw?.portals && typeof raw.portals === 'object' && !Array.isArray(raw.portals)
				? raw.portals
				: {},
		kraken: {
			configured: raw?.kraken?.configured === true,
			baseUrl: krakenBaseUrl(raw?.kraken?.baseUrl) ?? d.kraken.baseUrl
		},
		paperless: {
			configured: raw?.paperless?.configured === true,
			baseUrl: paperlessBaseUrl(raw?.paperless?.baseUrl) ?? d.paperless.baseUrl
		},
		enablebanking: {
			configured: raw?.enablebanking?.configured === true,
			appId:
				typeof raw?.enablebanking?.appId === 'string' &&
				/^[0-9a-f-]{36}$/i.test(raw.enablebanking.appId)
					? raw.enablebanking.appId
					: null,
			// The same rule as Kraken's: https, or a fake on this machine.
			baseUrl: krakenBaseUrl(raw?.enablebanking?.baseUrl) ?? d.enablebanking.baseUrl,
			redirectUrl: redirectUrlOf(raw?.enablebanking?.redirectUrl) ?? d.enablebanking.redirectUrl,
			ibanSuffixes: Array.isArray(raw?.enablebanking?.ibanSuffixes)
				? raw.enablebanking.ibanSuffixes.map(String).filter((s) => /^[0-9A-Z]{4,34}$/.test(s))
				: []
		},
		alephBackup: { configured: raw?.alephBackup?.configured === true },
		lanRelay: {
			host:
				typeof raw?.lanRelay?.host === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(raw.lanRelay.host)
					? raw.lanRelay.host
					: null,
			port:
				Number.isInteger(raw?.lanRelay?.port) &&
				raw.lanRelay.port >= 1024 &&
				raw.lanRelay.port <= 65535
					? raw.lanRelay.port
					: d.lanRelay.port
		},
		node: {
			enabled: raw?.node?.enabled !== false,
			relays: Array.isArray(raw?.node?.relays)
				? raw.node.relays.map(String).filter((r) => /\/p2p\/12D3KooW/.test(r))
				: [],
			devices: Array.isArray(raw?.node?.devices)
				? raw.node.devices.map(String).filter((p) => /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/.test(p))
				: [],
			wsPort:
				Number.isInteger(raw?.node?.wsPort) && raw.node.wsPort >= 0 && raw.node.wsPort <= 65535
					? raw.node.wsPort
					: 0,
			announce: Array.isArray(raw?.node?.announce)
				? raw.node.announce.map(String).filter((a) => ANNOUNCE.test(a))
				: [],
			limits: limitsOf(raw?.node?.limits)
		}
	};
}

/**
 * @param {string} [path]
 * @returns {Promise<BridgeConfig>}
 */
export async function loadConfig(path = defaultConfigPath()) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch (/** @type {any} */ error) {
		if (error.code === 'ENOENT') return defaultConfig();
		throw error;
	}
	if (process.platform !== 'win32') {
		const { mode } = await stat(path);
		if (mode & 0o077) {
			// Someone loosened it; tighten again rather than refuse.
			await chmod(path, 0o600);
		}
	}
	return withDefaults(JSON.parse(text));
}

/**
 * Written to a temporary file and renamed, so a crash never leaves half a file.
 *
 * @param {BridgeConfig} config
 * @param {string} [path]
 */
export async function saveConfig(config, path = defaultConfigPath()) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	await chmod(tmp, 0o600);
	await rename(tmp, path);
}
