/* eslint-disable belege/no-german -- the letters' own place names and references, as they print them */
// Meal allowances and overnight rates abroad (issue #379): the per-country
// table of the Federal Ministry of Finance's yearly letter
// (Verpflegungsmehraufwendungen und Übernachtungskosten im Ausland,
// § 9 Abs. 4a Satz 5 ff. EStG), exactly as printed – euros, a row per
// country and, where the letter gives cities their own rates, per city
// (`null`: the rest of the country, "im Übrigen").
//
// The rows come from scripts/travel-rates-abroad.mjs, run on the letter's
// text; nothing here is estimated. Each year's letter is added as it is
// published, with the day it applies from (a test fails in a new year
// without one).
//
// What the letter says about countries it does not list:
//   - the Philippines' rates hold for Micronesia; Trinidad and Tobago's for
//     the states of its embassy's district (SAME_AS);
//   - an overseas or outlying territory gets its mother country's
//     (TERRITORIES: only where that is clear; Hong Kong and Macao are
//     China's, Hong Kong with its own row);
//   - any other country Luxembourg's.
// The last two are named on the statement, for the tax adviser.
//
// The overnight rates apply to an employer's refund only, never to the owner
// (#380): kept in the table, not used yet.

/**
 * @typedef {[country: string, city: string | null, full: number, partial: number, lodging: number]} AbroadRow
 *   euros: a day of 24 hours, the day of arrival or departure or more than 8 hours, a night
 * @typedef {{ from: string, source: string, rows: readonly AbroadRow[] }} AbroadLetter
 */

