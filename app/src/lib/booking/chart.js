// "Kontenplan einlesen": the person's own chart of accounts, from the file
// their bookkeeping program exports, so "Konto" suggests their accounts with
// their names instead of the built-in SKR 03 list (skr03.js).
//
// Two shapes are read:
//   - DATEV "Kontenbeschriftungen" (EXTF, data category 20): line 1 the EXTF
//     header, line 2 the column headings (Konto;Kontenbeschriftung;…), then
//     one account per line. MonKey Office writes it under Import & Export →
//     Export DATEV → Kontenbeschriftungen; most programs have the same.
//   - any CSV with an account number column (4–8 digits) and a name column,
//     separated by ; , or tab, with or without a heading line.
// The bytes are UTF-8 when they decode as such, else Windows-1252 (what DATEV
// files use). Pure; the result is kept sealed in the settings under `chart`.

/**
 * @typedef {{ number: string, name: string }} ChartAccount
 * @typedef {{ format: 'datev' | 'csv', accounts: ChartAccount[], skipped: number }} ParsedChart
 * @typedef {{ accounts: ChartAccount[], format: 'datev' | 'csv', fileName: string, importedAt: string }} StoredChart
 */

export const MAX_CHART_ACCOUNTS = 20000;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeChartBytes(bytes) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

/**
 * One line of a CSV, quotes respected ("" inside quotes is one ").
 *
 * @param {string} line
 * @param {string} sep
 * @returns {string[]}
 */
export function splitCsvLine(line, sep) {
	/** @type {string[]} */
	const out = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === sep) {
			out.push(cell);
			cell = '';
		} else cell += c;
	}
	out.push(cell);
	return out.map((s) => s.trim());
}

/** @param {string} line */
function separatorOf(line) {
	const counts = [';', '\t', ','].map((s) => [s, line.split(s).length - 1]);
	counts.sort((a, b) => Number(b[1]) - Number(a[1]));
	return String(counts[0][1] ? counts[0][0] : ';');
}

const NUMBER = /^\d{4,8}$/;

/**
 * @param {string} text the file, decoded
 * @returns {ParsedChart}
 */
export function parseChart(text) {
	const lines = text
		.split(/\r\n|\n|\r/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (!lines.length) return { format: 'csv', accounts: [], skipped: 0 };
	const sep = separatorOf(lines[0]);
	const datev = /^"?EXTF"?[;,\t]/.test(lines[0]);
	let rows = lines.map((l) => splitCsvLine(l, sep));
	if (datev) rows = rows.slice(1);

	// Columns: by heading when there is one, else by what the values look like.
	const head = rows[0].map((h) => h.toLowerCase());
	let numberCol = head.findIndex((h) =>
		/^(konto|kontonummer|konto-?nr\.?|sachkonto|account)$/.test(h)
	);
	let nameCol = head.findIndex((h) =>
		/^(kontenbeschriftung|beschriftung|bezeichnung|kontobezeichnung|kontenbezeichnung|name|kontoname|description)$/.test(
			h
		)
	);
	const hasHead = numberCol !== -1 || !rows[0].some((c) => NUMBER.test(c));
	const data = hasHead ? rows.slice(1) : rows;
	const sample = data.slice(0, 50);
	const width = Math.max(0, ...sample.map((r) => r.length));
	if (numberCol === -1) {
		// The column most often holding a 4–8 digit number.
		let bestHits = 0;
		for (let c = 0; c < width; c++) {
			const hits = sample.filter((r) => NUMBER.test(r[c] ?? '')).length;
			if (hits > bestHits) {
				bestHits = hits;
				numberCol = c;
			}
		}
	}
	if (nameCol === -1 && numberCol !== -1) {
		// The first other column that holds letters.
		for (let c = 0; c < width && nameCol === -1; c++) {
			if (c === numberCol) continue;
			if (sample.some((r) => /[a-zäöüß]/i.test(r[c] ?? ''))) nameCol = c;
		}
	}

	/** @type {Map<string, string>} */
	const seen = new Map();
	let skipped = 0;
	for (const r of data) {
		const number = (r[numberCol] ?? '').replace(/\s/g, '');
		const name = (r[nameCol] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
		if (numberCol === -1 || !NUMBER.test(number) || !name) {
			skipped++;
			continue;
		}
		seen.set(number, name);
		if (seen.size >= MAX_CHART_ACCOUNTS) break;
	}
	const accounts = [...seen.entries()]
		.map(([number, name]) => ({ number, name }))
		.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
	return { format: datev ? 'datev' : 'csv', accounts, skipped };
}

/**
 * A stored chart, cleaned; null when there is none.
 *
 * @param {any} value
 * @returns {StoredChart | null}
 */
export function cleanChart(value) {
	if (!value || !Array.isArray(value.accounts)) return null;
	const accounts = value.accounts
		.filter(
			(/** @type {any} */ a) =>
				a && NUMBER.test(String(a.number ?? '')) && typeof a.name === 'string' && a.name.trim()
		)
		.slice(0, MAX_CHART_ACCOUNTS)
		.map((/** @type {any} */ a) => ({ number: String(a.number), name: a.name.trim() }));
	if (!accounts.length) return null;
	return {
		accounts,
		format: value.format === 'datev' ? 'datev' : 'csv',
		fileName: typeof value.fileName === 'string' ? value.fileName.slice(0, 200) : '',
		importedAt: typeof value.importedAt === 'string' ? value.importedAt : ''
	};
}

/**
 * What an account of the person's chart is, by its SKR 03 class: 3 and 4
 * are costs, 8 revenue, the rest neither. Only for ordering suggestions.
 *
 * @param {string} number
 * @returns {'expense' | 'income' | 'neutral'}
 */
export function chartKind(number) {
	const c = number[0];
	if (c === '3' || c === '4') return 'expense';
	if (c === '8') return 'income';
	return 'neutral';
}
