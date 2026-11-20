// Members of the books, as the open session handles them (#611, #612, #641):
// a device joining someone's books with a code, the owner admitting and
// removing a member. Moved out of session.svelte.js as it was (#844, step
// B8); the card keeps calling it through session.svelte.js, which loads this
// module when one of its functions is first asked for and hands it the open
// session. members/join.js, members.js and member-vault.js hold the rules.

import { t } from '$lib/i18n/index.js';

/**
 * What this module needs of the open session, read anew at every use: the
 * books may be closed while a call waits.
 *
 * @typedef {object} MembersContext
 * @property {import('$lib/node.js').Session | null} session the open session, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {any} deviceSync device sync, when it runs
 * @property {() => any} ownerVault the owner's vault of the open books
 */

/** @type {MembersContext} */
let ctx;

/** @param {MembersContext} context set by session.svelte.js before any call */
export function bindSession(context) {
	ctx = context;
}

const isoNow = () => new Date().toISOString();

/**
 * A join code being answered (#611): its one-time key, the member's new root
 * and this passkey's PRF answer, in memory only until the answer comes.
 *
 * @type {{ key: { secretKey: Uint8Array, publicKey: Uint8Array }, memberRoot: Uint8Array, prfOutput: Uint8Array, credential: any, label: string } | null}
 */
let joining = null;

/** The pending join, wiped. */
function forgetJoining() {
	if (!joining) return;
	joining.key.secretKey.fill(0);
	joining.memberRoot.fill(0);
	joining.prfOutput.fill(0);
	joining = null;
}

/**
 * "Einer Buchhaltung beitreten" (#611), on the joining device: a join code to
 * send to the owner. The passkey this browser unlocks with answers once; its
 * PRF answer and the member's new root stay in memory until the answer is in.
 *
 * @param {string} label how the member calls themselves
 * @returns {Promise<{ text: string, fingerprint: string }>}
 */
export async function startJoining(label) {
	forgetJoining();
	const [
		{ loadStoredPasskeyCredential, readPrfOutput },
		{ createSecretSigner },
		join,
		vault,
		keys,
		sync
	] = await Promise.all([
		import('../passkey-identity.js'),
		import('@le-space/orbitdb-identity-provider-webauthn-did'),
		import('../members/join.js'),
		import('../members/member-vault.js'),
		import('../database-keys.js'),
		import('../sync/device-sync.js')
	]);
	const credential = loadStoredPasskeyCredential();
	if (!credential) throw new Error(t('members.join.noPasskey'));
	const prfOutput = await readPrfOutput(credential);
	const memberRoot = crypto.getRandomValues(new Uint8Array(32));
	const writer = (await createSecretSigner(memberRoot, { info: vault.MEMBER_IDENTITY_INFO })).did;
	const { generateKeyPairFromSeed } = await import('@libp2p/crypto/keys');
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
	const device = peerIdFromPrivateKey(
		await generateKeyPairFromSeed(
			'Ed25519',
			await keys.deriveDevicePeerSeed(memberRoot, sync.deviceSalt())
		)
	).toString();
	const request = join.createJoinRequest({ writer, device, label: label.trim() });
	joining = {
		key: { secretKey: request.secretKey, publicKey: request.publicKey },
		memberRoot,
		prfOutput,
		credential,
		label: label.trim()
	};
	return { text: request.text, fingerprint: request.fingerprint };
}

/**
 * The owner's answer to this device's join code (#611): the member vault made,
 * under this passkey. From the next unlock this passkey opens those books too.
 *
 * @param {string} answer `belege-member:…`
 * @returns {Promise<{ books: string }>} the books' name
 */
export async function finishJoining(answer) {
	const bundle = await openAnswer(answer);
	if (!joining) throw new Error(t('members.join.noCode'));
	const { createMemberVault } = await import('../members/member-vault.js');
	await createMemberVault({
		bundle,
		passkey: {
			prfOutput: joining.prfOutput,
			rawCredentialId: joining.credential.rawCredentialId,
			credentialId: String(joining.credential.credentialId ?? ''),
			label: joining.label
		},
		storage: globalThis.localStorage,
		memberRoot: Uint8Array.from(joining.memberRoot)
	});
	forgetJoining();
	return { books: bundle.books.label };
}

/** @param {string} answer */
async function openAnswer(answer) {
	if (!joining) throw new Error(t('members.join.noCode'));
	const { openJoinAnswer } = await import('../members/join.js');
	return openJoinAnswer(answer, joining.key).catch((/** @type {any} */ e) => {
		throw new Error(t(`members.error.${e?.code === 'otherCode' ? 'otherCode' : 'answer'}`));
	});
}

/**
 * The owner's answer read, nothing kept yet (#614 audit): which books it
 * opens, and their fingerprint – to compare with the owner's screen before
 * "Beitreten".
 *
 * @param {string} answer `belege-member:…`
 * @returns {Promise<{ books: string, fingerprint: string }>}
 */