/** @type {readonly AbroadLetter[]} */
export const ABROAD_LETTERS = Object.freeze([
	{
		from: '2025-01-01',
		source: 'BMF-Schreiben vom 2. Dezember 2024, BStBl I 2024 S. 1549',
		rows: [
			['AF', null, 30, 20, 95],
			['EG', null, 50, 33, 112],
			['ET', null, 44, 29, 159],
			['GQ', null, 42, 28, 166],
			['AL', null, 27, 18, 112],
			['DZ', null, 47, 32, 120],
			['AD', null, 41, 28, 91],
			['AO', null, 40, 27, 368],
			['AR', null, 35, 24, 113],
			['AM', null, 29, 20, 107],
			['AZ', null, 44, 29, 88],
			['AU', 'Canberra', 74, 49, 186],
			['AU', 'Sydney', 57, 38, 173],
			['AU', null, 57, 38, 173],
			['BH', null, 48, 32, 153],
			['BD', null, 46, 31, 189],
			['BB', null, 54, 36, 206],
			['BE', null, 59, 40, 141],
			['BJ', null, 40, 27, 168],
			['BT', null, 27, 18, 176],
			['BO', null, 46, 31, 108],
			['BA', null, 23, 16, 75],
			['BW', null, 46, 31, 176],
			['BR', 'Brasilia', 51, 34, 88],
			['BR', 'Rio de Janeiro', 69, 46, 140],
			['BR', 'Sao Paulo', 46, 31, 151],
			['BR', null, 46, 31, 88],
			['BN', null, 45, 30, 110],
			['BG', null, 22, 15, 115],
			['BF', null, 38, 25, 174],
			['BI', null, 36, 24, 138],
			['CL', null, 44, 29, 154],
			['CN', 'Chengdu', 41, 28, 131],
			['CN', 'Hongkong', 71, 48, 169],
			['CN', 'Kanton', 36, 24, 150],
			['CN', 'Peking', 30, 20, 185],
			['CN', 'Shanghai', 58, 39, 217],
			['CN', null, 48, 32, 112],
			['CR', null, 60, 40, 127],
			['CI', null, 59, 40, 166],
			['DK', null, 75, 50, 183],
			['DO', null, 50, 33, 167],
			['DJ', null, 77, 52, 255],
			['EC', null, 27, 18, 103],
			['SV', null, 65, 44, 161],
			['ER', null, 46, 31, 78],
			['EE', null, 29, 20, 85],
			['FJ', null, 32, 21, 183],
			['FI', null, 54, 36, 171],
			['FR', 'Paris', 58, 39, 159],
			['FR', null, 53, 36, 105],
			['GA', null, 64, 43, 263],
			['GM', null, 40, 27, 161],
			['GE', null, 45, 30, 87],
			['GH', null, 46, 31, 203],
			['GR', 'Athen', 40, 27, 139],
			['GR', null, 36, 24, 150],
			['GT', null, 46, 31, 124],
			['GN', null, 59, 40, 140],
			['GW', null, 32, 21, 113],
			['HT', null, 58, 39, 130],
			['HN', null, 57, 38, 198],
			['IN', 'Bangalore', 42, 28, 155],
			['IN', 'Chennai', 22, 15, 80],
			['IN', 'Kalkutta', 32, 21, 167],
			['IN', 'Mumbai', 53, 36, 218],
			['IN', 'Neu Delhi', 46, 31, 211],
			['IN', null, 22, 15, 80],
			['ID', null, 45, 30, 179],
			['IR', null, 33, 22, 196],
			['IE', null, 58, 39, 129],
			['IS', null, 62, 41, 187],
			['IL', null, 66, 44, 190],
			['IT', 'Mailand', 42, 28, 191],
			['IT', 'Rom', 48, 32, 150],
			['IT', null, 42, 28, 150],
			['JM', null, 39, 26, 171],
			['JP', 'Tokio', 50, 33, 285],
			['JP', 'Osaka', 33, 22, 141],
			['JP', null, 33, 22, 141],
			['YE', null, 24, 16, 95],
			['JO', null, 57, 38, 134],
			['KH', null, 42, 28, 108],
			['CM', null, 56, 37, 275],
			['CA', 'Ottawa', 62, 41, 214],
			['CA', 'Toronto', 54, 36, 392],
			['CA', 'Vancouver', 63, 42, 304],
			['CA', null, 54, 36, 214],
			['CV', null, 38, 25, 90],
			['KZ', null, 33, 22, 108],
			['QA', null, 56, 37, 149],
			['KE', null, 51, 34, 219],
			['KG', null, 27, 18, 74],
			['CO', null, 34, 23, 123],
			['CG', null, 62, 41, 215],
			['CD', null, 65, 44, 337],
			['KP', null, 28, 19, 92],
			['KR', null, 48, 32, 108],
			['XK', null, 24, 16, 71],
			['HR', null, 46, 31, 191],
			['CU', null, 51, 34, 170],
			['KW', null, 56, 37, 241],
			['LA', null, 35, 24, 71],
			['LS', null, 28, 19, 104],
			['LV', null, 35, 24, 76],
			['LY', null, 63, 42, 135],
			['LB', null, 69, 46, 146],
			['LR', null, 65, 44, 173],
			['LI', null, 56, 37, 190],
			['LT', null, 26, 17, 109],
			['LU', null, 63, 42, 139],
			['MG', null, 33, 22, 116],
			['MW', null, 41, 28, 109],
			['MY', null, 36, 24, 86],
			['MV', null, 70, 47, 200],
			['ML', null, 38, 25, 120],
			['MT', null, 46, 31, 114],
			['MA', null, 41, 28, 87],
			['MH', null, 63, 42, 102],
			['MR', null, 35, 24, 86],
			['MU', null, 44, 29, 172],
			['MX', null, 48, 32, 177],
			['MD', null, 26, 17, 73],
			['MC', null, 52, 35, 187],
			['MN', null, 23, 16, 92],
			['ME', null, 32, 21, 85],
			['MZ', null, 51, 34, 208],
			['MM', null, 23, 16, 103],
			['NA', null, 30, 20, 112],
			['NP', null, 36, 24, 126],
			['NZ', null, 58, 39, 148],
			['NI', null, 46, 31, 105],
			['NL', null, 47, 32, 122],
			['NE', null, 42, 28, 131],
			['NG', null, 46, 31, 182],
			['MK', null, 27, 18, 89],
			['NO', null, 75, 50, 139],
			['AT', null, 50, 33, 117],
			['OM', null, 64, 43, 141],
			['PK', 'Islamabad', 23, 16, 238],
			['PK', null, 34, 23, 122],
			['PW', null, 51, 34, 193],
			['PA', null, 41, 28, 82],
			['PG', null, 59, 40, 159],
			['PY', null, 39, 26, 124],
			['PE', null, 34, 23, 143],
			['PH', null, 41, 28, 140],
			['PL', 'Breslau', 34, 23, 124],
			['PL', 'Warschau', 40, 27, 143],
			['PL', null, 34, 23, 124],
			['PT', null, 32, 21, 111],
			['RW', null, 44, 29, 117],
			['RO', 'Bukarest', 32, 21, 92],
			['RO', null, 27, 18, 89],
			['RU', 'Moskau', 30, 20, 235],
			['RU', 'St. Petersburg', 28, 19, 133],
			['RU', null, 28, 19, 133],
			['ZM', null, 38, 25, 105],
			['WS', null, 39, 26, 105],
			['SM', null, 34, 23, 79],
			['ST', null, 36, 24, 147],
			['SA', 'Djidda', 57, 38, 181],
			['SA', 'Riad', 56, 37, 186],
			['SA', null, 56, 37, 181],
			['SE', null, 66, 44, 140],
			['CH', 'Genf', 66, 44, 186],
			['CH', null, 64, 43, 180],
			['SN', null, 42, 28, 190],
			['RS', null, 27, 18, 97],
			['SL', null, 57, 38, 145],
			['ZW', null, 63, 42, 198],
			['SG', null, 71, 48, 277],
			['SK', null, 33, 22, 121],
			['SI', null, 38, 25, 126],
			['ES', 'Barcelona', 34, 23, 144],
			['ES', 'Kanarische Inseln', 36, 24, 103],
			['ES', 'Madrid', 42, 28, 131],
			['ES', 'Palma de Mallorca', 44, 29, 142],
			['ES', null, 34, 23, 103],
			['LK', null, 36, 24, 112],
			['SD', null, 33, 22, 195],
			['ZA', 'Kapstadt', 33, 22, 130],
			['ZA', 'Johannesburg', 36, 24, 129],
			['ZA', null, 29, 20, 109],
			['SS', null, 51, 34, 159],
			['SY', null, 38, 25, 140],
			['TJ', null, 27, 18, 85],
			['TW', null, 51, 34, 174],
			['TZ', null, 44, 29, 97],
			['TH', null, 36, 24, 114],
			['TG', null, 39, 26, 118],
			['TO', null, 29, 20, 102],
			['TT', null, 66, 44, 203],
			['TD', null, 42, 28, 155],
			['CZ', null, 32, 21, 77],
			['TR', 'Ankara', 32, 21, 110],
			['TR', 'Izmir', 44, 29, 120],
			['TR', null, 24, 16, 107],
			['TN', null, 40, 27, 144],
			['TM', null, 28, 19, 135],
			['UG', null, 41, 28, 143],
			['UA', null, 26, 17, 98],
			['HU', null, 32, 21, 85],
			['UY', null, 40, 27, 113],
			['UZ', null, 34, 23, 104],
			['VA', null, 48, 32, 150],
			['VE', null, 45, 30, 127],
			['AE', null, 65, 44, 156],
			['US', 'Atlanta', 77, 52, 182],
			['US', 'Boston', 63, 42, 333],
			['US', 'Chicago', 65, 44, 233],
			['US', 'Houston', 62, 41, 204],
			['US', 'Los Angeles', 64, 43, 262],
			['US', 'Miami', 65, 44, 256],
			['US', 'New York City', 66, 44, 308],
			['US', 'San Francisco', 59, 40, 327],
			['US', 'Washington, D. C.', 66, 44, 203],
			['US', null, 59, 40, 182],
			['GB', 'London', 66, 44, 163],
			['GB', null, 52, 35, 99],
			['VN', null, 36, 24, 111],
			['BY', null, 20, 13, 98],
			['CF', null, 53, 36, 210],
			['CY', null, 42, 28, 125]
		]
	},
	{
		from: '2026-01-01',
		source: 'BMF-Schreiben vom 5. Dezember 2025, IV C 5 - S 2353/00094/007/012',
		rows: [
			['EG', null, 50, 33, 112],
			['ET', null, 44, 29, 159],
			['GQ', null, 42, 28, 166],
			['AL', null, 33, 22, 116],
			['DZ', null, 47, 32, 120],
			['AD', null, 45, 30, 135],
			['AO', null, 40, 27, 368],
			['AR', null, 42, 28, 119],
			['AM', null, 29, 20, 107],
			['AZ', null, 44, 29, 88],
			['AU', 'Canberra', 74, 49, 186],
			['AU', 'Sydney', 57, 38, 173],
			['AU', null, 57, 38, 173],
			['BH', null, 48, 32, 153],
			['BD', null, 46, 31, 189],
			['BB', null, 54, 36, 206],
			['BE', null, 59, 40, 141],
			['BJ', null, 40, 27, 168],
			['BT', null, 27, 18, 176],
			['BO', null, 46, 31, 108],
			['BA', null, 32, 21, 109],
			['BW', null, 40, 27, 105],
			['BR', 'Brasilia', 51, 34, 88],
			['BR', 'Rio de Janeiro', 69, 46, 140],
			['BR', 'Sao Paulo', 46, 31, 151],
			['BR', null, 46, 31, 88],
			['BN', null, 45, 30, 110],
			['BG', null, 38, 25, 109],
			['BF', null, 39, 26, 230],
			['BI', null, 58, 39, 102],
			['CL', null, 44, 29, 154],
			['CN', 'Hongkong', 83, 56, 209],
			['CN', 'Peking', 57, 38, 184],
			['CN', 'Shanghai', 48, 32, 142],
			['CN', null, 48, 32, 142],
			['CR', null, 60, 40, 127],
			['CI', null, 60, 40, 171],
			['DK', null, 75, 50, 183],
			['DO', null, 50, 33, 167],
			['DJ', null, 77, 52, 255],
			['EC', null, 27, 18, 103],
			['SV', null, 65, 44, 161],
			['ER', null, 46, 31, 78],
			['EE', null, 39, 26, 125],
			['FJ', null, 32, 21, 183],
			['FI', null, 54, 36, 171],
			['FR', 'Paris', 58, 39, 159],
			['FR', null, 53, 36, 105],
			['GA', null, 64, 43, 263],
			['GM', null, 40, 27, 161],
			['GE', null, 45, 30, 87],
			['GH', null, 46, 31, 203],
			['GR', 'Athen', 40, 27, 139],
			['GR', null, 36, 24, 150],
			['GT', null, 46, 31, 124],
			['GN', null, 59, 40, 140],
			['GW', null, 32, 21, 113],
			['HN', null, 57, 38, 198],
			['IN', 'Bangalore', 42, 28, 155],
			['IN', 'Chennai', 22, 15, 80],
			['IN', 'Kalkutta', 32, 21, 167],
			['IN', 'Mumbai', 53, 36, 218],
			['IN', 'Neu Delhi', 46, 31, 211],
			['IN', null, 22, 15, 80],
			['ID', null, 45, 30, 179],
			['IR', null, 33, 22, 196],
			['IE', null, 64, 43, 164],
			['IS', null, 62, 41, 187],
			['IL', null, 59, 40, 268],
			['IT', 'Mailand', 42, 28, 191],
			['IT', 'Rom', 48, 32, 150],
			['IT', null, 42, 28, 150],
			['JM', null, 39, 26, 171],
			['JP', 'Tokio', 50, 33, 285],
			['JP', 'Osaka', 33, 22, 141],
			['JP', null, 33, 22, 141],
			['JO', null, 57, 38, 134],
			['KH', null, 42, 28, 108],
			['CM', null, 56, 37, 275],
			['CA', 'Ottawa', 62, 41, 214],
			['CA', 'Toronto', 54, 36, 392],
			['CA', 'Vancouver', 63, 42, 304],
			['CA', null, 54, 36, 214],
			['CV', null, 38, 25, 90],
			['KZ', null, 33, 22, 108],
			['QA', null, 81, 54, 128],
			['KE', null, 48, 32, 217],
			['KG', null, 35, 24, 80],
			['CO', null, 34, 23, 123],
			['CG', null, 53, 36, 215],
			['CD', null, 65, 44, 337],
			['KR', null, 39, 26, 130],
			['XK', null, 24, 16, 71],
			['HR', null, 46, 31, 191],
			['CU', null, 51, 34, 170],
			['KW', null, 63, 42, 224],
			['LA', null, 35, 24, 71],
			['LS', null, 28, 19, 104],
			['LV', null, 46, 31, 119],
			['LB', null, 69, 46, 146],
			['LR', null, 65, 44, 173],
			['LI', null, 57, 38, 234],
			['LT', null, 48, 32, 124],
			['LU', null, 63, 42, 139],
			['MG', null, 33, 22, 116],
			['MW', null, 41, 28, 109],
			['MY', null, 36, 24, 86],
			['MV', null, 70, 47, 200],
			['ML', null, 42, 28, 141],
			['MT', null, 59, 40, 191],
			['MA', null, 41, 28, 87],
			['MH', null, 45, 30, 112],
			['MR', null, 35, 24, 86],
			['MU', null, 44, 29, 172],
			['MX', null, 40, 27, 337],
			['MD', null, 26, 17, 73],
			['MC', null, 52, 35, 187],
			['MN', null, 23, 16, 92],
			['ME', null, 32, 21, 85],
			['MZ', null, 51, 34, 208],
			['MM', null, 23, 16, 103],
			['NA', null, 28, 19, 146],
			['NP', null, 33, 22, 125],
			['NZ', null, 58, 39, 148],
			['NI', null, 46, 31, 105],
			['NL', null, 58, 39, 167],
			['NE', null, 42, 28, 131],
			['NG', null, 52, 35, 202],
			['MK', null, 27, 18, 89],
			['NO', null, 75, 50, 139],
			['AT', null, 50, 33, 117],
			['OM', null, 64, 43, 141],
			['PK', null, 41, 28, 199],
			['PW', null, 51, 34, 193],
			['PA', null, 41, 28, 82],
			['PG', null, 59, 40, 159],
			['PY', null, 39, 26, 124],
			['PE', null, 52, 35, 128],
			['PH', null, 41, 28, 140],
			['PL', 'Breslau', 34, 23, 124],
			['PL', 'Warschau', 40, 27, 143],
			['PL', null, 34, 23, 124],
			['PT', null, 32, 21, 111],
			['RW', null, 44, 29, 117],
			['RO', null, 38, 25, 103],
			['RU', 'Moskau', 30, 20, 235],
			['RU', 'St. Petersburg', 28, 19, 133],
			['RU', null, 28, 19, 133],
			['ZM', null, 38, 25, 105],
			['WS', null, 39, 26, 105],
			['SM', null, 34, 23, 79],
			['ST', null, 36, 24, 147],
			['SA', 'Djidda', 57, 38, 181],
			['SA', 'Riad', 56, 37, 186],
			['SA', null, 56, 37, 181],
			['SE', null, 66, 44, 140],
			['CH', 'Bern', 82, 55, 195],
			['CH', 'Genf', 70, 47, 197],
			['CH', null, 70, 47, 195],
			['SN', null, 48, 32, 160],
			['RS', null, 27, 18, 97],
			['SL', null, 57, 38, 145],
			['ZW', null, 63, 42, 198],
			['SG', null, 71, 48, 277],
			['SK', null, 33, 22, 121],
			['SI', null, 38, 25, 126],
			['ES', 'Barcelona', 34, 23, 144],
			['ES', 'Kanarische Inseln', 36, 24, 103],
			['ES', 'Madrid', 42, 28, 131],
			['ES', 'Palma de Mallorca', 44, 29, 142],
			['ES', null, 34, 23, 103],
			['LK', null, 36, 24, 112],
			['ZA', 'Kapstadt', 33, 22, 130],
			['ZA', 'Johannesburg', 36, 24, 129],
			['ZA', null, 29, 20, 109],
			['SS', null, 51, 34, 159],
			['TJ', null, 27, 18, 85],
			['TW', null, 51, 34, 174],
			['TZ', null, 44, 29, 97],
			['TH', null, 36, 24, 114],
			['TG', null, 36, 24, 144],
			['TO', null, 29, 20, 102],
			['TT', null, 66, 44, 203],
			['TD', null, 42, 28, 155],
			['CZ', null, 32, 21, 77],
			['TR', 'Ankara', 32, 21, 110],
			['TR', 'Izmir', 44, 29, 120],
			['TR', null, 24, 16, 107],
			['TN', null, 40, 27, 144],
			['TM', null, 28, 19, 135],
			['UG', null, 45, 30, 207],
			['UA', null, 33, 22, 180],
			['HU', null, 32, 21, 85],
			['UY', null, 40, 27, 113],
			['UZ', null, 32, 21, 133],
			['VA', null, 48, 32, 150],
			['VE', null, 51, 34, 178],
			['AE', null, 81, 54, 169],
			['US', 'Atlanta', 77, 52, 182],
			['US', 'Boston', 63, 42, 333],
			['US', 'Chicago', 65, 44, 233],
			['US', 'Houston', 62, 41, 204],
			['US', 'Los Angeles', 64, 43, 262],
			['US', 'Miami', 65, 44, 256],
			['US', 'New York City', 66, 44, 308],
			['US', 'San Francisco', 59, 40, 327],
			['US', 'Washington, D. C.', 66, 44, 203],
			['US', null, 59, 40, 182],
			['GB', 'London', 66, 44, 163],
			['GB', null, 52, 35, 99],
			['VN', null, 36, 24, 111],
			['BY', null, 21, 14, 148],
			['CF', null, 53, 36, 210],
			['CY', null, 42, 28, 125]
		]
	}
]);

