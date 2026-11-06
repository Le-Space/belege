// Whose a device or a record is (#614): the books' members by their write
// identity, and the devices each of them wrote into the settings – so the
// device list, the history and the members card can name the member.

import { membersOf } from './members.js';

const DEVICE = 'device:';

/**
 * @param {Record<string, any>[]} settingsRecords with the deleted ones
 * @returns {{ name: (writer: string) => string, deviceOwner: (peerId: string) => string, isMemberDevice: (peerId: string) => boolean, mayUseBridge: (peerId: string) => boolean, devicesOf: (writer: string) => string[] }}
 *   `name`: a member's name by their write identity ('' for anyone else);
 *   `deviceOwner`: the member a device belongs to, by name ('' for the owner's own);
 *   `isMemberDevice`: whether a device is a member's, named or not;
 *   `mayUseBridge`: an own device, or one of a writing member the owner let use the bridge (#641, #579)
 */
export function whose(settingsRecords) {
	const members = membersOf(settingsRecords);
	const byWriter = new Map(members.map((m) => [m.writer, m]));
	/** @type {Map<string, string>} a device → the member's write identity */
	const owners = new Map();
	for (const m of members) for (const d of m.devices) owners.set(d, m.writer);
	// A device a member wrote themselves (their record names them as its author).
	for (const r of settingsRecords) {
		const key = String(r.key ?? '');
		if (key.startsWith(DEVICE) && byWriter.has(String(r.author ?? ''))) {
			owners.set(key.slice(DEVICE.length), String(r.author));
		}
	}
	return {
		name: (writer) => byWriter.get(writer)?.label ?? '',
		deviceOwner: (peerId) => byWriter.get(owners.get(peerId) ?? '')?.label ?? '',
		isMemberDevice: (peerId) => byWriter.has(owners.get(peerId) ?? ''),
		mayUseBridge: (peerId) => {
			const m = byWriter.get(owners.get(peerId) ?? '');
			return !m || (!m.removed && m.bridge !== false);
		},
		devicesOf: (writer) => [...owners].filter(([, w]) => w === writer).map(([peerId]) => peerId)
	};
}