export async function readJoinAnswer(answer) {
	const bundle = await openAnswer(answer);
	const { booksFingerprint } = await import('../members/join.js');
	return { books: bundle.books.label, fingerprint: booksFingerprint(bundle.books) };
}

/**
 * A join code read on the owner's device, nothing written yet: its
 * fingerprint and the name it gives – to compare with the bookkeeping's
 * screen before "Aufnehmen".
 *
 * @param {string} code `belege-join:…`
 * @returns {Promise<{ fingerprint: string, label: string }>}
 */
export async function readJoinCode(code) {
	const { parseJoinRequest } = await import('../members/join.js');
	try {
		const request = parseJoinRequest(code);
		return { fingerprint: request.fingerprint, label: request.label };
	} catch {
		throw new Error(t('members.error.code'));
	}
}

/** The join code shown, given up. */
export function cancelJoining() {
	forgetJoining();
}

/**
 * "Mitglied aufnehmen" (#611), on the owner's device: the join code read, the
 * member written into the books, its write identity granted, its device
 * listed – and the answer to send back, sealed to the code's one-time key.
 *
 * @param {{ code: string, label: string, booksLabel: string, role?: 'bookkeeping' | 'reader', bridge?: boolean }} p
 *   `bridge`: a writing member may use the owner's bridge (#641)
 * @returns {Promise<{ answer: string, fingerprint: string, books: string }>} `books`: the books' fingerprint
 */
export async function admitMember({
	code,
	label,
	booksLabel,
	role = 'bookkeeping',
	bridge = true
}) {
	if (!ctx.session) throw new Error(t('messages.sync.off'));
	const [{ parseJoinRequest, sealJoinAnswer }, { addMemberRecord, membersOf }] = await Promise.all([
		import('../members/join.js'),
		import('../members/members.js')
	]);
	/** @type {ReturnType<typeof parseJoinRequest>} */
	let request;
	try {
		request = parseJoinRequest(code);
	} catch {
		throw new Error(t('members.error.code'));
	}
	// A write identity taken out stays refused by every access list: it would
	// show as a member who can write nothing. A new join code brings a new one.
	const before = membersOf(await ctx.session.store.settings.list({ includeDeleted: true }));
	if (before.some((m) => m.writer === request.writer && m.removed)) {
		throw new Error(t('members.error.removedBefore'));
	}
	const name = label.trim() || request.label;
	const bundle = await ctx.session.memberBundle(booksLabel, role, {
		bridge: role !== 'reader' && bridge
	});
	const mayBridge = role !== 'reader' && bridge;
	// Who only reads gets no write access in any access list (#641).
	if (role !== 'reader') await ctx.session.grantWriter(request.writer);
	await addMemberRecord(ctx.session.store.settings, {
		writer: request.writer,
		label: name,
		role,
		devices: [request.device],
		bridge: mayBridge,
		invitedBy: ctx.app.did ?? '',
		at: isoNow()
	});
	if (ctx.deviceSync) await ctx.deviceSync.addDevice(request.device, name).catch(() => {});
	const answer = await sealJoinAnswer({ request, bundle });
	const { booksFingerprint } = await import('../members/join.js');
	return { answer, fingerprint: request.fingerprint, books: booksFingerprint(bundle.books) };
}

/**
 * Take a member out (#614), on the owner's device: what they wrote by now
 * stays, anything after is refused by every device (store/books-access.js);
 * their devices are taken off the list and refused. What they have read stays
 * with them: the keys change only with a move of the books.
 *
 * @param {string} writer the member's write identity
 */
export async function removeMember(writer) {
	if (!ctx.session) throw new Error(t('messages.sync.off'));
	ctx.ownerVault();
	const { membersOf, removeMemberRecord } = await import('../members/members.js');
	const settings = ctx.session.store.settings;
	const member = membersOf(await settings.list({ includeDeleted: true })).find(
		(m) => m.writer === writer && !m.removed
	);
	if (!member) throw new Error(t('members.error.unknown'));
	const theirs = await ctx.session.removeWriter(writer);
	const devices = [...member.devices, ...theirs.devices];
	for (const peerId of devices.filter((d, i) => devices.indexOf(d) === i)) {
		if (ctx.deviceSync) {
			await ctx.deviceSync.removeDevice(peerId).catch(() => {});
		} else {
			for (const r of await settings.list({ where: (x) => x.key === `device:${peerId}` }))
				await settings.softDelete(r.id);
		}
	}
	// What only the owner sets, as the member last set it: put back to unset.
	const { OWNER_SETTINGS } = await import('../members/members.js');
	const reset = theirs.settings.filter((k) => OWNER_SETTINGS.includes(k));
	for (const key of reset) {
		for (const r of await settings.list({ where: (x) => x.key === key }))
			await settings.softDelete(r.id);
	}
	await removeMemberRecord(settings, writer, { at: isoNow(), by: ctx.app.did ?? '' });
	return { reset, changed: theirs.settings.filter((k) => !OWNER_SETTINGS.includes(k)) };
}
