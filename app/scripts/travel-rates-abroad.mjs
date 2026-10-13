// The rates abroad for travel expenses (issue #379), from the BMF letter's
// own table: run once a year when the Federal Ministry of Finance publishes
// the letter for the next year (usually in November or December).
//
//   pdftotext -layout <letter>.pdf letter.txt
//   node scripts/travel-rates-abroad.mjs letter.txt
//
// prints the rows for app/src/lib/travel/rates-abroad.js: one per country, and
// per city where the letter gives cities their own rates ("im Übrigen" is the
// rest of the country). Paste them as a new letter with its date, reference
// and the day it applies from. Nothing is estimated: a name this script does
// not know stops it, and the rows are only what the letter prints.

import { readFileSync } from 'node:fs';

/** The letter's country names → ISO 3166 alpha-2 (Kosovo: XK, as the EU uses it). */
const ISO = {
	Afghanistan: 'AF',
	Ägypten: 'EG',
	Äthiopien: 'ET',
	Äquatorialguinea: 'GQ',
	Albanien: 'AL',
	Algerien: 'DZ',
	Andorra: 'AD',
	Angola: 'AO',
	Argentinien: 'AR',
	Armenien: 'AM',
	Aserbaidschan: 'AZ',
	Australien: 'AU',
	Bahrain: 'BH',
	Bangladesch: 'BD',
	Barbados: 'BB',
	Belgien: 'BE',
	Benin: 'BJ',
	Bhutan: 'BT',
	Bolivien: 'BO',
	'Bosnien und Herzegowina': 'BA',
	Botsuana: 'BW',
	Brasilien: 'BR',
	Brunei: 'BN',
	Bulgarien: 'BG',
	'Burkina Faso': 'BF',
	Burundi: 'BI',
	Chile: 'CL',
	China: 'CN',
	'Costa Rica': 'CR',
	'Côte d’Ivoire': 'CI',
	Dänemark: 'DK',
	'Dominikanische Republik': 'DO',
	Dschibuti: 'DJ',
	Ecuador: 'EC',
	'El Salvador': 'SV',
	Eritrea: 'ER',
	Estland: 'EE',
	Fidschi: 'FJ',
	Finnland: 'FI',
	Frankreich: 'FR',
	Gabun: 'GA',
	Gambia: 'GM',
	Georgien: 'GE',
	Ghana: 'GH',
	Griechenland: 'GR',
	Guatemala: 'GT',
	Guinea: 'GN',
	'Guinea-Bissau': 'GW',
	Haiti: 'HT',
	Honduras: 'HN',
	Indien: 'IN',
	Indonesien: 'ID',
	Irak: 'IQ',
	Iran: 'IR',
	Irland: 'IE',
	Island: 'IS',
	Israel: 'IL',
	Italien: 'IT',
	Jamaika: 'JM',
	Japan: 'JP',
	Jemen: 'YE',
	Jordanien: 'JO',
	Kambodscha: 'KH',
	Kamerun: 'CM',
	Kanada: 'CA',
	'Kap Verde': 'CV',
	Kasachstan: 'KZ',
	Katar: 'QA',
	Kenia: 'KE',
	Kirgisistan: 'KG',
	Kolumbien: 'CO',
	'Kongo, Republik': 'CG',
	'Kongo, Demokratische Republik': 'CD',
	'Korea, Demokratische Volksrepublik': 'KP',
	'Korea, Republik': 'KR',
	Kosovo: 'XK',
	Kroatien: 'HR',
	Kuba: 'CU',
	Kuwait: 'KW',
	Laos: 'LA',
	Lesotho: 'LS',
	Lettland: 'LV',
	Libanon: 'LB',
	Liberia: 'LR',
	Libyen: 'LY',
	Liechtenstein: 'LI',
	Litauen: 'LT',
	Luxemburg: 'LU',
	Madagaskar: 'MG',
	Malawi: 'MW',
	Malaysia: 'MY',
	Malediven: 'MV',
	Mali: 'ML',
	Malta: 'MT',
	Marokko: 'MA',
	'Marshall Inseln': 'MH',
	Mauretanien: 'MR',
	Mauritius: 'MU',
	Mexiko: 'MX',
	'Moldau, Republik': 'MD',
	Monaco: 'MC',
	Mongolei: 'MN',
	Montenegro: 'ME',
	Mosambik: 'MZ',
	Myanmar: 'MM',
	Namibia: 'NA',
	Nepal: 'NP',
	Neuseeland: 'NZ',
	Nicaragua: 'NI',
	Niederlande: 'NL',
	Niger: 'NE',
	Nigeria: 'NG',
	Nordmazedonien: 'MK',
	Norwegen: 'NO',
	Österreich: 'AT',
	Oman: 'OM',
	Pakistan: 'PK',
	Palau: 'PW',
	Panama: 'PA',
	'Papua-Neuguinea': 'PG',
	Paraguay: 'PY',
	Peru: 'PE',
	Philippinen: 'PH',
	Polen: 'PL',
	Portugal: 'PT',
	Ruanda: 'RW',
	Rumänien: 'RO',
	'Russische Föderation': 'RU',
	Sambia: 'ZM',
	Samoa: 'WS',
	'San Marino': 'SM',
	'São Tomé – Príncipe': 'ST',
	'Saudi-Arabien': 'SA',
	Schweden: 'SE',
	Schweiz: 'CH',
	Senegal: 'SN',
	Serbien: 'RS',
	'Sierra Leone': 'SL',
	Simbabwe: 'ZW',
	Singapur: 'SG',
	'Slowakische Republik': 'SK',
	Slowenien: 'SI',
	Spanien: 'ES',
	'Sri Lanka': 'LK',
	Sudan: 'SD',
	Südafrika: 'ZA',
	Südsudan: 'SS',
	Syrien: 'SY',
	Tadschikistan: 'TJ',
	Taiwan: 'TW',
	Tansania: 'TZ',
	Thailand: 'TH',
	Togo: 'TG',
	Tonga: 'TO',
	'Trinidad und Tobago': 'TT',
	Tschad: 'TD',
	'Tschechische Republik': 'CZ',
	Türkei: 'TR',
	Tunesien: 'TN',
	Turkmenistan: 'TM',
	Uganda: 'UG',
	Ukraine: 'UA',
	Ungarn: 'HU',
	Uruguay: 'UY',
	Usbekistan: 'UZ',
	Vatikanstaat: 'VA',
	Venezuela: 'VE',
	'Vereinigte Arabische Emirate': 'AE',
	'Vereinigte Staaten von Amerika (USA)': 'US',
	'Vereinigtes Königreich von Großbritannien und Nordirland': 'GB',
	Vietnam: 'VN',
	Weißrussland: 'BY',
	'Zentralafrikanische Republik': 'CF',
	Zypern: 'CY'
};

