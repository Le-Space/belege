// The month chosen on Export (issue #314), kept for the session: leaving the
// tab – to confirm a booking's account on Zahlungen, say – and coming back
// shows the same month. The page also keeps it in its address (`?month=`),
// so a reload, the browser's back and a bookmark keep it too.

export const exportChoice = $state({
	/** @type {string | null} YYYY-MM */
	month: null
});

/** A month as the address may carry it. @param {unknown} value */
export const monthParam = (value) =>
	typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
