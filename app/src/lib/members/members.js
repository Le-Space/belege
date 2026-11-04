// The books' members (#611, #614): one record each in the sealed settings,
// `member:<write identity>`, written by the owner. It replicates like every
// setting, so each device of the books knows who the members are.

const PREFIX = 'member:';
const DID = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/;
export const ROLES = /** @type {const} */ (['bookkeeping']);

/**
 * @typedef {object} Member
 * @property {string} writer the member's write identity
 * @property {string} label
 * @property {typeof ROLES[number]} role
 * @property {string[]} devices their devices' peer ids
 * @property {string} invitedBy the owner's passkey DID
 * @property {string} at when they joined
 * @property {boolean} removed
 * @property {string} [removedAt] when they were taken out (#614)
 */

/**
 * @param {import('../store/repository.js').Collection} settings
 * @param {Omit<Member, 'removed'>} member
 */
export async function addMemberRecord(settings, member) {
	if (!DID.test(member.writer)) throw new Error('A member is named by a did:key.');
	if (!ROLES.includes(member.role)) throw new Error(`Unknown role: ${member.role}`);
	const key = `${PREFIX}${member.writer}`;
	const [kept] = await settings.list({ where: (r) => r.key === key });
	await settings.put({
		...(kept ? { id: kept.id } : {}),
		key,
		value: {
			label: String(member.label).slice(0, 60),
			role: member.role,
			devices: member.devices.slice(0, 16),
			invitedBy: member.invitedBy,
			at: member.at
		},
		deleted: false
	});
}

/**
 * Settings only the owner sets (#614 audit): where the backups are kept and
 * signed, the bridge, how devices meet, the vault on Aleph, the books'
 * successor, the invoicing app. A member's value for one of them is put back
 * when the member is taken out, and not carried over to new keys.
 */
export const OWNER_SETTINGS = Object.freeze([
	'backup/owner',
	'backup/aleph-key',
	'bridge',
	'network-mode',
	'lan-relay',
	'vault/index',
	'books/successor',
	'ucepInvoiceApp'
]);

/**
 * A member taken out (#614): the record stays, marked deleted, with when.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {string} writer
 * @param {{ at: string, by: string }} when
 */
export async function removeMemberRecord(settings, writer, { at, by }) {
	const key = `${PREFIX}${writer}`;
	const [kept] = await settings.list({ where: (r) => r.key === key });
	if (!kept) throw new Error('No such member.');
	await settings.put({
		id: kept.id,
		key,
		value: { ...kept.value, removedAt: at, removedBy: by },
		deleted: true
	});
}

/**
 * Every member the books know, removed ones marked.
 *
 * @param {Record<string, any>[]} settingsRecords with the deleted ones
 * @returns {Member[]}
 */
export function membersOf(settingsRecords) {
	return settingsRecords
		.filter((r) => String(r.key ?? '').startsWith(PREFIX))
		.map((r) => ({
			writer: String(r.key).slice(PREFIX.length),
			label: String(r.value?.label ?? ''),
			role: /** @type {Member['role']} */ (r.value?.role ?? 'bookkeeping'),
			devices: Array.isArray(r.value?.devices) ? r.value.devices.map(String) : [],
			invitedBy: String(r.value?.invitedBy ?? ''),
			at: String(r.value?.at ?? ''),
			removed: Boolean(r.deleted),
			...(r.value?.removedAt ? { removedAt: String(r.value.removedAt) } : {})
		}))
		.filter((m) => DID.test(m.writer));
}