/** Countries the letter gives another one's rates. */
export const SAME_AS = Object.freeze({
	FM: 'PH',
	...Object.fromEntries(['AG', 'DM', 'GD', 'GY', 'KN', 'LC', 'VC', 'SR'].map((c) => [c, 'TT']))
});

/** Overseas and outlying territories with a code of their own → the mother country. */
export const TERRITORIES = Object.freeze({
	...Object.fromEntries(
		['GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF', 'WF', 'PF', 'NC', 'TF'].map((c) => [c, 'FR'])
	),
	...Object.fromEntries(['PR', 'GU', 'VI', 'AS', 'MP', 'UM'].map((c) => [c, 'US'])),
	...Object.fromEntries(
		['GI', 'BM', 'KY', 'VG', 'TC', 'AI', 'MS', 'FK', 'SH', 'IO', 'PN', 'GS'].map((c) => [c, 'GB'])
	),
	...Object.fromEntries(['GL', 'FO'].map((c) => [c, 'DK'])),
	...Object.fromEntries(['SJ', 'BV'].map((c) => [c, 'NO'])),
	...Object.fromEntries(['CX', 'CC', 'NF', 'HM'].map((c) => [c, 'AU'])),
	BQ: 'NL',
	TK: 'NZ',
	MO: 'CN'
});

