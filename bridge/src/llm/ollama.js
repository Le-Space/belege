// Is Ollama there, and does it have the model? Asked at the bridge's start,
// in setup:llm and for /llm/status, so a missing Ollama is said with what to
// do – never a crash, never a model elsewhere instead.
//
// Ollama's own API (`GET /api/tags`, the models pulled) on the same origin as
// its OpenAI-compatible one. Only on this machine: the caller checks the URL
// is Ollama's (providers.js isOllamaUrl).

/** @typedef {'running' | 'unreachable' | 'model-missing'} OllamaState */

/**
 * @param {object} p
 * @param {string} p.baseUrl e.g. http://127.0.0.1:11434/v1
 * @param {string} p.model the model the bridge will ask
 * @param {typeof fetch} [p.fetch]
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{ state: OllamaState, model: string }>}
 */
export async function checkOllama({ baseUrl, model, fetch: f = fetch, timeoutMs = 3000 }) {
	let origin;
	try {
		origin = new URL(baseUrl).origin;
	} catch {
		return { state: 'unreachable', model };
	}
	/** @type {any} */
	let body;
	try {
		const res = await f(`${origin}/api/tags`, {
			redirect: 'error',
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) return { state: 'unreachable', model };
		body = await res.json();
	} catch {
		return { state: 'unreachable', model };
	}
	const names = Array.isArray(body?.models)
		? body.models.map((/** @type {any} */ m) => String(m?.name ?? m?.model ?? ''))
		: [];
	const wanted = model.includes(':') ? [model] : [model, `${model}:latest`];
	return { state: names.some((n) => wanted.includes(n)) ? 'running' : 'model-missing', model };
}

/**
 * What to do, in short steps, for the terminal (the app has its own, in i18n).
 *
 * @param {{ state: OllamaState, model: string }} check
 * @returns {string[]}
 */
export function ollamaSteps({ state, model }) {
	if (state === 'running') return [];
	if (state === 'model-missing') {
		return [
			`Ollama runs, but the model ${model} is not downloaded yet:`,
			`  ollama pull ${model}`,
			'Then restart the bridge (pnpm bridge).'
		];
	}
	return [
		'Ollama is not installed or not running on this computer (nothing answers on 127.0.0.1:11434).',
		'  1. Install it: https://ollama.com/download (on a Mac also: brew install --cask ollama)',
		`  2. Download the model: ollama pull ${model}`,
		'  3. Start Ollama (the app, or: ollama serve), then restart the bridge (pnpm bridge).',
		'Until then nothing is read with AI; no model on the internet is used instead. More: docs/ollama.md'
	];
}
