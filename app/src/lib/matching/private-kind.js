// Whether a booking is a private payment from the business account or its
// repayment (issue #172, private.js), or pays a person's outlays back (#293,
// outlays/repayment.js). Its own module: the engine needs it, and private.js
// needs the engine.

/**
 * @param {Record<string, any> | null | undefined} tx
 * @returns {'private-mistake' | 'private-repayment' | 'outlay-repayment' | null}
 */
export function privateKind(tx) {
	if (tx?.privateMistake) return 'private-mistake';
	if (Array.isArray(tx?.outlayRepaymentOf) && tx.outlayRepaymentOf.length)
		return 'outlay-repayment';
	return Array.isArray(tx?.privateRepaymentOf) && tx.privateRepaymentOf.length
		? 'private-repayment'
		: null;
}
