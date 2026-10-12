// The rates and limits of travel expenses (issue #213, step 1), as data:
// each with the day it applies from and where it comes from, so a statement
// can keep the ones it used and stay reproducible after they change.
//
// The defaults are the German statutory ones for the owner or managing
// shareholder travelling in Germany (decided 12.10.: Germany first, the
// statutory allowances exactly, no lower company rate). Rates abroad are not
// in the table yet: a day abroad finds no rate and says so, nothing is made
// up. All of it is to be confirmed with the tax adviser before the first real
// statement.

/**
 * @typedef {object} MealRate
 * @property {string} country ISO 3166 alpha-2
 * @property {string} from YYYY-MM-DD
 * @property {number} full cents, a day of 24 hours away
 * @property {number} partial cents, more than 8 hours, or the day of arrival or departure
 * @property {string} source
 */

/** @type {readonly MealRate[]} */
export const MEAL_RATES = Object.freeze([
	{ country: 'DE', from: '2014-01-01', full: 2400, partial: 1200, source: '§ 9 Abs. 4a EStG' },
	{ country: 'DE', from: '2020-01-01', full: 2800, partial: 1400, source: '§ 9 Abs. 4a EStG' }
]);

/**
 * A meal provided cuts the day's allowance by a share of the full day's rate
 * in the country, at most down to nothing.
 */
export const MEAL_CUTS = Object.freeze([
	{
		from: '2014-01-01',
		breakfast: 0.2,
		lunch: 0.4,
		dinner: 0.4,
		source: '§ 9 Abs. 4a Satz 8 EStG'
	}
]);

/**
 * The allowance at the same place of activity ends after three months; an
 * interruption of four weeks starts them again.
 */
export const THREE_MONTH_RULE = Object.freeze([
	{ from: '2014-01-01', months: 3, restartAfterDays: 28, source: '§ 9 Abs. 4a Satz 6, 7 EStG' }
]);

/**
 * Per kilometre driven with a private vehicle, by its type. A bicycle has no
 * flat rate: its actual costs, with receipts.
 */
export const MILEAGE_RATES = Object.freeze([
	{
		from: '2014-01-01',
		car: 30,
		motorcycle: 20,
		source: '§ 9 Abs. 1 Satz 3 Nr. 4a EStG, § 5 Abs. 2 BRKG'
	}
]);

/** The deductible share of a hospitality meal; its input VAT counts in full. */
export const HOSPITALITY = Object.freeze([
	{ from: '2004-01-01', deductible: 0.7, source: '§ 4 Abs. 5 Satz 1 Nr. 2 EStG' }
]);

/** Up to this gross (cents), an invoice needs less to count for input VAT. */
export const SMALL_AMOUNT_INVOICE = Object.freeze([
	{ from: '2017-01-01', grossCents: 25000, source: '§ 33 UStDV' }
]);

/**
 * The entry of a table that applies on a day: the latest one from before it
 * that matches.
 *
 * @template {{ from: string }} T
 * @param {readonly T[]} table
 * @param {string} day YYYY-MM-DD
 * @param {(entry: T) => boolean} [match]
 * @returns {T | null}
 */
export function rateOn(table, day, match = () => true) {
	/** @type {T | null} */
	let found = null;
	for (const entry of table) {
		if (entry.from <= day && match(entry) && (!found || entry.from >= found.from)) found = entry;
	}
	return found;
}

/** @param {string} country @param {string} day */
export const mealRate = (country, day) => rateOn(MEAL_RATES, day, (r) => r.country === country);
