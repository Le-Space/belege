// Draws a travel expense statement (statement.js) as an A4 PDF in the look
// of the other Eigenbelege (pdf/statement-layout.js): the traveller and the
// month, each trip with its times, allowance per day, mileage and receipts,
// the hospitality bills, the totals and what is paid back, the rates used
// with their sources, the warnings, and a line to sign. German, as a
// document for German bookkeeping. Loaded on first use.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { formatDate } from '../bank/format.js';
import { amount } from '../export/datev.js';
import { statementLayout } from '../pdf/statement-layout.js';
import { tripTimes } from './statement.js';

/** @param {number | null} cents */
const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);

const KIND = /** @type {Record<string, string>} */ ({
	full: 'ganzer Tag',
	partial: 'An-/Abreise, > 8 Std.',
	none: 'keine'
});
const REASON = /** @type {Record<string, string>} */ ({
	under8h: 'höchstens 8 Std.',
	countedOnOtherDay: 'am anderen Tag gezählt',
	noRate: 'kein Satz für dieses Land',
	threeMonthRule: 'Dreimonatsregel'
});
const RECEIPT_KIND = /** @type {Record<string, string>} */ ({
	train: 'Bahn',
	bus: 'Bus',
	flight: 'Flug',
	public_transport: 'ÖPNV',
	taxi: 'Taxi',
	rental_car: 'Mietwagen',
	fuel: 'Tanken',
	parking: 'Parken',
	hotel: 'Übernachtung',
	restaurant: 'Bewirtung',
	event: 'Veranstaltung',
	ticket: 'Fahrkarte'
});
const REFUSED = /** @type {Record<string, string>} */ ({
	rental: 'Mietwagen: keine Kilometer',
	company: 'Firmenwagen: keine Kilometer',
	noFlatRate: 'keine Pauschale',
	noKm: 'keine km'
});
const WARNING = /** @type {Record<string, string>} */ ({
	noRateAbroad: 'Auslandstag ohne Satz: ohne Betrag abgerechnet.',
	familyCar: 'Fahrzeug eines Familienangehörigen: mit der Steuerberatung zu klären.',
	foreignCurrency: 'Beleg in fremder Währung: Betrag wie erfasst.'
});

/**
 * @param {object} doc
 * @param {string} doc.number RK-YYYY-NNN
 * @param {string} doc.issuer the company
 * @param {string} doc.traveller the traveller's name
 * @param {string} doc.role `owner`, or another role as written
 * @param {string} doc.month YYYY-MM
 * @param {string} doc.createdAt ISO
 * @param {string | null} doc.corrects the number of the statement this one replaces
 * @param {import('./statement.js').Statement} doc.statement
 * @returns {Promise<Uint8Array>}
 */
