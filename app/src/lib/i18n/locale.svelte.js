// The app's language, as state: every `t()` reads it, so a switch re-renders
// what is on screen without a reload (a reload would lock the books).

/** @typedef {'de' | 'en'} Locale */

/** @type {{ current: Locale }} */
export const locale = $state({ current: 'de' });
