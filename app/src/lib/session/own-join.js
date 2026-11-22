// A new device joins the books with its own passkey, by QR (#962,
// sync/vault-handover.js). On the unlock screen, before there are books here:
//
//   1. A passkey of its own; kept as this browser's only once the vault came,
//      so a broken-off join leaves no passkey that would make new, empty books.
//   2. A node of this step only (a key of the moment, no books, one protocol)
//      answers the invite of the device with the books; the answer shows as a
//      QR code for that device to scan.
//   3. That device asks its person; on "Zulassen" the vault comes, sealed to a
//      one-time key. The passkey gets its slot, the books open with it, and
//      their node – "Ohne Relay, per QR", device sync on – sends its own invite
//      over the same stream and is connected by the answer that comes back.
//
// Nothing here asks a server: no Aleph, no relay, no STUN.

import { t } from '$lib/i18n/index.js';

/**
 * @typedef {object} JoinContext what this module reads from the session, anew at each use
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {() => Promise<void>} unlock opens the books with the passkey kept here
 * @property {() => any} session the open books, or null
 * @property {() => any} deviceSync device sync, once it runs
 * @property {() => Promise<string>} invite the books' node's invite (session/devices.js `qrInvite`)
 * @property {(text: string) => Promise<unknown>} scanned an answer to it (session/devices.js `qrScanned`)
 */

/**
 * Set when a passkey joined by QR: its index on Aleph (index P) can only be
 * published by a device that has its answer, so this one does it, once the
 * books keep their vault on Aleph and the network lets it ask (session.svelte.js).
 */
export const OWN_INDEX_PENDING_KEY = 'belege.vault.own-index-pending';

/** @type {{ node: any, qr: any, key: any, credential: any, prfOutput: Uint8Array, label: string } | null} */
let joining = null;

/** @typedef {typeof import('$lib/session.svelte.js').app} App */

/**
 * @param {App} app
 * @param {Partial<NonNullable<App['sync']['ownJoin']>>} step
 */
function show(app, step) {
	app.sync.ownJoin = {
		phase: 'scan',
		code: '',
		peer: '',
		self: '',
		error: '',
		...(app.sync.ownJoin ?? {}),
		...step
	};
}

/** Stop the node of this step, and forget what was made for it. */
export async function stopOwnJoin() {
	const was = joining;
	joining = null;
	was?.prfOutput.fill(0);
	was?.qr?.close?.();
	await was?.node?.stop().catch(() => {});
}

/**
 * "Mit eigenem Passkey zu bestehenden Büchern": the passkey, and the node
 * that answers the other device's invite.
 *
 * @param {JoinContext} ctx
 * @param {string} label the passkey's name
 */
export async function startOwnJoin(ctx, label) {
	await stopOwnJoin();
	const name = label.trim() || 'Le Space Belege';
	const [
		{ createAdditionalPasskey, readPrfOutput },
		{ confirmPasskeyStep },
		{ createLibp2p },
		{ QRSession },
		{ QR_RTC_CONFIGURATION },
		{ joinLibp2pConfig },
		{ createEphemeralPeerKey },
		{ oneTimeKey }
	] = await Promise.all([
		import('$lib/passkey-identity.js'),
		import('$lib/passkey-steps.svelte.js'),
		import('libp2p'),
		import('@le-space/libp2p-webrtc-qr'),
		import('$lib/sync/qr-link.js'),
		import('$lib/sync/join-node.js'),
		import('$lib/network.js'),
		import('$lib/sync/vault-handover.js')
	]);
	const credential = await createAdditionalPasskey({ displayName: name });
	// A second prompt: from its own click, as Safari wants (#555).
	await confirmPasskeyStep({ n: 2, of: 2, purpose: 'added' });
	const prfOutput = await readPrfOutput(credential);
	/** @type {any} */
	let qr = null;
	// This step's node: it answers one invite and dials nothing of its own.
	const node = await createLibp2p(
		joinLibp2pConfig({
			privateKey: await createEphemeralPeerKey(),
			getOutboundSession: (peer) => qr?.getOutboundSession(peer) ?? null
		})
	);

	qr = new QRSession(node, { rtcConfiguration: QR_RTC_CONFIGURATION, compact: true });
	joining = { node, qr, key: oneTimeKey(), credential, prfOutput, label: name };
	show(ctx.app, { phase: 'scan', self: `…${node.peerId.toString().slice(-6)}` });
}

