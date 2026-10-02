// The backup's copy on Aleph Cloud (issue #77): the app hands over a sealed
// file, the bridge puts it on Aleph's IPFS and asks Aleph to keep it.
//
// Two steps, both through @le-space/orbitdb-storage-bridge. The app does the
// first itself, from the browser (no key needed), and asks the bridge only for
// the second (`pin`); `put` does both here, for a browser that cannot reach
// Aleph:
//   1. `backends/aleph` uploads the bytes to Aleph's IPFS host, without a key
//      (`POST https://ipfs.aleph.cloud/api/v0/add`); the answer is the file's
//      CID. Uploaded is not kept: Aleph drops what nobody pays for.
//   2. `backends/aleph-pin` sends a STORE message naming that CID to the Aleph
//      API (`POST /api/v0/messages`), signed with the bridge's own backup key.
//      Aleph keeps the file for as long as that key's account has credits (or
//      holds ALEPH); no tokens move, the account only has to be able to pay.
//
// The key is the bridge's own, made by `pnpm setup:aleph` and kept in the
// keychain (account `aleph-backup`): a secp256k1 key whose Ethereum address is
// the Aleph account that pays. It is never anyone's wallet, so a leaked bridge
// key costs at most the credits put on it, and the setup prints the address
// to fund, never the key. The signature is `personal_sign` (EIP-191) over
// what aleph-pin hands in, as a browser wallet would sign it.
//
// What leaves: the sealed bytes (the app seals them before they get here –
// the bridge never sees a book in the clear) to Aleph's IPFS host, and the
// signed message with the address and the CID to the Aleph API. The log gets
// sizes, never a CID or the address.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createAlephBackend } from '@le-space/orbitdb-storage-bridge/backends/aleph';
import { createAlephPin } from '@le-space/orbitdb-storage-bridge/backends/aleph-pin';

import { toChecksumAddress } from './chains/evm.js';

export const ALEPH_INGEST = 'https://ipfs.aleph.cloud/api/v0/add';
/** The channel the STORE messages go to: belege's own, so they can be found again. */
export const BACKUP_CHANNEL = 'BELEGE-BACKUP';
/** The largest backup the bridge takes in one piece. */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;

/** @param {string} hex */
const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

/**
 * Whether a string is a secp256k1 private key in hex (64 digits, `0x` optional).
 *
 * @param {unknown} key
 */
export function isBackupKey(key) {
	const k = String(key ?? '').trim();
	if (!/^(0x)?[0-9a-fA-F]{64}$/.test(k)) return false;
	return secp256k1.utils.isValidSecretKey(bytesOf(k));
}

/**
 * A CID as Aleph's IPFS host answers it (CIDv0, `Qm…`) or a CIDv1 in base32.
 *
 * @param {unknown} cid
 */
export const isAlephCid = (cid) =>
	typeof cid === 'string' &&
	(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{50,100}$/.test(cid));

/** A new backup key, as 64 hex digits. */
export const newBackupKey = () => Buffer.from(secp256k1.utils.randomSecretKey()).toString('hex');

/**
 * The Ethereum address of a key: what Aleph calls the account.
 *
 * @param {string} key hex
 */
export function addressOf(key) {
	const pub = secp256k1.getPublicKey(bytesOf(key.trim()), false).slice(1);
	return toChecksumAddress(`0x${Buffer.from(keccak_256(pub).slice(-20)).toString('hex')}`);
}

/**
 * `personal_sign`: EIP-191 over a UTF-8 message, `0x` + r ‖ s ‖ v (27 or 28).
 *
 * @param {string} key hex
 * @param {string} message
 */
export function personalSign(key, message) {
	const body = new TextEncoder().encode(message);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const digest = keccak_256(new Uint8Array([...prefix, ...body]));
	// `recovered` puts the recovery bit first; Ethereum wants it last, plus 27.
	const sig = secp256k1.sign(digest, bytesOf(key.trim()), { prehash: false, format: 'recovered' });
	return `0x${Buffer.from(sig.slice(1)).toString('hex')}${(27 + sig[0]).toString(16)}`;
}

/**
 * @param {object} options
 * @param {() => Promise<string>} options.getKey the backup key, from the keychain
 * @param {string} [options.ingestUrl] Aleph's IPFS host; tests point it at a fake
 * @param {string} [options.apiHost] the Aleph API; tests point it at a fake
 * @param {typeof fetch} [options.fetch]
 */
export function createAlephBackup({ getKey, ingestUrl = ALEPH_INGEST, apiHost, fetch: f = fetch }) {
	/** @returns {Promise<string>} */
	async function key() {
		const k = String(await getKey()).trim();
		if (!isBackupKey(k)) {
			throw Object.assign(new Error('the Aleph backup key is not a key: run `pnpm setup:aleph`'), {
				status: 503,
				code: 'ALEPH_BACKUP_KEY'
			});
		}
		return k;
	}

	/** A STORE message for a CID, signed with the key. @param {string} k @param {string} cid */
	function storeFor(k, cid) {
		return createAlephPin({
			sender: addressOf(k),
			sign: async (_address, message) => personalSign(k, message),
			apiHost,
			channel: BACKUP_CHANNEL,
			fetch: f
		})(cid);
	}

	return {
		/** Where the app uploads a backup itself: Aleph's IPFS host (tests: a fake). */
		ingestUrl,

		/** The account that pays for keeping the backups. */
		async address() {
			return addressOf(await key());
		},

		/**
		 * Ask Aleph to keep what the app has already uploaded to its IPFS host.
		 *
		 * @param {string} cid the id Aleph's IPFS host answered
		 * @returns {Promise<{ cid: string, address: string, itemHash: string, status: string }>}
		 */
		async pin(cid) {
			if (!isAlephCid(cid)) {
				throw Object.assign(new Error('not a CID'), { status: 400, code: 'ALEPH_BACKUP_CID' });
			}
			const k = await key();
			const { itemHash, status } = await storeFor(k, cid);
			return { cid, address: addressOf(k), itemHash, status };
		},

		/**
		 * Upload one sealed backup and ask Aleph to keep it.
		 *
		 * @param {Uint8Array} bytes
		 * @param {{ name: string }} meta
		 * @returns {Promise<{ cid: string, size: number, address: string, itemHash: string, status: string }>}
		 */
		async put(bytes, { name }) {
			const k = await key();
			const sender = addressOf(k);
			let kept = /** @type {{ itemHash: string, status: string } | null} */ (null);
			const backend = createAlephBackend({
				ingestUrl,
				fetch: f,
				pin: async (cid) => {
					kept = await storeFor(k, cid);
					return kept;
				}
			});
			const handle = await backend.putBlob(bytes, {
				name,
				contentType: 'application/octet-stream'
			});
			await backend.pinCid?.(handle.id, { name });
			const { itemHash, status } = /** @type {{ itemHash: string, status: string }} */ (kept);
			return { cid: handle.id, size: bytes.length, address: sender, itemHash, status };
		}
	};
}
