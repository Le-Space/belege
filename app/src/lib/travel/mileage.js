// Mileage with a private vehicle (issue #213, step 1): the route is the
// record, the rate comes from the table by the vehicle's type. Pure; cents.
//
// Whose vehicle decides whether there is mileage at all:
//   own        the traveller's: the flat rate
//   family     a family member's (a spouse's, a parent's): the flat rate, but
//              flagged until a setting says how such lines are treated –
//              whether the rate may be paid back when someone else bears the
//              car's costs ("Drittaufwand") is the tax adviser's to confirm
//   rental     no mileage: the rental and the fuel are receipts
//   company    no mileage: the company already bears the car's costs

import { MILEAGE_RATES, rateOn } from './rates.js';

/**
 * @typedef {'own' | 'family' | 'rental' | 'company'} Vehicle
 * @typedef {'car' | 'motorcycle' | 'bicycle'} VehicleType motorcycle: any other motor vehicle (moped, scooter)
 * @typedef {'ask' | 'flatRate' | 'none'} FamilyCarRule
 *   ask (default): the flat rate, flagged; flatRate: the flat rate; none: nothing
 * @typedef {object} MileageLine
 * @property {string} date YYYY-MM-DD
 * @property {string} from
 * @property {string} to the destination or the customer
 * @property {string} reason the business reason
 * @property {number} km one way
 * @property {boolean} [roundTrip] there and back: counted twice
 * @property {Vehicle} vehicle
 * @property {VehicleType} [type] car by default
 * @property {string} [owner] for a family member's car: who, by relation
 * @property {string} [costBearer] for a family member's car: who bears its running costs
 */

/**
 * @param {MileageLine} line
 * @param {{ familyCar?: FamilyCarRule }} [settings]
 * @returns {{
 *   km: number,
 *   cents: number,
 *   rate: { from: string, perKm: number, source: string } | null,
 *   refused: 'rental' | 'company' | 'noFlatRate' | 'noKm' | null,
 *   flag: 'familyCar' | null
 * }}
 */
export function mileage(line, settings = {}) {
	const km = Number.isFinite(line.km) && line.km > 0 ? line.km * (line.roundTrip ? 2 : 1) : 0;
	const none = (/** @type {'rental' | 'company' | 'noFlatRate' | 'noKm'} */ refused) => ({
		km,
		cents: 0,
		rate: null,
		refused,
		flag: null
	});
	if (line.vehicle === 'rental') return none('rental');
	if (line.vehicle === 'company') return none('company');
	if (!km) return none('noKm');
	const type = line.type ?? 'car';
	const table = rateOn(MILEAGE_RATES, line.date);
	const perKm = table && type !== 'bicycle' ? table[type] : undefined;
	if (!table || perKm === undefined) return none('noFlatRate');
	const rate = { from: table.from, perKm, source: table.source };
	if (line.vehicle === 'family') {
		const rule = settings.familyCar ?? 'ask';
		if (rule === 'none') return { km, cents: 0, rate, refused: null, flag: null };
		return {
			km,
			cents: Math.round(km * perKm),
			rate,
			refused: null,
			flag: rule === 'ask' ? 'familyCar' : null
		};
	}
	return { km, cents: Math.round(km * perKm), rate, refused: null, flag: null };
}
