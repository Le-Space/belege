// A device with its own passkey joins the books by QR (#962): the device with
// the books open hands it the vault, over the connection the code exchange
// made, once the person there allowed it – and then over the same stream the
// two set up the connection of the new device's own node, so nobody scans a
// second time.
//
//   1. The new device (B) has made its passkey, has no books, and so no
//      books' node: the node's peer key comes from the books' root. A node of
//      this step only, with a key of the moment, answers the invite of the
//      device with the books (A). It serves this one protocol and nothing else.
//   2. A opens the stream – A gets no handler of its own for it, and its
//      device gate is unchanged. B says what it wants: the vault, sealed to a
//      one-time x25519 key that lives in B's memory only.
//   3. A asks its person ("Zulassen?"), with the short peer ids on both
//      screens. Only then does A send the vault record and the vault key,
//      sealed to that key (ECDH, HKDF, AES-GCM, as members/join.js).
//   4. B gives its passkey a slot, opens the books with it, and its books'
//      node comes up. B sends that node's signed invite over the stream; A
//      answers it there, and the two nodes connect. The device proof runs on
//      that connection as on any other.
//
// What A never sees: B's PRF answer, or the key of B's slot. What crosses in
// the clear: B's one-time public key and the two nodes' signed invite and
// answer, which carry only addresses in the local network.
//
// The one exception to "nothing before the device proof" (AGENTS.md): B's
// node of the first step serves this protocol to the device whose invite it
// answered – once, for ten minutes at most, before it has any books.

import { lpStream } from '@libp2p/utils';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { sealer } from '../db-encryption.js';

export const HANDOVER_PROTOCOL = '/belege/vault-handover/1.0.0';

/** How long the new device waits for the vault, and the other for "Zulassen". */
export const HANDOVER_WAIT_MS = 10 * 60_000;
/** How long the device with the books waits for the new device's own invite: its unlock. */
export const OFFER_WAIT_MS = 5 * 60_000;
/** Whether the other end speaks the protocol at all: an own device's node does not. */
const PROBE_MS = 10_000;
const MAX_MESSAGE = 256 * 1024;
const VERSION = 1;
const INFO = new TextEncoder().encode('belege/vault-handover/v1');

/** Refused by the other side, or something that does not belong to this protocol. */
export class HandoverError extends Error {
	/** @param {string} message @param {'refused' | 'protocol' | 'sealed'} code */
	constructor(message, code) {
		super(message);
		this.name = 'HandoverError';
		this.code = code;
	}
}

/** @param {Uint8Array} bytes */
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
/** @param {unknown} text */
function unb64(text) {
	const s = atob(String(text ?? ''));
	return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} shared @param {Uint8Array} ephemeral @param {Uint8Array} target */
const handoverKey = (shared, ephemeral, target) =>
	hkdf(sha256, shared, new Uint8Array([...ephemeral, ...target]), INFO, 32);

/** A one-time key of the new device: in memory only, dropped once the vault is open. */
export const oneTimeKey = () => x25519.keygen();

/**
 * The vault, sealed to the new device's one-time key.
 *
 * @param {{ record: any, vaultKey: Uint8Array }} vault the record as the books keep it, and its key
 * @param {Uint8Array} publicKey the new device's one-time key
 * @returns {Promise<{ ephemeral: string, sealed: string }>}
 */
export async function sealHandover({ record, vaultKey }, publicKey) {
	const ephemeral = x25519.keygen();
	const shared = x25519.getSharedSecret(ephemeral.secretKey, publicKey);
	const key = handoverKey(shared, ephemeral.publicKey, publicKey);
	const plain = new TextEncoder().encode(JSON.stringify({ record, vaultKey: b64(vaultKey) }));
	const sealed = await (await sealer(key)).seal(plain);
	ephemeral.secretKey.fill(0);
	return { ephemeral: b64(ephemeral.publicKey), sealed: b64(sealed) };
}

/**
 * The vault, opened with the one-time key.
 *
 * @param {{ ephemeral?: unknown, sealed?: unknown }} message
 * @param {{ secretKey: Uint8Array, publicKey: Uint8Array }} key
 * @returns {Promise<{ record: any, vaultKey: Uint8Array }>}
 */
export async function openHandover(message, key) {
	let value;
	try {
		const ephemeral = unb64(message.ephemeral);
		const shared = x25519.getSharedSecret(key.secretKey, ephemeral);
		const bytes = await (
			await sealer(handoverKey(shared, ephemeral, key.publicKey))
		).open(unb64(message.sealed));
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new HandoverError('The vault does not open here, or it was changed.', 'sealed');
	}
	const vaultKey = unb64(value?.vaultKey);
	if (!value?.record?.vault || vaultKey.length !== 32) {
		throw new HandoverError('That is no vault.', 'sealed');
	}
	return { record: value.record, vaultKey };
}

/** @param {any} stream */
const framed = (stream) => lpStream(stream, { maxDataLength: MAX_MESSAGE });

/** @param {any} lp @param {Record<string, unknown>} message @param {AbortSignal} signal */
const send = (lp, message, signal) =>
	lp.write(new TextEncoder().encode(JSON.stringify({ v: VERSION, ...message })), { signal });

