// What an integration's help shows beside its two sentences (issue #200, step
// 4): the setup command for the terminal, where there is one, and the page of
// the docs. Texts are `integrationen.help.<id>.what` / `.how` in the catalogue.

const REPO = 'https://github.com/Le-Space/belege/blob/main/';

/**
 * @typedef {object} IntegrationHelp
 * @property {string} [command] for the terminal, run in the repository
 * @property {string} doc path in the repository; `{de}` becomes `.de` in German where a twin exists
 */

/** @type {Record<string, IntegrationHelp>} */
export const INTEGRATION_HELP = {
	bridge: { command: 'pnpm bridge', doc: 'bridge/README.md' },
	bank: { command: 'pnpm setup:hibiscus', doc: 'docs/banking{de}.md' },
	ki: { command: 'pnpm setup:llm', doc: 'docs/ai{de}.md' },
	kraken: { command: 'pnpm setup:kraken', doc: 'docs/crypto{de}.md' },
	wallets: { doc: 'docs/crypto{de}.md#own-wallets' },
	aleph: { doc: 'docs/crypto{de}.md' },
	geraete: { command: 'pnpm setup:relay', doc: 'docs/features{de}.md' },
	backup: { command: 'pnpm setup:aleph', doc: 'docs/backup{de}.md' },
	portale: { command: 'pnpm setup:portal vodafone', doc: 'bridge/README.md#kundenportale' },
	'rechnungs-app': { doc: 'docs/features{de}.md' },
	assistent: { doc: 'docs/features{de}.md' }
};

/**
 * The docs link for an integration in a language.
 *
 * @param {string} id
 * @param {'de' | 'en'} locale
 * @returns {string | null}
 */
export function helpDoc(id, locale) {
	const help = INTEGRATION_HELP[id];
	if (!help) return null;
	// The German twins have German headings: link the page, not the English anchor.
	const path =
		locale === 'de' && help.doc.includes('{de}')
			? help.doc.replace('{de}', '.de').replace(/#.*$/, '')
			: help.doc.replace('{de}', '');
	return `${REPO}${path}`;
}
