// One account's statement of one month as a file, outside the export: the
// button on Zahlungen. It is the same statement the month's export puts into
// its ZIP (statement.js, statement-pdf.js), with the same number – the plan of
// the whole month is made as the export makes it by default, and the
// account's statement taken from it – so a DATEV line that names the
// statement in Belegfeld 1 names this file too.

import { statementPath } from './build.js';
import { planMonth } from './plan.js';

/** @typedef {Record<string, any>} Rec */

/**
 * The statement of an account and month, or null when the account has no
 * booking in it.
 *
 * @param {object} p
 * @param {string} p.month YYYY-MM
 * @param {string} p.accountId
 * @param {Rec[]} p.transactions
 * @param {Rec[]} p.accounts
 * @param {Rec[]} p.receipts
 * @param {Rec[]} p.matches
 * @param {Record<string, any>} p.classifications
 * @returns {import('./statement.js').Statement | null}
 */
export function accountStatement({ month, accountId, ...books }) {
	if (!/^\d{4}-\d{2}$/.test(month) || !accountId) return null;
	const plan = planMonth({ month, ...books });
	return plan.statements.find((s) => s.account.id === accountId) ?? null;
}

/**
 * The statement drawn: its bytes and the name the export gives the file.
 *
 * @param {import('./statement.js').Statement} statement
 * @param {{ created?: Date }} [o]
 * @returns {Promise<{ bytes: Uint8Array, fileName: string }>}
 */
export async function accountStatementFile(statement, { created = new Date() } = {}) {
	const { statementPdf } = await import('./statement-pdf.js');
	return {
		bytes: await statementPdf(statement, { created }),
		fileName: statementPath(statement).split('/').pop() ?? `${statement.number}.pdf`
	};
}
