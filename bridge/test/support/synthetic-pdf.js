// A tiny, valid PDF with a text layer, made on the spot: one page, Helvetica,
// one line per string. For tests only; every text in it is made up.

/** @param {string} s */
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');

/**
 * @param {string[]} lines ASCII is safest; anything else becomes `?`
 * @returns {Buffer}
 */
export function makePdf(lines) {
	const content = [
		'BT',
		'/F1 11 Tf',
		'14 TL',
		'56 780 Td',
		...lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`),
		'ET'
	].join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
		`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
	];
	let out = '%PDF-1.4\n';
	/** @type {number[]} */
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

/** A 1×1 PNG, and a JPEG header that is enough for the sniffer. */
export const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
export const TINY_JPEG = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
	0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);
