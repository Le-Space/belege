// A cell a spreadsheet would take for a formula (=, +, -, @, a tab or CR at the
// start) gets a leading apostrophe, so it stays text: counterparties, purposes
// and vendors come from bank lines, statements and mails.

/** A plain number (-39,99, 1.234,56) stays as it is: it is no formula. */
const NUMBER = /^[-+]?\d[\d.,]*$/;

/** @param {string} text */
export const inert = (text) =>
	/^[=+\-@\t\r]/.test(text) && !NUMBER.test(text) ? `'${text}` : text;
