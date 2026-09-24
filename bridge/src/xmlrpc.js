// XML-RPC encoding and decoding, the subset Hibiscus speaks.
//
// Moved here from spikes/hibiscus/probe.mjs; the spike keeps its own copy so
// it stays a single file.

import { XMLParser } from 'fast-xml-parser';

/**
 * @param {string} method
 * @param {unknown[]} params
 */
export function encodeCall(method, params = []) {
	return `<?xml version="1.0"?><methodCall><methodName>${esc(method)}</methodName><params>${params
		.map((p) => `<param>${encodeValue(p)}</param>`)
		.join('')}</params></methodCall>`;
}

/** @param {unknown} v @returns {string} */
export function encodeValue(v) {
	if (Array.isArray(v))
		return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
	if (v && typeof v === 'object') {
		return `<value><struct>${Object.entries(v)
			.map(([k, x]) => `<member><name>${esc(k)}</name>${encodeValue(x)}</member>`)
			.join('')}</struct></value>`;
	}
	if (typeof v === 'number') {
		return Number.isInteger(v)
			? `<value><int>${v}</int></value>`
			: `<value><double>${v}</double></value>`;
	}
	if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
	return `<value><string>${esc(String(v ?? ''))}</string></value>`;
}

const parser = new XMLParser({
	parseTagValue: false,
	trimValues: false,
	isArray: (name, jpath) =>
		name === 'member' || String(jpath).endsWith('data.value') || name === 'param'
});

/**
 * @param {string} xml a methodResponse
 * @returns {unknown}
 * @throws {Error} on a fault
 */
export function decodeResponse(xml) {
	const doc = parser.parse(xml)?.methodResponse;
	if (!doc) throw new Error('Not an XML-RPC response');
	if (doc.fault) {
		const f = /** @type {any} */ (decodeValue(doc.fault.value));
		throw Object.assign(new Error(`XML-RPC fault ${f?.faultCode}: ${f?.faultString}`), {
			code: 'XMLRPC_FAULT'
		});
	}
	return decodeValue(doc.params?.param?.[0]?.value);
}

/**
 * @param {string} xml a methodCall (the fake Hibiscus in the tests reads these)
 * @returns {{ method: string, params: unknown[] }}
 */
export function decodeCall(xml) {
	const doc = parser.parse(xml)?.methodCall;
	if (!doc) throw new Error('Not an XML-RPC call');
	const params = doc.params?.param ?? [];
	return {
		method: String(doc.methodName).trim(),
		params: params.map((/** @type {any} */ p) => decodeValue(p.value))
	};
}

/** @param {any} value @returns {unknown} */
export function decodeValue(value) {
	if (value === undefined || value === null) return '';
	// <value>text</value> without a type is a string.
	if (typeof value !== 'object') return String(value);
	if ('string' in value) return value.string === '' ? '' : String(value.string);
	if ('int' in value || 'i4' in value) return Number(value.int ?? value.i4);
	if ('double' in value) return Number(value.double);
	if ('boolean' in value) return String(value.boolean).trim() === '1';
	if ('dateTime.iso8601' in value) return String(value['dateTime.iso8601']);
	if ('nil' in value) return null;
	if ('array' in value) return (value.array?.data?.value ?? []).map(decodeValue);
	if ('struct' in value) {
		return Object.fromEntries(
			(value.struct?.member ?? []).map((/** @type {any} */ m) => [
				String(m.name),
				decodeValue(m.value)
			])
		);
	}
	return '';
}

/** @param {string} s */
function esc(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
