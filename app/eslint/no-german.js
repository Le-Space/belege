// No German outside the catalogue (issue #192): text people read comes from
// src/lib/i18n, in both languages. Flags a string literal, a template's text,
// or Svelte markup text and attribute values that look German – an umlaut or
// ß, a German opening quote „, or a common German word.
//
// German on purpose (a document for German bookkeeping, a prompt, a word the
// books store or the matching looks for in German bank data) says so where it
// stands: `// eslint-disable-next-line belege/no-german -- why`.

const MARKS = /[äöüÄÖÜß„]/;
const WORDS =
	/(?:^|[^\p{L}])(?:und|oder|nicht|kein|keine|keinen|ist|sind|wird|werden|wurde|mit|für|auf|bei|nach|noch|schon|auch|vom|zum|zur|eine|einen|einem|einer|bitte|dein|deine|deinen|diese|dieser|dieses|Beleg|Zahlung|Zahlungen|Buchung|Buchungen|Konto|Rechnung|Gerät|Geräte|Fehler)(?=$|[^\p{L}])/u;

/** One lowercase word, like a kind or a key (`rückfrage`): data, not text. */
const IDENTIFIER = /^[\p{Ll}][\p{L}\d_-]*$/u;

/**
 * Whether a text looks German. "Belege" alone is the app's name.
 *
 * @param {string} text
 */
export const looksGerman = (text) =>
	!IDENTIFIER.test(text.trim()) && (MARKS.test(text) || WORDS.test(text));

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
	meta: {
		type: 'problem',
		docs: { description: 'German text belongs in src/lib/i18n (issue #192)' },
		messages: {
			german:
				'German text outside the catalogue: “{{text}}”. Use t() with a key in de.js and en.js.'
		},
		schema: []
	},
	create(context) {
		/** @param {any} node @param {unknown} value */
		const check = (node, value) => {
			const text = String(value ?? '');
			if (!text.trim() || !looksGerman(text)) return;
			context.report({ node, messageId: 'german', data: { text: text.trim().slice(0, 60) } });
		};
		return {
			/** @param {any} node */
			Literal(node) {
				if (typeof node.value !== 'string') return;
				const p = node.parent;
				if (p?.type === 'ImportDeclaration' || p?.type === 'ExportNamedDeclaration') return;
				if (p?.type === 'Property' && p.key === node) return;
				check(node, node.value);
			},
			/** @param {any} node */
			TemplateElement(node) {
				check(node, node.value.cooked);
			},
			/** @param {any} node */
			SvelteText(node) {
				check(node, node.value);
			},
			/** @param {any} node */
			SvelteLiteral(node) {
				check(node, node.value);
			}
		};
	}
};

export default { rules: { 'no-german': rule } };