/** @param {any} lp @param {AbortSignal} signal @param {string} type */
async function receive(lp, signal, type) {
	const message = JSON.parse(new TextDecoder().decode((await lp.read({ signal })).subarray()));
	if (message?.v !== VERSION) throw new HandoverError('Another version.', 'protocol');
	if (message.type === 'no') throw new HandoverError('Not allowed on the other device.', 'refused');
	if (message.type !== type) throw new HandoverError(`Expected ${type}.`, 'protocol');
	return message;
}

/**
 * The device with the books, after its invite was answered: whether the
 * other end is a new device that wants the vault – and if so, the whole
 * exchange. Null when it is not (an own device's node, which goes on to the
 * device proof as before).
 *
 * @param {any} connection the connection the code exchange made
 * @param {object} p
 * @param {(peer: string) => Promise<boolean>} p.allow the person's answer
 * @param {() => { record: any, vaultKey: Uint8Array }} p.vault the record as the books keep it, and its key
 * @param {(offer: string) => Promise<string>} p.answerOffer the new device's own invite, answered
 * @returns {Promise<{ peer: string } | null>} the peer that got the vault
 * @throws {HandoverError} the exchange broke off after the other end asked
 */
export async function giveVault(connection, { allow, vault, answerOffer }) {
	const peer = connection.remotePeer.toString();
	let stream;
	try {
		stream = await connection.newStream(HANDOVER_PROTOCOL, {
			signal: AbortSignal.timeout(PROBE_MS)
		});
	} catch {
		return null;
	}
	const lp = framed(stream);
	try {
		const want = await receive(lp, AbortSignal.timeout(PROBE_MS), 'want');
		const publicKey = unb64(want.publicKey);
		if (publicKey.length !== 32) throw new HandoverError('No key.', 'protocol');
		if (!(await allow(peer))) {
			await send(lp, { type: 'no' }, AbortSignal.timeout(PROBE_MS)).catch(() => {});
			await stream.close().catch(() => {});
			throw new HandoverError('Not allowed here.', 'refused');
		}
		const sealed = await sealHandover(vault(), publicKey);
		await send(lp, { type: 'vault', ...sealed }, AbortSignal.timeout(PROBE_MS));
		const offer = await receive(lp, AbortSignal.timeout(OFFER_WAIT_MS), 'offer');
		const answer = await answerOffer(String(offer.code ?? ''));
		await send(lp, { type: 'answer', code: answer }, AbortSignal.timeout(PROBE_MS));
		await stream.close().catch(() => {});
		return { peer };
	} catch (error) {
		stream.abort?.(error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}

/**
 * The new device: wait, once, for the vault from the device whose invite it
 * answered.
 *
 * @param {any} node the node of this step
 * @param {object} p
 * @param {{ secretKey: Uint8Array, publicKey: Uint8Array }} p.key the one-time key
 * @param {string} p.from the peer id of the device whose invite was answered
 * @param {(vault: { record: any, vaultKey: Uint8Array }) => Promise<string>} p.onVault
 *   keeps the vault, opens the books, and returns the books' node's invite
 * @param {(answer: string) => Promise<void>} p.onAnswer connects the books' node
 * @returns {Promise<void>} settles when the exchange is over
 */
export function awaitVault(node, { key, from, onVault, onAnswer }) {
	return new Promise((resolve, reject) => {
		let taken = false;
		const timer = setTimeout(() => {
			done(new HandoverError('No vault came.', 'protocol'));
		}, HANDOVER_WAIT_MS);
		/** @param {unknown} [error] */
		const done = (error) => {
			clearTimeout(timer);
			key.secretKey.fill(0);
			node.unhandle(HANDOVER_PROTOCOL).catch(() => {});
			if (error) reject(error);
			else resolve();
		};
		node
			.handle(
				HANDOVER_PROTOCOL,
				async (/** @type {any} */ stream, /** @type {any} */ connection) => {
					// Once, and only for the device whose invite this one answered.
					if (taken || connection.remotePeer.toString() !== from) {
						stream.abort(new Error('not asked'));
						return;
					}
					taken = true;
					const lp = framed(stream);
					try {
						await send(
							lp,
							{ type: 'want', publicKey: b64(key.publicKey) },
							AbortSignal.timeout(PROBE_MS)
						);
						const message = await receive(lp, AbortSignal.timeout(HANDOVER_WAIT_MS), 'vault');
						const vault = await openHandover(message, key);
						key.secretKey.fill(0);
						const offer = await onVault(vault);
						await send(lp, { type: 'offer', code: offer }, AbortSignal.timeout(PROBE_MS));
						const answer = await receive(lp, AbortSignal.timeout(OFFER_WAIT_MS), 'answer');
						await onAnswer(String(answer.code ?? ''));
						await stream.close().catch(() => {});
						done();
					} catch (error) {
						stream.abort(error instanceof Error ? error : new Error(String(error)));
						done(error);
					}
				},
				{ maxInboundStreams: 1, runOnLimitedConnection: false }
			)
			.catch(done);
	});
}