/** For a country the letter does not list. */
export const NOT_LISTED = 'LU';

/**
 * @typedef {object} AbroadRate
 * @property {string} country whose row it is
 * @property {string | null} city the row's city; null: the rest of the country
 * @property {string} from YYYY-MM-DD, the letter's
 * @property {number} full cents
 * @property {number} partial cents
 * @property {number} lodging cents, a night (an employer's refund only)
 * @property {string} source
 * @property {'district' | 'territory' | 'notListed' | null} via why another country's row
 */

/** The letter in force on a day. @param {string} day */
const letterOn = (day) =>
	ABROAD_LETTERS.filter((l) => l.from <= day).reduce(
		(/** @type {AbroadLetter | null} */ a, l) => (!a || l.from > a.from ? l : a),
		null
	);

/**
 * The rates of a country, and of a city in it, on a day: null before the
 * first letter in the table.
 *
 * @param {string} country ISO 3166 alpha-2, not DE
 * @param {string} day YYYY-MM-DD
 * @param {string | null} [city] a city as the letter names it; one it does not list (any more): the rest of the country
 * @returns {AbroadRate | null}
 */
export function abroadRate(country, day, city = null) {
	const letter = letterOn(day);
	if (!letter) return null;
	let code = country;
	let place = city;
	/** @type {AbroadRate['via']} */
	let via = null;
	// The letter lists Hong Kong as a city of China.
	if (code === 'HK') {
		code = 'CN';
		place = 'Hongkong';
	}
	const rowsOf = (/** @type {string} */ c) => letter.rows.filter((r) => r[0] === c);
	let rows = rowsOf(code);
	if (!rows.length) {
		const same = SAME_AS[/** @type {keyof typeof SAME_AS} */ (code)];
		const mother = TERRITORIES[/** @type {keyof typeof TERRITORIES} */ (code)];
		[code, via] = same
			? [same, 'district']
			: mother && rowsOf(mother).length
				? [mother, 'territory']
				: [NOT_LISTED, 'notListed'];
		place = null;
		rows = rowsOf(code);
	}
	const row = rows.find((r) => place && r[1] === place) ?? rows.find((r) => r[1] === null);
	if (!row) return null;
	return {
		country: code,
		city: row[1],
		from: letter.from,
		full: row[2] * 100,
		partial: row[3] * 100,
		lodging: row[4] * 100,
		source: letter.source,
		via
	};
}

/**
 * The cities with rates of their own in a country on a day, as the letter
 * names them.
 *
 * @param {string} country
 * @param {string} day
 * @returns {string[]}
 */
export function abroadCities(country, day) {
	const letter = letterOn(day);
	if (!letter) return [];
	const code = country === 'HK' ? '' : country;
	return letter.rows
		.filter((r) => r[0] === code && r[1] !== null)
		.map((r) => /** @type {string} */ (r[1]));
}
