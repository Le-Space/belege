// The year the pages show (issue #100): one choice for all of them, kept in
// this browser only – a convenience, not part of the books. Without a choice,
// or when storage is not available, the newest year with a payment.

import { app } from '../session.svelte.js';
import { cleanDatevSettings } from '../booking/settings.js';
import { availableYears, defaultYear, yearIndex } from './year.js';

const KEY = 'belege.year';
/** Today, for the default year: a moment, not reactive state. */
const today = () => new Date().toISOString();

function stored() {
	try {
		const n = Number(localStorage.getItem(KEY));
		return Number.isInteger(n) && n > 1900 ? n : null;
	} catch {
		return null;
	}
}

export const yearView = $state({
	/** @type {number | null} */
	chosen: stored()
});

/** The month the fiscal year starts in (DATEV settings), 1–12. */
export const startMonth = () => cleanDatevSettings(app.datevSettings).fiscalYearStartMonth;

/** The year shown: the one chosen, else the newest with a payment (year.js defaultYear). */
export function shownYear() {
	return yearView.chosen ?? defaultYear(app, today(), startMonth());
}

/** @param {number} year */
export function chooseYear(year) {
	yearView.chosen = year;
	try {
		localStorage.setItem(KEY, String(year));
	} catch {
		// Not kept: the choice holds until the page is reloaded.
	}
}

/** The years to offer, newest first. */
export const yearChoices = () => availableYears(app, today(), startMonth());

/** The index over the open books, for filtering by year. */
export const booksByYear = () => yearIndex(app, startMonth());
