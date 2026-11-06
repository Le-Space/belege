// Links into a block explorer, from its URL templates.

/**
 * @typedef {object} Explorer
 * @property {string} name
 * @property {string} tx URL with `{tx}`
 * @property {string} address URL with `{address}`
 */

/** @param {Explorer} explorer @param {string} tx */
export const txUrl = (explorer, tx) => explorer.tx.replace('{tx}', encodeURIComponent(tx));
/** @param {Explorer} explorer @param {string} address */
export const addressUrl = (explorer, address) =>
	explorer.address.replace('{address}', encodeURIComponent(address));
