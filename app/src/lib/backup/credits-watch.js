// How long the Aleph account's credits keep the backups: checked after
// unlock and after every backup, for the header – everyone who opens the
// books, members too, sees when the backups are about to go. Aleph keeps a
// backup only while the account can pay for it.

import { app, currentStore, pointedOwner } from '$lib/session.svelte.js';
import { networkPause } from '$lib/network-pause.js';
import { loadBackups } from './history.js';
import { alephEndpoints, creditsOf, creditsPerDay, loadOwner } from './keeper.js';

/** Below this many days the header warns. */
export const WARN_BELOW_DAYS = 30;

/**
 * The days the credits last at what the kept backups cost, or null when it
 * cannot be told (no account, no backup, the network paused, Aleph silent).
 *
 * @param {{ credits: number | null, bytes: number }} p
 */
export const daysLeft = ({ credits, bytes }) =>
	credits === null || bytes <= 0 ? null : credits / creditsPerDay(bytes);

/** Ask Aleph once, and set `app.backupCredits` for the header. */
export async function checkBackupCredits() {
	const store = currentStore();
	if (!store || networkPause()) return;
	const owner = (await loadOwner(store.settings)) ?? pointedOwner();
	if (!owner) return;
	// What Aleph keeps: every backup the history has that was not refused or forgotten.
	const bytes = (await loadBackups(store.settings))
		.filter((b) => b.status !== 'rejected' && b.status !== 'forgotten')
		.reduce((n, b) => n + (Number(b.size) || 0), 0);
	const credits = await creditsOf({ owner, endpoints: alephEndpoints() }).catch(() => null);
	const days = daysLeft({ credits, bytes });
	app.backupCredits = days === null ? null : { days, credits: /** @type {number} */ (credits) };
}
