// When the app offers to keep the books' vault on Aleph (#406, #1049): sealed,
// under an address from each passkey (index P) and one from the books' root
// (index M, with the paying account), so that an empty device finds the books
// and their backups with a passkey alone (backup/vault-index.js).
//
// One passkey is enough for that: its index P leads to the vault, and the
// vault to the account. So the offer no longer waits for a second passkey or
// recovery words. It is asked once at the first backup, and stays under
// Einstellungen → Schlüssel for as long as the vault is not kept there.

/**
 * @typedef {object} VaultOfferState
 * @property {boolean} owner the books' owner has the vault open (a member has none, #612)
 * @property {boolean} indexOn the vault is kept on Aleph already
 * @property {boolean} paused the network is paused: Aleph is not asked
 * @property {boolean} [answered] the question at the backup was answered already, yes or no
 */

/**
 * Whether Einstellungen → Schlüssel offers "Jetzt hinterlegen": for the owner,
 * while the vault is not on Aleph and the network may be used – with one
 * passkey as with several.
 *
 * @param {VaultOfferState} state
 */
export const keysOffersVaultIndex = ({ owner, indexOn, paused }) => owner && !indexOn && !paused;

/**
 * Whether the backup card asks, once, to keep the vault on Aleph: as the keys
 * page would, after a backup was made (it names the account the backups are
 * kept for), and only until the person answered.
 *
 * @param {VaultOfferState & { backedUp: boolean }} state
 */
export const backupAsksVaultIndex = (state) =>
	keysOffersVaultIndex(state) && state.backedUp && !state.answered;
