// "Bücher umziehen" (#328): the books of one passkey packed into one file
// and taken over by the empty books of another – a dev setup to the public
// app, a replaced passkey, one domain to another. A passkey belongs to its
// domain, and the DID and every key come from it, so there is no other way
// from one to the other.
//
// The file:
//   MAGIC ‖ u32 header length ‖ header (JSON) ‖ sealed payload
// The header is all that is readable: "belege-move", the version, how it is
// sealed, the counts and what was left out – no record, no name, no amount.
// The payload is sealed with AES-256-GCM (db-encryption.js `sealer`) under a
// key that only the target can have:
//   - x25519 (the default): the target shows a one-time public key; the
//     source seals to it with an ephemeral key of its own, ECDH, then HKDF.
//     Only that target opens the file, and its key is gone once it has.
//   - passphrase (for a move where both sides are not open at once): a
//     passphrase Belege generates – never one chosen – stretched with scrypt.
// The payload holds every record of every collection (deleted ones too: a
// deleted receipt still keeps its file from coming back), and the bytes of
// every receipt file and kept mail, decrypted from the old books; it says
// again what the header says, and the header must agree with it.
//
// Left out, as they belong to the old passkey or this device: the device
// list, the bridge pairing, the Aleph backup key, its owner and its history,
// the invoicing app's pairing, the network mode, the LAN relay, the jobs
// waiting for an unlock. The target pairs and sets these up again.
//
// The decrypted books exist only in memory, while packing or unpacking.
// Taking over writes only into empty books, and checks everything first:
// a file that fails a check writes nothing.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

import { recordEvent } from '../activity/events.js';
import { sealer } from '../db-encryption.js';
import { COLLECTIONS } from '../store/repository.js';
import { isUlid } from '../store/ids.js';
import { DEVICE_PREFIX } from '../sync/device-sync.js';

export const MAGIC = new TextEncoder().encode('belegeM1');
export const FORMAT = 1;
const HKDF_INFO = new TextEncoder().encode('belege/move/v1');
/** scrypt for the passphrase: about a second and 128 MiB in a browser. */
export const SCRYPT = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });

/** Settings that belong to the old passkey or device, by key (or key prefix). */
export const LEFT_OUT_SETTINGS = Object.freeze([
	'bridge',
	'backup/owner',
	'backup/aleph-key',
	'backups',
	'ucepInvoiceApp',
	'network-mode',
	'lan-relay',
	'pendingJobs'
]);
/** Collections the target must not have a record in. Settings and events a fresh session writes itself. */
export const MUST_BE_EMPTY = Object.freeze([
	'transactions',
	'receipts',
	'accounts',
	'matches',
	'partners',
	'questions'
]);

export class MoveError extends Error {
	/** @param {string} message @param {'format' | 'key' | 'not-empty' | 'missing-file' | 'check'} code */
	constructor(message, code) {
		super(message);
		this.name = 'MoveError';
		this.code = code;
	}
}

/** @param {Uint8Array} bytes */
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
/** @param {string} text */
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
/** @param {Uint8Array} bytes */
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** @param {string} text */
const unb64url = (text) => unb64(text.replace(/-/g, '+').replace(/_/g, '/'));

/** @param {Record<string, any>} r */
const leftOut = (r) =>
	typeof r.key === 'string' &&
	(LEFT_OUT_SETTINGS.includes(r.key) || r.key.startsWith(DEVICE_PREFIX));

// ── The target's one-time key ────────────────────────────────────────────

/** The prefix of a move key as text: it says what it is. */
const KEY_PREFIX = 'belege-move:';

/**
 * A one-time key pair for taking books over. The secret stays in memory on
 * the target; the public key is shown as a QR code and as text.
 */
export function createMoveKey() {
	const { secretKey, publicKey } = x25519.keygen();
	return { secretKey, publicKey, text: `${KEY_PREFIX}${b64url(publicKey)}` };
}

/**
 * A move key as the source reads it, typed or scanned.
 *
 * @param {string} text
 * @returns {Uint8Array | null} the public key, null when it is none
 */
export function parseMoveKey(text) {
	const s = String(text ?? '').trim();
	if (!s.startsWith(KEY_PREFIX)) return null;
	try {
		const key = unb64url(s.slice(KEY_PREFIX.length));
		return key.length === 32 ? key : null;
	} catch {
		return null;
	}
}