const ROW = /^(\S.*?)\s{2,}(\d+)\s+(\d+)\s+(\d+)$/;
const CITY = /^[–-]\s+(.*?)\s{2,}(\d+)\s+(\d+)\s+(\d+)$/;

/** @param {string} text the letter as `pdftotext -layout` gives it */
export function parseLetter(text) {
	const rows = [];
	/** @type {string[]} */
	let pending = [];
	let current = '';
	let inTable = false;
	/** @type {{ name: string, rates: number[] } | null} */
	let wrapped = null;
	const iso = (/** @type {string} */ name) => {
		const code = ISO[/** @type {keyof typeof ISO} */ (name)];
		if (!code) throw new Error(`unknown country: ${name}`);
		return code;
	};
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (/^Übersicht über die ab/.test(line)) {
			inTable = false;
			continue;
		}
		if (/^€\s+€\s+€$/.test(line)) {
			inTable = true;
			continue;
		}
		if (!inTable || !line || /^\d+$/.test(line) || /^Departments /.test(line)) continue;
		const city = CITY.exec(line);
		if (city) {
			if (pending.length) current = iso(pending.join(' '));
			pending = [];
			if (!current) throw new Error(`a city without a country: ${line}`);
			const name = city[1].replace(/ sowie die$/, '');
			rows.push([current, name === 'im Übrigen' ? null : name, +city[2], +city[3], +city[4]]);
			continue;
		}
		const row = ROW.exec(line);
		if (row) {
			if (pending.length) throw new Error(`a name without rates: ${pending.join(' ')}`);
			if (wrapped) throw new Error(`unknown country: ${wrapped.name}`);
			current = '';
			// A name too long for its column goes on below its rates ("Korea, Demokratische / Volksrepublik").
			if (ISO[/** @type {keyof typeof ISO} */ (row[1])]) {
				rows.push([iso(row[1]), null, +row[2], +row[3], +row[4]]);
			} else wrapped = { name: row[1], rates: [+row[2], +row[3], +row[4]] };
			continue;
		}
		if (wrapped) {
			rows.push([iso(`${wrapped.name} ${line}`), null, ...wrapped.rates]);
			wrapped = null;
			continue;
		}
		pending.push(line);
	}
	if (pending.length || wrapped)
		throw new Error(`left over: ${pending.join(' ') || wrapped?.name}`);
	return rows;
}

if (process.argv[2]) {
	const rows = parseLetter(readFileSync(process.argv[2], 'utf8'));
	for (const r of rows) console.log(`\t\t${JSON.stringify(r)},`);
	console.error(`${rows.length} rows, ${new Set(rows.map((r) => r[0])).size} countries`);
}
