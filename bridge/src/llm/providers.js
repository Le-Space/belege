// Who a base URL sends text to, and where they are (decision of 2026-11-16):
// a model on this machine, or a provider on the internet with its country.
// setup:llm, the bridge's log and /llm/status name it this way, so a cloud
// model is never chosen without seeing whose it is and where it runs.
//
// The country is where the provider is based and runs the API, as the
// provider says; ISO 3166 alpha-2, the app turns it into a name.

/** @typedef {{ id: string, name: string, country: string | null, local: boolean }} Provider */

/** Providers on the internet the bridge knows by host. */
export const CLOUD_PROVIDERS = Object.freeze([
	{ id: 'deepseek', name: 'DeepSeek', hosts: ['api.deepseek.com'], country: 'CN' },
	{ id: 'openai', name: 'OpenAI', hosts: ['api.openai.com'], country: 'US' },
	{ id: 'mistral', name: 'Mistral AI', hosts: ['api.mistral.ai'], country: 'FR' },
	// The confidential model (#416) stays as it is: attested, see bridge/README.md "LLM".
	{ id: 'libertai', name: 'LibertAI', hosts: ['api.libertai.io'], country: null }
]);

/** Country names for the terminal (setup:llm, the log); the app names them in its own language. */
const COUNTRY_NAMES = /** @type {Record<string, string>} */ ({
	CN: 'China',
	US: 'United States',
	FR: 'France'
});

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/** Ollama's port (docs/ollama.md). */
export const OLLAMA_PORT = '11434';

/**
 * @param {string} baseUrl
 * @returns {Provider}
 */
export function providerOf(baseUrl) {
	let url;
	try {
		url = new URL(baseUrl);
	} catch {
		return { id: 'unknown', name: String(baseUrl ?? ''), country: null, local: false };
	}
	if (LOOPBACK.includes(url.hostname)) {
		return url.port === OLLAMA_PORT
			? { id: 'ollama', name: 'Ollama', country: null, local: true }
			: { id: 'local', name: url.host, country: null, local: true };
	}
	const known = CLOUD_PROVIDERS.find((p) =>
		p.hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
	);
	return known
		? { id: known.id, name: known.name, country: known.country, local: false }
		: { id: 'other', name: url.host, country: null, local: false };
}

/** A base URL that is Ollama on this machine. @param {string} baseUrl */
export const isOllamaUrl = (baseUrl) => providerOf(baseUrl).id === 'ollama';

/**
 * "DeepSeek – China", "Ollama (this computer)", "api.example.com – country unknown".
 *
 * @param {Provider} p
 */
export function providerLabel(p) {
	if (p.local) return `${p.name} (this computer)`;
	if (p.id === 'libertai') return p.name;
	return `${p.name} – ${p.country ? (COUNTRY_NAMES[p.country] ?? p.country) : 'country unknown'}`;
}
