// DeepSeek (China) was the bridge's default language model until 2026-11-16;
// since then it is a model on this computer, with Ollama. A bridge whose
// config still has DeepSeek may have it only because it was the default, so
// it is asked once: switch to the local model, or keep DeepSeek on purpose.
// The answer is kept in the bridge's config (`llm.cloudOnPurpose`), never in
// the browser. setup:llm, the bridge's start and the app's KI page ask.

import { OLLAMA_BASE_URL, OLLAMA_DEFAULT_MODEL } from '../config.js';
import { providerOf } from './providers.js';

/**
 * Whether to ask: DeepSeek is set up, not in an enclave, and nobody has said
 * it is wanted.
 *
 * @param {import('../config.js').LlmConfig} llm
 */
export function needsDefaultQuestion(llm) {
	return (
		llm.configured === true &&
		!llm.tee &&
		!llm.cloudOnPurpose &&
		providerOf(llm.baseUrl).id === 'deepseek'
	);
}

/**
 * The local model instead. Redaction stays on (`auto`) until setup:llm is
 * told the model runs on this machine, as for any model on 127.0.0.1 (#423);
 * the terms are kept. A stored API key stays in the keychain for later.
 *
 * @param {import('../config.js').LlmConfig} llm
 * @returns {import('../config.js').LlmConfig}
 */
export function switchToLocal(llm) {
	return {
		...llm,
		baseUrl: OLLAMA_BASE_URL,
		model: OLLAMA_DEFAULT_MODEL,
		retryModel: OLLAMA_DEFAULT_MODEL,
		redaction: 'auto',
		tee: null,
		cloudOnPurpose: null
	};
}

/**
 * DeepSeek kept, on purpose: not asked again.
 *
 * @param {import('../config.js').LlmConfig} llm
 * @param {string} at ISO time of the answer
 * @returns {import('../config.js').LlmConfig}
 */
export function keepCloud(llm, at) {
	return { ...llm, cloudOnPurpose: at };
}

/** The question, for the terminal. */
export const DEFAULT_QUESTION = [
	'DeepSeek (China) is set up as the language model – it was the default until now.',
	'The default is now a model on this computer (Ollama): no receipt text leaves it.'
];

/**
 * The answer from the app (`POST /llm/choice`): written into the config and
 * saved; the switch takes effect at the bridge's next start.
 *
 * @param {object} p
 * @param {import('../config.js').BridgeConfig} p.config the running bridge's config, changed in place
 * @param {() => Promise<void>} p.save writes the config
 * @param {() => string} [p.now]
 * @param {(line: string) => void} [p.log]
 * @returns {(answer: 'local' | 'keep') => Promise<boolean>} false when nothing was asked
 */
export function createLlmChoice({
	config,
	save,
	now = () => new Date().toISOString(),
	log = () => {}
}) {
	return async (answer) => {
		if (!needsDefaultQuestion(config.llm)) return false;
		config.llm = answer === 'local' ? switchToLocal(config.llm) : keepCloud(config.llm, now());
		await save();
		log(
			answer === 'local'
				? 'Switched to Ollama on this computer: restart the bridge to use it.'
				: 'DeepSeek kept on purpose.'
		);
		return true;
	};
}