/** Four groups of four: what both sides show, to see they mean the same key. @param {Uint8Array} publicKey */
export function keyFingerprint(publicKey) {
	const hex = Array.from(sha256(publicKey).subarray(0, 8), (b) => b.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();
	return hex.match(/.{4}/g)?.join('-') ?? hex;
}

/**
 * @param {Uint8Array} shared the ECDH secret
 * @param {Uint8Array} ephemeral the source's one-time public key
 * @param {Uint8Array} target the target's public key
 */
const moveKey = (shared, ephemeral, target) =>
	hkdf(sha256, shared, new Uint8Array([...ephemeral, ...target]), HKDF_INFO, 32);

// ── The passphrase ───────────────────────────────────────────────────────

/** Crockford's base32: no I, L, O, U – nothing to misread when typing it in. */
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A passphrase for a move: 20 characters in groups of five, 100 random bits. */
export function generatePassphrase() {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	const chars = Array.from(bytes, (b) => BASE32[b & 31]).join('');
	return chars.match(/.{5}/g)?.join('-') ?? chars;
}

/** As typed: case, spaces and dashes do not matter, O is 0, I and L are 1. @param {string} text */
export function normalizePassphrase(text) {
	return String(text ?? '')
		.toUpperCase()
		.replace(/[\s-]+/g, '')
		.replace(/O/g, '0')
		.replace(/[IL]/g, '1');
}

/** @param {string} passphrase @param {Uint8Array} salt @param {{ N: number, r: number, p: number }} params */
const passphraseKey = (passphrase, salt, params) =>
	scryptAsync(normalizePassphrase(passphrase), salt, { ...params, dkLen: 32 });

// ── Packing ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} MoveHeader
 * @property {'belege-move'} kind
 * @property {number} v
 * @property {string} packedAt ISO 8601
 * @property {string} appVersion
 * @property {Record<string, number>} counts records per collection, and `files`
 * @property {string[]} leftOut the settings left out, by key ("device:…" for the device list)
 * @property {{ kind: 'x25519', ephemeral: string, to: string } | { kind: 'passphrase', kdf: 'scrypt', N: number, r: number, p: number, salt: string }} seal
 */

/**
 * Everything the books hold, decrypted, in memory: the records and the files.
 *
 * @param {Record<string, import('../store/repository.js').Collection>} store
 * @param {{ get: (cid: string) => Promise<Uint8Array> }} blobs
 */
async function collect(store, blobs) {
	/** @type {Record<string, Record<string, any>[]>} */
	const records = {};
	const left = new Set();
	for (const name of COLLECTIONS) {
		const all = await store[name].list({ includeDeleted: true });
		records[name] =
			name === 'settings'
				? all.filter((r) => {
						if (!leftOut(r)) return true;
						left.add(r.key.startsWith(DEVICE_PREFIX) ? `${DEVICE_PREFIX}…` : r.key);
						return false;
					})
				: all;
	}
	const cids = [
		...new Set(
			records.receipts
				.flatMap((r) => [r.fileCid, r.emlCid])
				.filter((c) => typeof c === 'string' && c)
		)
	];
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	for (const cid of cids) {
		try {
			files.set(cid, await blobs.get(cid));
		} catch {
			throw new MoveError(
				'A receipt file is missing on this device; let it sync first, then move.',
				'missing-file'
			);
		}
	}
	return { records, files, leftOut: [...left].sort() };
}

/**
 * The payload: u32 JSON length ‖ JSON ‖ the files one after the other.
 *
 * @param {Record<string, Record<string, any>[]>} records
 * @param {Map<string, Uint8Array>} files
 * @param {Omit<MoveHeader, 'seal'>} header what the payload repeats of the header
 */
function encodePayload(records, files, header) {
	/** @type {{ cid: string, offset: number, length: number }[]} */
	const index = [];
	let offset = 0;
	for (const [cid, bytes] of files) {
		index.push({ cid, offset, length: bytes.length });
		offset += bytes.length;
	}
	const json = new TextEncoder().encode(JSON.stringify({ header, records, files: index }));
	const out = new Uint8Array(4 + json.length + offset);
	new DataView(out.buffer).setUint32(0, json.length);
	out.set(json, 4);
	let at = 4 + json.length;
	for (const bytes of files.values()) {
		out.set(bytes, at);
		at += bytes.length;
	}
	return out;
}

/** @param {Uint8Array} payload */
function decodePayload(payload) {
	if (payload.length < 4) throw new MoveError('The move file is damaged.', 'format');
	const length = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
	if (4 + length > payload.length) throw new MoveError('The move file is damaged.', 'format');
	/** @type {any} */
	let body;
	try {
		body = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + length)));
	} catch {
		throw new MoveError('The move file is damaged.', 'format');
	}
	const base = 4 + length;
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	for (const f of Array.isArray(body?.files) ? body.files : []) {
		const start = base + Number(f.offset);
		const end = start + Number(f.length);
		if (!Number.isSafeInteger(start) || end > payload.length || end < start) {
			throw new MoveError('The move file is damaged.', 'format');
		}
		files.set(String(f.cid), payload.slice(start, end));
	}
	return { header: body?.header, records: body?.records, files };
}

