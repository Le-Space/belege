// Non-secret configuration: ~/.config/belege/bridge.json, mode 0600.
//
// Holds the Hibiscus host and port, the pinned certificate fingerprint, the
// IBAN suffixes that may leave the bridge, the app origins CORS lets in, the
// SHA-256 hashes of paired tokens (never a token), the mail server and the
// accounting address, the LLM provider's URL and models, and the terms to
// black out before text goes to it. No password, token or API key is here:
// they live in the macOS keychain (keychain.js).

import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_PORT = 8765;

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
 * @property {boolean} configured set by setup:llm once a key is in the keychain
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

/** @returns {LlmConfig} */
export function defaultLlmConfig() {
	return {
		baseUrl: 'https://api.deepseek.com',
		model: 'deepseek-flash',
		retryModel: 'deepseek-v4-pro',
		redactTerms: [],
		configured: false
	};
}

/** @returns {BridgeConfig} */
export function defaultConfig() {
	return {
		bridge: { port: DEFAULT_PORT },
		appOrigins: ['http://localhost:5173', 'https://belege.le-space.de'],
		hibiscus: { host: '127.0.0.1', port: 8080, certSha256: null, ibanSuffixes: [] },
		pairedTokens: [],
		mail: defaultMailConfig(),
		llm: defaultLlmConfig()
	};
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
		llm: {
			...d.llm,
			...(raw?.llm ?? {}),
			redactTerms: Array.isArray(raw?.llm?.redactTerms) ? raw.llm.redactTerms.map(String) : []
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
