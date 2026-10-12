// A basic recognition of travel costs without AI (issue #366, point 3):
// words that tickets, boarding passes, hotel and restaurant bills print, in
// German, English, Russian, Ukrainian, Polish, Czech, Turkish, Arabic,
// Spanish, Italian and French. Pure, on this device; nothing is sent.
//
// It tells a kind (train, flight, hotel …) and nothing more: no route, no
// times, no amounts – those only a reading can give. What it finds is a
// hint on the receipt, never a question and never an assignment: words
// guess, and a ticket for a cinema is a ticket too.
//
// Accents, Turkish dotted capitals and Arabic vowel marks are dropped before
// comparing, so "Hôtel", "OTEL" and "otel" are one word. A word written with
// a leading `=` must stand alone ("bus" is not in "business").

/* eslint-disable belege/no-german -- the words receipts print, in their languages */

/** @type {Record<string, string[]>} kind → words, the most telling kinds first */
const WORDS = {
	flight: [
		'boarding pass',
		'bordkarte',
		'flugschein',
		'flugticket',
		'=flight',
		'=flug',
		'tarjeta de embarque',
		'=vuelo',
		"carta d'imbarco",
		'=volo',
		"carte d'embarquement",
		'karta pokładowa',
		'palubní lístek',
		'letenka',
		'посадочный талон',
		'авиабилет',
		'=рейс',
		'посадковий талон',
		'авіаквиток',
		'biniş kartı',
		'uçak bileti',
		'=uçuş',
		'بطاقة صعود الطائرة',
		'تذكرة طيران',
		'=رحلة'
	],
	train: [
		'fahrkarte',
		'bahnticket',
		'zugticket',
		'fahrschein',
		'train ticket',
		'=railway',
		'billete de tren',
		'=tren',
		'biglietto ferroviario',
		'=treno',
		'billet de train',
		'bilet kolejowy',
		'=pociąg',
		'jízdenka',
		'=vlak',
		'=поезд',
		'ж/д билет',
		'железнодорожный',
		'=потяг',
		'залізничний',
		'tren bileti',
		'=قطار'
	],
	bus: [
		'busticket',
		'fernbus',
		'=bus ticket',
		'=coach ticket',
		'=autobús',
		'=autobus',
		'=autocar',
		'=автобус',
		'=otobüs',
		'=حافلة'
	],
	rental_car: [
		'mietwagen',
		'autovermietung',
		'car rental',
		'rental agreement',
		'alquiler de coche',
		'autonoleggio',
		'location de voiture',
		'wynajem samochodu',
		'аренда автомобиля',
		'прокат автомобиля',
		'оренда авто',
		'araç kiralama',
		'تأجير سيارات'
	],
	hotel: [
		'=hotel',
		'=hôtel',
		'=hostel',
		'übernachtung',
		'=check-in',
		'=check-out',
		'=albergo',
		'pernottamento',
		'=alojamiento',
		'=nocleg',
		'=ubytování',
		'гостиница',
		'=отель',
		'=готель',
		'=otel',
		'=konaklama',
		'=فندق'
	],
	taxi: ['=taxi', '=такси', '=таксі', '=taksi', '=تاكسي'],
	fuel: [
		'tankstelle',
		'kraftstoff',
		'=diesel',
		'=benzin',
		'super e10',
		'=fuel',
		'=gasolina',
		'carburante',
		'carburant',
		'=paliwo',
		'=pohonné hmoty',
		'=бензин',
		'=топливо',
		'=пальне',
		'akaryakıt',
		'=وقود'
	],
	parking: [
		'parkhaus',
		'parkschein',
		'parkgebühr',
		'=parking',
		'aparcamiento',
		'parcheggio',
		'stationnement',
		'parkovné',
		'парковка',
		'=otopark',
		'=موقف سيارات'
	],
	restaurant: [
		'=restaurant',
		'gaststätte',
		'bewirtung',
		'=ristorante',
		'=trattoria',
		'=restaurante',
		'=restauracja',
		'=restaurace',
		'=ресторан',
		'=lokanta',
		'=restoran',
		'=مطعم'
	],
	event: [
		'konferenz',
		'=conference',
		'=congreso',
		'=congresso',
		'=congrès',
		'konferencja',
		'конференция',
		'конференція',
		'=konferans',
		'=مؤتمر',
		'=festival',
		'=messe',
		'=trade fair'
	],
	ticket: [
		'=ticket',
		'e-ticket',
		'=билет',
		'=квиток',
		'=bilet',
		'=billete',
		'=biglietto',
		'=billet',
		'=jízdenka',
		'=تذكرة'
	]
};

/** For comparing: no accents, no marks, lower case. @param {string} s */
const fold = (s) =>
	s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		// Turkish dotless ı, and the Arabic tatweel, are no letters of their own here.
		.replace(/ı/g, 'i')
		.replace(/ـ/g, '');

const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** @type {{ kind: string, word: string, re: RegExp }[]} */
const PATTERNS = Object.entries(WORDS).flatMap(([kind, words]) =>
	words.map((w) => {
		const alone = w.startsWith('=');
		const word = fold(alone ? w.slice(1) : w);
		const body = escape(word).replace(/ /g, '\\s+');
		return {
			kind,
			word: alone ? w.slice(1) : w,
			re: new RegExp(alone ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, 'u')
		};
	})
);
const ORDER = Object.keys(WORDS);

/**
 * The kind of travel cost a text speaks of, by its words: the kind with the
 * most different words found; on a tie, the more telling one. A plain
 * "ticket" counts only where no other kind is found.
 *
 * @param {string} text
 * @returns {{ kind: string, words: string[] } | null}
 */
export function guessTravel(text) {
	const folded = fold(String(text ?? ''));
	if (!folded.trim()) return null;
	/** @type {Map<string, string[]>} */
	const found = new Map();
	for (const p of PATTERNS) {
		if (!p.re.test(folded)) continue;
		const list = found.get(p.kind) ?? [];
		if (!list.includes(p.word)) list.push(p.word);
		found.set(p.kind, list);
	}
	if (!found.size) return null;
	// A plain ticket only where nothing tells more.
	const telling = [...found.entries()].filter(([k]) => k !== 'ticket');
	const [kind, words] = (telling.length ? telling : [...found.entries()]).sort(
		(a, b) => b[1].length - a[1].length || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])
	)[0];
	return { kind, words };
}

/**
 * What a receipt says of itself without being read: its file name, the
 * mail's subject, sender and excerpt, a vendor typed by hand.
 *
 * @param {Record<string, any>} r
 */
export const receiptWords = (r) =>
	[r.fileName, r.subject, r.from, r.excerpt, r.vendor]
		.filter((x) => typeof x === 'string')
		.join('\n');