/**
 * @param {MoveHeader} header
 * @param {Uint8Array} sealed
 */
function encodeFile(header, sealed) {
	const json = new TextEncoder().encode(JSON.stringify(header));
	const out = new Uint8Array(MAGIC.length + 4 + json.length + sealed.length);
	out.set(MAGIC, 0);
	new DataView(out.buffer).setUint32(MAGIC.length, json.length);
	out.set(json, MAGIC.length + 4);
	out.set(sealed, MAGIC.length + 4 + json.length);
	return out;
}

/**
 * What a move file says of itself, without opening it.
 *
 * @param {Uint8Array} file
 * @returns {{ header: MoveHeader, sealed: Uint8Array }}
 */
export function readMoveHeader(file) {
	const bytes = file ?? new Uint8Array();
	if (bytes.length < MAGIC.length + 4 || !MAGIC.every((b, i) => bytes[i] === b)) {
		throw new MoveError('This is not a Belege move file.', 'format');
	}
	const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length);
	const start = MAGIC.length + 4;
	if (start + length > bytes.length) throw new MoveError('The move file is damaged.', 'format');
	/** @type {any} */
	let header;
	try {
		header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
	} catch {
		throw new MoveError('The move file is damaged.', 'format');
	}
	if (header?.kind !== 'belege-move' || header?.v !== FORMAT) {
		throw new MoveError('This move file is from another version of Belege.', 'format');
	}
	return { header, sealed: bytes.subarray(start + length) };
}

/**
 * The books packed and sealed for a move.
 *
 * @param {object} params
 * @param {Record<string, import('../store/repository.js').Collection>} params.store
 * @param {{ get: (cid: string) => Promise<Uint8Array> }} params.blobs
 * @param {{ to: Uint8Array } | { passphrase: string }} params.seal the target's public key, or a generated passphrase
 * @param {string} params.appVersion
 * @param {() => Date} [params.now]
 * @param {{ N: number, r: number, p: number }} [params.scrypt] smaller in tests
 * @returns {Promise<{ file: Uint8Array, header: MoveHeader }>}
 */
export async function packBooks({
	store,
	blobs,
	seal,
	appVersion,
	now = () => new Date(),
	scrypt = SCRYPT
}) {
	const { records, files, leftOut: left } = await collect(store, blobs);
	/** @type {Record<string, number>} */
	const counts = Object.fromEntries(COLLECTIONS.map((name) => [name, records[name].length]));
	counts.files = files.size;
	const base = {
		kind: /** @type {const} */ ('belege-move'),
		v: FORMAT,
		packedAt: now().toISOString(),
		appVersion,
		counts,
		leftOut: left
	};
	const payload = encodePayload(records, files, base);

	/** @type {MoveHeader['seal']} */
	let how;
	/** @type {Uint8Array} */
	let key;
	if ('to' in seal) {
		if (!(seal.to instanceof Uint8Array) || seal.to.length !== 32) {
			throw new MoveError('That is not a move key.', 'key');
		}
		const ephemeral = x25519.keygen();
		const shared = x25519.getSharedSecret(ephemeral.secretKey, seal.to);
		key = moveKey(shared, ephemeral.publicKey, seal.to);
		how = { kind: 'x25519', ephemeral: b64(ephemeral.publicKey), to: keyFingerprint(seal.to) };
	} else {
		if (normalizePassphrase(seal.passphrase).length < 20) {
			throw new MoveError('The passphrase is too short.', 'key');
		}
		const salt = crypto.getRandomValues(new Uint8Array(16));
		key = await passphraseKey(seal.passphrase, salt, scrypt);
		how = { kind: 'passphrase', kdf: 'scrypt', ...scrypt, salt: b64(salt) };
	}
	const sealed = await (await sealer(key)).seal(payload);
	/** @type {MoveHeader} */
	const header = { ...base, seal: how };
	return { file: encodeFile(header, sealed), header };
}

// ── Taking over ──────────────────────────────────────────────────────────

/**
 * A move file opened: its records and files, checked against its header.
 *
 * @param {Uint8Array} file
 * @param {{ secretKey: Uint8Array, publicKey: Uint8Array } | { passphrase: string }} key
 */
