// XML from a file — an e-invoice, a bank statement — parsed into a document of
// its own. The page's Content-Security-Policy requires Trusted Types (csp.js),
// and DOMParser.parseFromString then takes only a TrustedHTML, whatever the
// MIME type. Parsed as XML, the text runs no script and never becomes part of
// the page, so this policy passes it through unchanged; it exists so that
// parsing XML is the one thing it can be used for.
// The bundled DOM types do not know `trustedTypes` yet.
const policy = /** @type {any} */ (globalThis).trustedTypes?.createPolicy?.('belege-xml', {
	createHTML: (/** @type {string} */ xml) => xml
});

/**
 * @param {string} xml
 * @param {typeof DOMParser} [Parser] tests in Node pass @xmldom's
 * @returns {Document}
 */
export function parseXml(xml, Parser = globalThis.DOMParser) {
	const text = policy && Parser === globalThis.DOMParser ? policy.createHTML(xml) : xml;
	return new Parser().parseFromString(/** @type {string} */ (text), 'application/xml');
}
