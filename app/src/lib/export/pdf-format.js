// Small formats the statement PDFs share.

import { amount } from './datev.js';

/** 1234 → "12,34 EUR"; no amount → "—". @param {number | null} cents */
export const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);
