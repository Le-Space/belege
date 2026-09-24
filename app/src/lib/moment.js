// Ported from Le-Space/simple-todo packages/todo (src/moment.js) at f0d3df4. Changed: nothing but
// this header.
//
/**
 * How the chapters write a moment — a build, a deadline, anything with a time
 * of day — following the Le-Space time and date convention
 * (le-space/landing, AGENTS.md "Time and date convention").
 *
 * In the reader's own terms: their locale's format, their clock, and the zone
 * named, because around midnight a time without its zone names the wrong day
 * for half the readers. The same instant in UTC goes into `title`, for
 * hovering, and into `<time datetime>`, for machines.
 *
 * One definition, used by the components and by the tests that read the page
 * as two readers on two continents.
 */
export const STAMP_FORMAT = /** @type {const} */ ({
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	timeZoneName: 'short'
});

/**
 * @param {Date} date
 * @param {string | string[]} [locale] the reader's, when left out
 * @param {string} [timeZone] the reader's, when left out
 * @returns {string} e.g. `20.09.2026, 00:48 MESZ` or `09/19/2026, 06:48 PM EDT`
 */
export function localStamp(date, locale, timeZone) {
	return new Intl.DateTimeFormat(locale, { ...STAMP_FORMAT, timeZone }).format(date);
}

/**
 * @param {Date} date
 * @returns {string} e.g. `2026-09-19 22:48 UTC`
 */
export function utcStamp(date) {
	return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Everything a `<time>` element needs, or null for a value that is no moment.
 *
 * Values arrive from other peers as well as from this one, so an unparseable
 * one is expected rather than exceptional — and `toISOString()` on an invalid
 * date throws, which would take the whole row down with it.
 *
 * @param {string | number | Date | null | undefined} value
 * @param {string | string[]} [locale]
 * @param {string} [timeZone]
 * @returns {{ datetime: string, local: string, utc: string } | null}
 */
export function describeMoment(value, locale, timeZone) {
	if (value === null || value === undefined || value === '') return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return {
		datetime: date.toISOString(),
		local: localStamp(date, locale, timeZone),
		utc: utcStamp(date)
	};
}
