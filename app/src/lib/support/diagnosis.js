// "Diagnose kopieren" (Hilfe & Support): what a person can paste into a mail
// to Le Space about a problem – the version, where the app is, the last error,
// the browser – and nothing of their books. Pure, so it can be tested.
//
// Never in it: amounts, names, IBANs, receipt or mail texts, keys, tokens, the
// DID. The last error is the only free text; it is cut and scrubbed of what
// could be data (numbers, e-mail addresses, IBANs, long hex or base64 runs,
// quoted text) before it is shown and copied. The person sees exactly what is
// copied before copying it.

/** @param {string} text */
export function scrubError(text) {
	return (
		String(text ?? '')
			// Quoted parts often carry a file name, a vendor or a subject.
			.replace(/[„“"'«»‚‘][^„“"'«»‚‘]{0,200}[“”"'«»‘’]/g, '"…"')
			.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<mail>')
			.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g, '<iban>')
			.replace(/\b(?:0x)?[0-9a-fA-F]{16,}\b/g, '<hex>')
			.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '<key?>')
			.replace(/https?:\/\/\S+/g, '<url>')
			.replace(/\d[\d.,:/ -]*\d|\d/g, '#')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 300)
	);
}

/**
 * @param {{
 *   release?: string | null,
 *   commit?: string | null,
 *   status: string,
 *   step?: string | null,
 *   stepSeconds?: number | null,
 *   error?: string | null,
 *   userAgent?: string,
 *   language?: string,
 *   online?: boolean,
 *   standalone?: boolean,
 *   deviceSync?: boolean,
 *   networkPaused?: boolean,
 *   networkMode?: string,
 *   storage?: { usage?: number, quota?: number } | null,
 *   now: Date
 * }} input
 * @returns {string}
 */
export function diagnosisText(input) {
	const mb = (/** @type {number | undefined} */ n) =>
		typeof n === 'number' ? `${Math.round(n / 1e6)} MB` : '?';
	const lines = [
		'Belege diagnosis',
		`version: ${input.release || '?'}${input.commit ? ` (${input.commit})` : ''}`,
		`time: ${input.now.toISOString()}`,
		`status: ${input.status}${input.step ? `, step ${input.step}` : ''}${
			typeof input.stepSeconds === 'number' ? ` for ${Math.round(input.stepSeconds)} s` : ''
		}`,
		`last error: ${input.error ? scrubError(input.error) : '-'}`,
		`browser: ${String(input.userAgent ?? '?').slice(0, 300)}`,
		`language: ${input.language || '?'}, online: ${input.online ? 'yes' : 'no'}, installed app: ${
			input.standalone ? 'yes' : 'no'
		}`,
		`device sync: ${input.deviceSync ? 'on' : 'off'}, network paused: ${
			input.networkPaused ? 'yes' : 'no'
		}, mode: ${input.networkMode || '?'}`,
		`storage: ${input.storage ? `${mb(input.storage.usage)} of ${mb(input.storage.quota)}` : '?'}`
	];
	return lines.join('\n');
}
