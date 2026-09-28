// Whether a booking is a private payment from the business account or its
// repayment (issue #172, private.js). Its own module: the engine needs it,
// and private.js needs the engine.

/**
 * @param {Record<string, any> | null | undefined} tx
 * @returns {'private-mistake' | 'private-repayment' | null}
 */
export function privateKind(tx) {
	if (tx?.privateMistake) return 'private-mistake';
	return Array.isArray(tx?.privateRepaymentOf) && tx.privateRepaymentOf.length
		? 'private-repayment'
		: null;
}
