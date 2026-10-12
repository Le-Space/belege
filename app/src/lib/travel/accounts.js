// Which SKR 03 account a travel cost goes on (issue #213, step 6), by its
// category and the traveller's set:
//
//   employee  the managing shareholder of a UG/GmbH is employed by it: travel
//             costs of employees (4660 …), mileage paid back as such (4668)
//   owner     a sole proprietor or partner travels as the business itself:
//             travel costs of the owner (4670 …)
//
// The set follows the legal form in Buchhaltung (booking/settings.js). The
// numbers are the usual SKR 03 ones, checked against public SKR 03 tables,
// not DATEV's own chart: suggestions, to be confirmed with the tax adviser,
// as every account in the catalogue (booking/skr03.js). Pure.

/* eslint-disable belege/no-german -- SKR 03 account names are German by nature (#192) */

/**
 * @typedef {'fares' | 'accommodation' | 'meals' | 'mileage' | 'incidental' | 'hospitality' | 'hospitalityNonDeductible'} TravelCategory
 * @typedef {'employee' | 'owner'} TravelSet
 */

/** @type {Readonly<Record<TravelSet, Record<TravelCategory, { number: string, name: string }>>>} */
export const TRAVEL_ACCOUNTS = Object.freeze({
	employee: {
		fares: { number: '4663', name: 'Reisekosten Arbeitnehmer Fahrtkosten' },
		accommodation: { number: '4666', name: 'Reisekosten Arbeitnehmer Übernachtungsaufwand' },
		meals: { number: '4664', name: 'Reisekosten Arbeitnehmer Verpflegungsmehraufwand' },
		mileage: { number: '4668', name: 'Kilometergelderstattung Arbeitnehmer' },
		incidental: { number: '4660', name: 'Reisekosten Arbeitnehmer' },
		hospitality: { number: '4650', name: 'Bewirtungskosten' },
		hospitalityNonDeductible: { number: '4654', name: 'Nicht abzugsfähige Bewirtungskosten' }
	},
	owner: {
		fares: { number: '4673', name: 'Reisekosten Unternehmer Fahrtkosten' },
		accommodation: { number: '4676', name: 'Reisekosten Unternehmer Übernachtungsaufwand' },
		meals: { number: '4674', name: 'Reisekosten Unternehmer Verpflegungsmehraufwand' },
		mileage: { number: '4673', name: 'Reisekosten Unternehmer Fahrtkosten' },
		incidental: { number: '4670', name: 'Reisekosten Unternehmer' },
		hospitality: { number: '4650', name: 'Bewirtungskosten' },
		hospitalityNonDeductible: { number: '4654', name: 'Nicht abzugsfähige Bewirtungskosten' }
	}
});

/**
 * The set by the legal form: a UG/GmbH's managing shareholder is employed
 * by it; anyone else travels as the owner. Not said yet: the owner's.
 *
 * @param {{ legalForm?: string }} settings cleaned
 * @returns {TravelSet}
 */
export const travelSet = (settings) =>
	settings?.legalForm === 'corporation' ? 'employee' : 'owner';

const FARES = new Set([
	'train',
	'bus',
	'flight',
	'public_transport',
	'taxi',
	'rental_car',
	'fuel',
	'parking',
	'ticket'
]);

/**
 * A receipt's category: a fare (fuel and parking too), a hotel, a
 * hospitality bill, or anything else on a trip (an event's ticket, a
 * luggage fee).
 *
 * @param {Record<string, any>} receipt
 * @param {string | null} kind its travel kind (view.js travelKind)
 * @returns {TravelCategory}
 */
export function receiptCategory(receipt, kind) {
	if (receipt.hospitality) return 'hospitality';
	if (kind === 'hotel') return 'accommodation';
	if (kind && FARES.has(kind)) return 'fares';
	return 'incidental';
}

/** @param {TravelSet} set @param {TravelCategory} category */
export const travelAccount = (set, category) => TRAVEL_ACCOUNTS[set][category];