/**
 * The other device's invite, scanned: answered, and the vault awaited.
 *
 * @param {JoinContext} ctx
 * @param {string} text
 */
export async function ownJoinScanned(ctx, text) {
	const now = joining;
	if (!now) throw new Error(t('onboarding.ownJoin.notStarted'));
	const [{ payloadKind, payloadPeer }, { awaitVault }] = await Promise.all([
		import('$lib/sync/qr-link.js'),
		import('$lib/sync/vault-handover.js')
	]);
	const code = String(text ?? '').trim();
	if ((await payloadKind(code)) !== 'offer') throw new Error(t('onboarding.ownJoin.notInvite'));
	const from = await payloadPeer(code);
	if (!from) throw new Error(t('onboarding.ownJoin.notInvite'));
	const answer = await now.qr.acceptOffer(code);
	show(ctx.app, { phase: 'answer', code: answer, peer: `…${from.slice(-6)}` });
	awaitVault(now.node, {
		key: now.key,
		from,
		onVault: (vault) => openWithVault(ctx, vault),
		onAnswer: async (reply) => {
			show(ctx.app, { phase: 'connecting' });
			await connectBooksNode(ctx, reply);
		}
	})
		.then(() => show(ctx.app, { phase: 'done', code: '' }))
		.catch((error) => {
			const refused = error?.code === 'refused';
			show(ctx.app, {
				phase: 'error',
				code: '',
				error: refused
					? t('onboarding.ownJoin.refused')
					: error instanceof Error
						? error.message
						: String(error)
			});
		})
		.finally(() => stopOwnJoin());
}

/**
 * The vault came: this passkey's slot, the passkey kept, the books opened in
 * the own network, and the books' node's invite returned for the other device.
 *
 * @param {JoinContext} ctx
 * @param {{ record: any, vaultKey: Uint8Array }} vault
 * @returns {Promise<string>}
 */
async function openWithVault(ctx, vault) {
	const now = joining;
	if (!now) throw new Error(t('onboarding.ownJoin.notStarted'));
	show(ctx.app, { phase: 'opening', code: '' });
	const [
		{ joinWithVault },
		{ keepPasskeyCredential },
		{ setNetworkModeMirror },
		{ setDeviceSync }
	] = await Promise.all([
		import('$lib/books-vault.js'),
		import('$lib/passkey-identity.js'),
		import('$lib/sync/network-mode.js'),
		import('$lib/sync/device-sync.js')
	]);
	await joinWithVault(
		vault,
		{
			prfOutput: now.prfOutput,
			rawCredentialId: now.credential.rawCredentialId,
			credentialId: String(now.credential.credentialId ?? ''),
			label: now.label
		},
		globalThis.localStorage
	);
	vault.vaultKey.fill(0);
	now.prfOutput.fill(0);
	keepPasskeyCredential(now.credential);
	globalThis.localStorage.setItem(OWN_INDEX_PENDING_KEY, '1');
	// Met in the own network, by QR, and syncing from the first unlock on.
	setNetworkModeMirror('qr');
	setDeviceSync(true);
	await ctx.unlock();
	if (!ctx.session()) throw new Error(ctx.app.error || t('onboarding.ownJoin.notOpened'));
	return ctx.invite();
}

/**
 * The other device's answer to the books' node's invite: connected, once
 * device sync runs here.
 *
 * @param {JoinContext} ctx
 * @param {string} answer
 */
async function connectBooksNode(ctx, answer) {
	const until = Date.now() + 60_000;
	while (!ctx.deviceSync()) {
		if (Date.now() > until) throw new Error(t('messages.sync.off'));
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await ctx.scanned(answer);
}
