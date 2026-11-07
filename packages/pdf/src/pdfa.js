// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF/A-2b, what an archive for bookkeeping records expects: every font
// embedded (fonts.js), an sRGB output intent, XMP metadata that says the same
// as the document info, and a document id. The id comes from the document's
// content (its seed), never from the clock or chance: the same document is
// the same file, in Node and in a browser.
//
// From Le-Space/eigenbeleg-agent packages/eigenbeleg/src/pdf.js (makePdfA) at
// e6cde90; the creator is the caller's now, an empty author or subject is
// left out, and the info dictionary is written here too, from the same values.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { asset } from './assets.js';
import { pdfFonts, pdfText } from './fonts.js';

/**
 * @typedef {object} PdfAMeta
 * @property {string} title
 * @property {Date} created also the modification date
 * @property {string} creator the program that made the document (xmp:CreatorTool)
 * @property {string} [producer] what wrote the PDF; the creator and pdf-lib when not given
 * @property {string} [author] who issued it; left out when empty
 * @property {string} [subject] left out when empty
 * @property {string} [language] BCP 47, `de-DE` when not given
 * @property {string} [seed] what the document id is derived from; title, date and author when not given
 */

/** @param {string} s */
const xml = (s) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A new document to draw on, with the fonts (fonts.js). pdf-lib's own
 * metadata (its producer, the clock) is off; savePdfA writes it.
 *
 * @returns {Promise<{ pdf: PDFDocument, fonts: Awaited<ReturnType<typeof pdfFonts>> }>}
 */
export async function createPdfA() {
	const pdf = await PDFDocument.create({ updateMetadata: false });
	return { pdf, fonts: await pdfFonts(pdf) };
}

/**
 * Makes the document PDF/A-2b (makePdfA) and saves it.
 *
 * @param {PDFDocument} pdf
 * @param {PdfAMeta} meta
 * @returns {Promise<Uint8Array>}
 */
export async function savePdfA(pdf, meta) {
	await makePdfA(pdf, meta);
	return pdf.save({ useObjectStreams: false });
}

/**
 * Turns the document into PDF/A-2b: the document info, XMP metadata that
 * matches it, an sRGB output intent and a document id.
 *
 * @param {PDFDocument} pdf
 * @param {PdfAMeta} meta
 */
export async function makePdfA(pdf, meta) {
	const title = pdfText(meta.title);
	const author = pdfText(meta.author ?? '');
	const subject = pdfText(meta.subject ?? '');
	const creator = pdfText(meta.creator);
	const producer = pdfText(meta.producer ?? `${meta.creator}, pdf-lib`);
	const language = meta.language ?? 'de-DE';
	const { created } = meta;

	pdf.setTitle(title);
	if (author) pdf.setAuthor(author);
	if (subject) pdf.setSubject(subject);
	pdf.setCreator(creator);
	pdf.setProducer(producer);
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	pdf.setLanguage(language);

	const ctx = pdf.context;
	// Dates as the info dictionary has them (pdf-lib writes UTC with Z).
	const date = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const dc = [
		'   <dc:format>application/pdf</dc:format>',
		`   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>`,
		author && `   <dc:creator><rdf:Seq><rdf:li>${xml(author)}</rdf:li></rdf:Seq></dc:creator>`,
		subject &&
			`   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(subject)}</rdf:li></rdf:Alt></dc:description>`
	].filter(Boolean);
	const packet = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
${dc.join('\n')}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${xml(creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${date}</xmp:CreateDate>
   <xmp:ModifyDate>${date}</xmp:ModifyDate>
   <xmp:MetadataDate>${date}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xml(producer)}</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
	const metaStream = ctx.stream(utf8ToBytes(packet), { Type: 'Metadata', Subtype: 'XML' });
	pdf.catalog.set(PDFName.of('Metadata'), ctx.register(metaStream));

	const icc = await asset('sRGB-v2-micro.icc');
	const iccStream = ctx.stream(icc, { N: 3 });
	const intent = ctx.obj({
		Type: 'OutputIntent',
		S: 'GTS_PDFA1',
		OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
		Info: PDFString.of('sRGB IEC61966-2.1'),
		DestOutputProfile: ctx.register(iccStream)
	});
	pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));

	const seed = meta.seed ?? `${title}|${created.toISOString()}|${author}`;
	const id = bytesToHex(sha256(utf8ToBytes(seed))).slice(0, 32);
	ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}
