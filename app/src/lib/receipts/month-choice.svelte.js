// The month chosen on Belege (issue #313), kept for the session as Export's
// (#314): leaving the tab and coming back shows the same month. `all` is the
// whole year in one list, on request.

export const belegeChoice = $state({
	/** @type {string | null} YYYY-MM, `ohne` or `all` */
	month: null
});
