// Whose language model the bridge uses, and where (/llm/status `providerInfo`):
// "DeepSeek – China", "Ollama – on this computer". The country comes from the
// bridge as an ISO 3166 code and is named in the reader's language.
import { list as listOf, t } from '../i18n/index.js';

/**
 * A country's name in a language; the code itself where the browser has none.
 *
 * @param {string} code ISO 3166 alpha-2
 * @param {string} locale
 */
export function countryName(code, locale) {
	try {
		return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
	} catch {
		return code;
	}
}

/**
 * The provider as people read it, or null when the bridge does not say (an older one).
 *
 * @param {any} status what `/llm/status` answered
 * @param {string} locale
 * @returns {string | null}
 */
export function providerText(status, locale) {
	const p = status?.providerInfo;
	if (!p || typeof p.name !== 'string') return null;
	if (p.local) return t('integrationen.ki.providerLocal', { name: p.name });
	// LibertAI's confidential model stays as it is: its enclave is shown beside it.
	if (p.id === 'libertai') return p.name;
	return typeof p.country === 'string' && p.country
		? t('integrationen.ki.providerCountry', {
				name: p.name,
				country: countryName(p.country, locale)
			})
		: t('integrationen.ki.providerCountryUnknown', { name: p.name });
}

/**
 * What to do when Ollama is missing, as steps, or null when it runs (or is not the model).
 *
 * @param {any} status what `/llm/status` answered
 * @returns {{ message: string, steps: string[] } | null}
 */
export function ollamaHelp(status) {
	const o = status?.ollama;
	if (!o || o.state === 'running') return null;
	const model = String(o.model ?? '');
	const fill = (/** @type {string} */ s) => s.replaceAll('{model}', model);
	const missing = o.state === 'model-missing';
	return {
		message: missing
			? t('integrationen.ki.ollamaMissing.modelMissing', { model })
			: t('integrationen.ki.ollamaMissing.unreachable'),
		steps: listOf(
			missing ? 'integrationen.ki.ollamaMissing.stepsModel' : 'integrationen.ki.ollamaMissing.steps'
		).map((s) => fill(String(s)))
	};
}
