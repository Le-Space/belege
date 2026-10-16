// The AI hints say "geschwärzt" only where it is true (#431): a model on the
// bridge's own computer gets the text as it is (#423), and its hints say so.
// Each such key has a twin `<key>Local`; `app.llmRedaction` picks one.
import { app } from './session.svelte.js';
import { t } from './i18n/index.js';

/**
 * @param {string} key a hint that mentions redaction, with a `<key>Local` twin
 * @param {Record<string, string | number>} [values]
 */
export function aiText(key, values) {
	return t(app.llmRedaction === false ? `${key}Local` : key, values);
}
