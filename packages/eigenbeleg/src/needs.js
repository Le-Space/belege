// SPDX-License-Identifier: AGPL-3.0-or-later
// Which movement needs an Eigenbeleg of its own (Le-Space/eigenbeleg-agent#116,
// step 2): only value consumed where nobody invoices it – the usage of a
// prepaid balance on Aleph, Filecoin Pay or Akash, put on the monthly
// consumption Eigenbeleg (consumption.js). Everything else a chain shows is
// documented by the account statement (Kontoauszug), as a bank statement
// documents a bank's fees and interest:
//
//   - network fees (like bank fees) and storage deposits (refundable),
//   - staking and mining rewards (like interest), staking and unstaking,
//   - swaps, wraps and bridges, and the purchase of a prepaid balance
//     (a transfer into a prepaid asset; the expense is its consumption),
//   - deposits into an escrow, and transfers, own ones included.
//
// The same rule as the Eigenbeleg agent's default since its #119: no kind on
// an Eigenbeleg unless asked for (`includeKinds`), a whole month of
// consumption always. Belege's export takes it from here to decide which
// Eigenbelege it creates at the month's close (Le-Space/belege#1034).

import { CONSUMPTION_CHAINS } from './consumption.js';

/** The kinds of movement an Eigenbeleg is needed for: consumption only. */
export const CONSUMPTION_KINDS = Object.freeze(['usage']);

/** The kinds the account statement documents, without an Eigenbeleg. */
export const STATEMENT_KINDS = Object.freeze([
	'fee',
	'storage',
	'reward',
	'stake',
	'unstake',
	'swap',
	'escrow',
	'transfer',
	'call'
]);

/**
 * Whether a movement needs an Eigenbeleg: consumption from a prepaid balance
 * on a chain that has the monthly consumption Eigenbeleg – usage that left the
 * account and went through. Not a fee, a reward, a swap, a deposit or a
 * transfer: the statement is their receipt.
 *
 * @param {{ chain: string, kind: string, type?: string, success?: boolean }} e
 */
export const needsEigenbeleg = (e) =>
	CONSUMPTION_CHAINS.includes(e.chain) &&
	CONSUMPTION_KINDS.includes(e.kind) &&
	e.type !== 'received' &&
	e.success !== false;

/**
 * Whether a month is over on a day, so that its consumption Eigenbeleg can be
 * made: never for the running month or one to come, whose bookings, rates and
 * usage may still change.
 *
 * @param {string} month YYYY-MM
 * @param {string} today YYYY-MM-DD
 */
export const monthOver = (month, today) =>
	/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month < String(today).slice(0, 7);

/**
 * Whether an account's month gets a consumption Eigenbeleg: the month is over
 * and it holds a movement that needs one.
 *
 * @param {object} p
 * @param {string} p.month YYYY-MM
 * @param {string} p.today YYYY-MM-DD
 * @param {{ chain: string, kind: string, type?: string, success?: boolean }[]} p.entries the account's movements of the month
 */
export const consumptionDue = ({ month, today, entries }) =>
	monthOver(month, today) && entries.some(needsEigenbeleg);