export async function travelStatementPdf(doc) {
	const s = doc.statement;
	const { width, head, field, rule, heading, table, signature, save } = await statementLayout({
		title: `Reisekostenabrechnung ${doc.number} – ${doc.month}`,
		created: new Date(doc.createdAt),
		continuation: `${doc.number} · Reisekostenabrechnung ${doc.month} (Fortsetzung)`
	});
	head(
		doc.number,
		doc.issuer,
		`Monat ${doc.month} · erstellt am ${formatDate(doc.createdAt.slice(0, 10), 'de-DE')}`,
		'Reisekostenabrechnung'
	);
	const role = doc.role === 'owner' ? 'Inhaber/Geschäftsführung' : doc.role;
	field('Reisende(r)', `${doc.traveller || '—'}${role ? ` (${role})` : ''}`, true);
	if (doc.corrects) field('Ersetzt', `Abrechnung ${doc.corrects}`);
	field('Zu erstatten', euro(s.totals.toPayBackCents), true);
	rule();

	s.trips.forEach((x, i) => {
		heading(`Reise ${i + 1}: ${x.trip.destination || '—'}`);
		field('Anlass', x.trip.reason || '—');
		field('Zeitraum', tripTimes(x.trip));
		if (x.trip.place) field('Tätigkeitsstätte', x.trip.place);
		const days = x.figures.allowance?.days ?? [];
		if (days.length) {
			table(
				[
					{ title: 'Tag', width: 70 },
					{ title: 'Art', width: 130 },
					{ title: 'Land', width: 40 },
					{ title: 'Hinweis', width: width - 320 },
					{ title: 'Betrag', width: 80, right: true }
				],
				days.map((d) => [
					formatDate(d.date, 'de-DE'),
					KIND[d.kind] ?? d.kind,
					d.country,
					[d.reason ? REASON[d.reason] : '', d.cutCents ? `Mahlzeiten −${euro(d.cutCents)}` : '']
						.filter(Boolean)
						.join(', '),
					d.cents === null ? '—' : euro(d.cents)
				])
			);
		}
		const lines = x.figures.mileage;
		if (lines.length) {
			table(
				[
					{ title: 'Fahrt', width: 70 },
					{ title: 'Strecke, Anlass', width: width - 230 },
					{ title: 'km', width: 50, right: true },
					{ title: 'Satz', width: 30, right: true },
					{ title: 'Betrag', width: 80, right: true }
				],
				lines.map((/** @type {any} */ m) => {
					const line = x.trip.mileage.find((/** @type {any} */ l) => l.id === m.id) ?? {};
					return [
						line.date ? formatDate(line.date, 'de-DE') : '—',
						[
							`${line.from || '…'} – ${line.to || '…'}${line.roundTrip ? ' und zurück' : ''}`,
							line.reason,
							line.vehicle === 'family'
								? `Fahrzeug: ${line.owner || 'Familienangehörige(r)'}, Kosten trägt ${line.costBearer || '—'}`
								: ''
						]
							.filter(Boolean)
							.join(' · '),
						String(m.km).replace('.', ','),
						m.rate ? amount(m.rate.perKm) : '—',
						m.refused ? (REFUSED[m.refused] ?? m.refused) : euro(m.cents)
					];
				})
			);
		}
		if (x.receipts.length) {
			table(
				[
					{ title: 'Datum', width: 70 },
					{ title: 'Beleg', width: width - 290 },
					{ title: 'USt', width: 60, right: true },
					{ title: 'Bezahlt', width: 70 },
					{ title: 'Brutto', width: 90, right: true }
				],
				x.receipts.map((l) => [
					l.date ? formatDate(l.date, 'de-DE') : '—',
					`${l.kind ? `${RECEIPT_KIND[l.kind] ?? l.kind}: ` : ''}${l.vendor}`,
					l.vat.map((v) => `${v.rate} %`).join(', '),
					l.outlay ? 'Auslage' : l.paidBy === 'private' ? 'privat' : 'Firma',
					l.grossCents === null ? '—' : `${amount(l.grossCents)} ${l.currency}`
				])
			);
		}
		field(
			'Pauschalen',
			`Verpflegung ${euro(x.figures.allowanceCents)} · Kilometer ${euro(x.figures.mileageCents)}`
		);
		rule();
	});

	if (s.hospitality.length) {
		heading('Bewirtungen ohne Reise');
		table(
			[
				{ title: 'Datum', width: 70 },
				{ title: 'Beleg', width: width - 330 },
				{ title: 'abziehbar', width: 90, right: true },
				{ title: 'nicht abziehbar', width: 90, right: true },
				{ title: 'Bezahlt', width: 80 }
			],
			s.hospitality.map((h) => [
				h.line.date ? formatDate(h.line.date, 'de-DE') : '—',
				h.line.vendor,
				euro(h.split.deductibleCents),
				euro(h.split.nonDeductibleCents),
				h.line.outlay ? 'Auslage' : h.line.paidBy === 'private' ? 'privat' : 'Firma'
			])
		);
		rule();
	}

	heading('Summen');
	field('Verpflegungspauschalen', euro(s.totals.allowanceCents));
	field('Kilometer', euro(s.totals.mileageCents));
	field('Belege privat bezahlt', euro(s.totals.privateCents));
	if (s.totals.outlayCents)
		field(
			'Als Auslage gebucht',
			`${euro(s.totals.outlayCents)} (über das Auslagenkonto erstattet)`
		);
	field('Belege von der Firma bezahlt', `${euro(s.totals.companyCents)} (nicht erstattet)`);
	for (const [rate, cents] of Object.entries(s.totals.vatByRate))
		field(`Vorsteuer ${rate} %`, euro(cents));
	if (s.totals.hospitalityDeductibleCents || s.totals.hospitalityNonDeductibleCents) {
		field(
			'Bewirtung',
			`abziehbar ${euro(s.totals.hospitalityDeductibleCents)} · nicht abziehbar ${euro(s.totals.hospitalityNonDeductibleCents)}`
		);
	}
	field('Zu erstatten', euro(s.totals.toPayBackCents), true);
	rule();

	heading('Angewandte Sätze');
	for (const r of s.rates) {
		if (r.kind === 'meal')
			field(
				`Verpflegung ${r.country}`,
				`${euro(r.full)} / ${euro(r.partial)} ab ${formatDate(r.from, 'de-DE')} · ${r.source}`
			);
		else if (r.kind === 'mileage')
			field(
				'Kilometer',
				`${amount(r.perKm)} EUR/km ab ${formatDate(r.from, 'de-DE')} · ${r.source}`
			);
		else if (r.kind === 'hospitality')
			field(
				'Bewirtung',
				`${Math.round(r.deductible * 100)} % abziehbar ab ${formatDate(r.from, 'de-DE')} · ${r.source}`
			);
	}
	const warnings = [
		...new Set(s.checks.filter((c) => c.level === 'warning').map((c) => WARNING[c.code] ?? c.code))
	];
	if (warnings.length) {
		rule();
		heading('Hinweise');
		for (const w of warnings) field('', w);
	}
	field(
		'',
		'Gesetzliche Pauschalen nach EStG. Keine Steuerberatung: Sätze und Konten sind mit der Steuerberatung abzustimmen.'
	);
	signature();
	return save();
}