export async function openMoveFile(file, key) {
	const { header, sealed } = readMoveHeader(file);
	/** @type {Uint8Array} */
	let raw;
	if (header.seal?.kind === 'x25519' && 'secretKey' in key) {
		if (header.seal.to !== keyFingerprint(key.publicKey)) {
			throw new MoveError('This file was sealed for another key.', 'key');
		}
		const ephemeral = unb64(String(header.seal.ephemeral));
		const shared = x25519.getSharedSecret(key.secretKey, ephemeral);
		raw = moveKey(shared, ephemeral, key.publicKey);
	} else if (header.seal?.kind === 'passphrase' && 'passphrase' in key) {
		const { N, r, p } = header.seal;
		if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0) || N > 2 ** 20) {
			throw new MoveError('The move file is damaged.', 'format');
		}
		raw = await passphraseKey(key.passphrase, unb64(header.seal.salt), { N, r, p });
	} else {
		throw new MoveError('This file was sealed another way.', 'key');
	}
	/** @type {Uint8Array} */
	let payload;
	try {
		payload = await (await sealer(raw)).open(sealed);
	} catch {
		throw new MoveError('Wrong key or passphrase, or the file was changed.', 'key');
	}
	const body = decodePayload(payload);
	check(header, body);
	return { header, records: body.records, files: body.files };
}

/**
 * The payload agrees with its header, and every record has the shape it must.
 *
 * @param {MoveHeader} header
 * @param {{ header: any, records: any, files: Map<string, Uint8Array> }} body
 */
function check(header, body) {
	const fail = (/** @type {string} */ what) => {
		throw new MoveError(`The move file does not add up: ${what}.`, 'check');
	};
	if (JSON.stringify(body.header?.counts) !== JSON.stringify(header.counts)) fail('counts');
	if (body.header?.packedAt !== header.packedAt) fail('header');
	for (const name of COLLECTIONS) {
		const list = body.records?.[name];
		if (!Array.isArray(list) || list.length !== header.counts[name]) fail(name);
		const ids = new Set();
		for (const r of list) {
			if (!r || typeof r !== 'object' || !isUlid(String(r.id ?? '')) || ids.has(r.id)) fail(name);
			ids.add(r.id);
			if (name === 'settings' && leftOut(r)) fail('a setting that is left out');
		}
	}
	if (body.files.size !== header.counts.files) fail('files');
	for (const r of body.records.receipts) {
		for (const cid of [r.fileCid, r.emlCid]) {
			if (typeof cid === 'string' && cid && !body.files.has(cid)) fail('a receipt file');
		}
	}
}

/**
 * Whether these books are empty enough to take others over.
 *
 * @param {Record<string, import('../store/repository.js').Collection>} store
 */
export async function isEmptyBooks(store) {
	for (const name of MUST_BE_EMPTY) {
		if ((await store[name].list({ includeDeleted: true })).length) return false;
	}
	return true;
}

/**
 * "Bücher übernehmen": an opened move file into these empty books. Every
 * record keeps its id, its links and its times; receipt files are sealed
 * anew with these books' blob key and get their new CIDs.
 *
 * @param {object} params
 * @param {Record<string, import('../store/repository.js').Collection>} params.store
 * @param {{ put: (bytes: Uint8Array) => Promise<string> }} params.blobs
 * @param {Awaited<ReturnType<typeof openMoveFile>>} params.opened
 * @returns {Promise<{ records: number, files: number }>}
 */
export async function takeOverBooks({ store, blobs, opened }) {
	if (!(await isEmptyBooks(store))) {
		throw new MoveError(
			'These books are not empty: books are taken over only into empty ones.',
			'not-empty'
		);
	}
	/** @type {Map<string, string>} old CID → new */
	const cids = new Map();
	for (const [cid, bytes] of opened.files) cids.set(cid, await blobs.put(bytes));
	/** @type {Map<string, string>} key → id of a setting this session already wrote */
	const existing = new Map((await store.settings.list()).map((r) => [String(r.key), String(r.id)]));
	let records = 0;
	for (const name of COLLECTIONS) {
		for (const r of opened.records[name]) {
			// One record per setting: the moved one counts, the one this fresh session wrote goes.
			const local = name === 'settings' ? existing.get(String(r.key)) : undefined;
			if (local && local !== r.id) await store.settings.softDelete(local);
			const moved =
				name === 'receipts'
					? {
							...r,
							...(r.fileCid ? { fileCid: cids.get(r.fileCid) } : {}),
							...(r.emlCid ? { emlCid: cids.get(r.emlCid) } : {})
						}
					: r;
			await store[name].restore(/** @type {any} */ (moved));
			records++;
		}
	}
	await recordEvent(store.events, 'books-moved', {
		packedAt: opened.header.packedAt,
		records,
		files: cids.size
	});
	return { records, files: cids.size };
}
