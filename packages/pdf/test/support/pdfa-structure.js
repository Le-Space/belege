// SPDX-License-Identifier: AGPL-3.0-or-later
// What a PDF/A-2b file shows of itself, read without a PDF library: the
// header, the XMP packet and its PDF/A id, the info dictionary (its strings
// decoded), the output intent, the document id, and the fonts – embedded or
// standard. For tests (@le-space/pdf/testing/pdfa-structure); veraPDF checks
// the rest. Works on pdf-lib's output without object streams.

/** @param {string} s @param {string} tag */
const xmpValue = (s, tag) => {
	const m = new RegExp(`<${tag}>(?:<rdf:(?:Alt|Seq)>\\s*<rdf:li[^>]*>)?([^<]*)<`).exec(s);
	return m
		? m[1]
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/&amp;/g, '&')
		: null;
};

/** A PDF string as written: `(text)` or `<FEFF…>` (UTF-16BE). @param {string} raw */
function pdfString(raw) {
	if (raw.startsWith('(')) return raw.slice(1, -1).replace(/\\([()\\])/g, '$1');
	const hex = raw.slice(1, -1);
	if (!/^feff/i.test(hex)) return hex.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
	let out = '';
	for (let i = 4; i < hex.length; i += 4)
		out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
	return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ header: string, pdfaid: { part: string | null, conformance: string | null }, xmp: Record<string, string | null>, info: Record<string, string>, outputIntent: boolean, id: string | null, embeddedFonts: number, standardFonts: string[], language: string | null }}
 */
export function pdfaStructure(bytes) {
	const s = new TextDecoder('latin1').decode(bytes);
	const start = s.indexOf('<?xpacket begin');
	const end = s.indexOf('<?xpacket end');
	const xmp = start >= 0 && end > start ? new TextDecoder().decode(bytes.subarray(start, end)) : '';
	const infoRef = /\/Info (\d+) 0 R/.exec(s);
	const infoDict = infoRef
		? (new RegExp(`\\n${infoRef[1]} 0 obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(s)?.[1] ?? '')
		: '';
	/** @type {Record<string, string>} */
	const info = {};
	for (const m of infoDict.matchAll(/\/(\w+)\s*(\([^)]*\)|<[0-9A-Fa-f]*>)/g))
		info[m[1]] = pdfString(m[2]);
	const id = /\/ID \[ <([0-9a-fA-F]+)> <([0-9a-fA-F]+)> \]/.exec(s);
	return {
		header: s.slice(0, 8),
		pdfaid: {
			part: xmpValue(xmp, 'pdfaid:part'),
			conformance: xmpValue(xmp, 'pdfaid:conformance')
		},
		xmp: {
			title: xmpValue(xmp, 'dc:title'),
			creator: xmpValue(xmp, 'dc:creator'),
			description: xmpValue(xmp, 'dc:description'),
			creatorTool: xmpValue(xmp, 'xmp:CreatorTool'),
			producer: xmpValue(xmp, 'pdf:Producer'),
			createDate: xmpValue(xmp, 'xmp:CreateDate')
		},
		info,
		outputIntent: /\/S \/GTS_PDFA1/.test(s) && /\/DestOutputProfile \d+ 0 R/.test(s),
		id: id && id[1] === id[2] ? id[1].toLowerCase() : null,
		embeddedFonts: (s.match(/\/FontFile2 \d+ 0 R/g) ?? []).length,
		standardFonts: [
			...s.matchAll(/\/BaseFont \/(Helvetica|Courier|Times|Symbol|ZapfDingbats)[\w-]*/g)
		].map((m) => m[0]),
		language: /\/Lang \(([^)]*)\)/.exec(s)?.[1] ?? null
	};
}
