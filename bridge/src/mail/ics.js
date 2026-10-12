// Appointments from a mail's calendar part (`.ics`, `text/calendar`; issue
// #213, step 4c): an invitation to an event, a meeting, a conference. Pure.
//
// Only what a trip needs is read: the title, the place, the start and the
// end. Organiser, attendees, description and links are not – they hold
// people's names and addresses and tracking links, and a trip needs none
// of them.
//
// Times are wall-clock times, as a trip keeps them (`YYYY-MM-DDTHH:MM`):
// a time with its own zone (`TZID=`) as written there, a UTC time (`…Z`)
// as it is in Germany, a floating time as written. A day without a time is
// an all-day appointment; its end is exclusive, as the format has it.

/** At most this many appointments from one calendar part. */
export const MAX_EVENTS = 5;

/**
 * @typedef {object} Appointment
 * @property {string} summary the title, at most 200 characters
 * @property {string} location the place, at most 200 characters; '' when none
 * @property {string} start YYYY-MM-DDTHH:MM, or YYYY-MM-DD all day
 * @property {string} end the same form; for all day the last day itself
 * @property {boolean} allDay
 * @property {boolean} cancelled the invitation says it is off
 */

/** A content line's value with its escapes undone. @param {string} v */
const unescape = (v) =>
	v
		.replace(/\\n/gi, ' ')
		.replace(/\\([,;\\])/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();

/** @param {string} day YYYY-MM-DD @param {number} n */
const shift = (day, n) => {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

/** A UTC moment as a wall-clock time in Germany. @param {Date} d */
function berlin(d) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(d)
			.map((p) => [p.type, p.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * A DTSTART or DTEND value as a wall-clock time or a day.
 *
 * @param {string} params what stands between the name and the colon
 * @param {string} value
 * @returns {{ at: string, allDay: boolean } | null}
 */
function moment(params, value) {
	const v = value.trim();
	const day = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
	if (day || /VALUE=DATE(?!-)/i.test(params)) {
		if (!day) return null;
		return { at: `${day[1]}-${day[2]}-${day[3]}`, allDay: true };
	}
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
	if (!m) return null;
	const [, y, mo, d, h, mi, , z] = m;
	if (Number(h) > 23 || Number(mi) > 59) return null;
	if (z) return { at: berlin(new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`)), allDay: false };
	return { at: `${y}-${mo}-${d}T${h}:${mi}`, allDay: false };
}

/**
 * The appointments of an iCalendar text.
 *
 * @param {string} text
 * @returns {Appointment[]}
 */
export function parseIcs(text) {
	// Unfold: a line that starts with a space or a tab goes on the one before.
	const lines = String(text ?? '')
		.replace(/\r\n|\r/g, '\n')
		.replace(/\n[ \t]/g, '')
		.split('\n');
	const method =
		lines
			.find((l) => /^METHOD:/i.test(l))
			?.slice(7)
			.trim()
			.toUpperCase() ?? '';
	/** @type {Appointment[]} */
	const out = [];
	/** @type {Record<string, { params: string, value: string }> | null} */
	let event = null;
	for (const line of lines) {
		if (/^BEGIN:VEVENT$/i.test(line.trim())) {
			event = {};
			continue;
		}
		if (/^END:VEVENT$/i.test(line.trim())) {
			const a = event && appointment(event, method);
			if (a) out.push(a);
			event = null;
			if (out.length >= MAX_EVENTS) break;
			continue;
		}
		if (!event) continue;
		const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
		if (!m) continue;
		const name = m[1].toUpperCase();
		if (['SUMMARY', 'LOCATION', 'DTSTART', 'DTEND', 'DURATION', 'STATUS'].includes(name))
			event[name] ??= { params: m[2], value: m[3] };
	}
	return out;
}

/**
 * @param {Record<string, { params: string, value: string }>} e
 * @param {string} method
 * @returns {Appointment | null}
 */
function appointment(e, method) {
	if (!e.DTSTART) return null;
	const start = moment(e.DTSTART.params, e.DTSTART.value);
	if (!start) return null;
	let end = e.DTEND ? moment(e.DTEND.params, e.DTEND.value) : null;
	if (!end && e.DURATION && !start.allDay) {
		const d = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(e.DURATION.value.trim());
		if (d) {
			const ms = ((Number(d[1] ?? 0) * 24 + Number(d[2] ?? 0)) * 60 + Number(d[3] ?? 0)) * 60000;
			const at = new Date(Date.parse(`${start.at}:00Z`) + ms).toISOString().slice(0, 16);
			end = { at, allDay: false };
		}
	}
	/** @type {string} */
	let last;
	if (start.allDay) {
		// DTEND of an all-day event is the day after; without one, the day itself.
		last = end?.allDay && end.at > start.at ? shift(end.at, -1) : start.at;
	} else {
		last = end && !end.allDay && end.at >= start.at ? end.at : start.at;
	}
	return {
		summary: unescape(e.SUMMARY?.value ?? '').slice(0, 200),
		location: unescape(e.LOCATION?.value ?? '').slice(0, 200),
		start: start.at,
		end: last,
		allDay: start.allDay,
		cancelled: method === 'CANCEL' || /^CANCELLED$/i.test(e.STATUS?.value.trim() ?? '')
	};
}
