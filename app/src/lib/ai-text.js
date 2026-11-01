// The AI hints say "geschwärzt" only where it is true (#431): a model on the
// bridge's own computer gets the text as it is (#423), and so does one in an
// attested enclave (#416); their hints say so. Each such key has the twins
// `<key>Local` and `<key>Enclave`; `app.llmRedaction` picks one.
import { app } from './session.svelte.js';
import { t } from './i18n/index.js';

/**
 * @param {string} key a hint that mentions redaction, with `<key>Local` and `<key>Enclave` twins
 * @param {Record<string, string | number>} [values]
 */
export function aiText(key, values) {
	const twin =
		app.llmRedaction === false ? 'Local' : app.llmRedaction === 'enclave' ? 'Enclave' : '';
	return t(`${key}${twin}`, values);
}
