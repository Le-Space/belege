// A secret too large for the system's store, kept in a sealed file instead.
//
// The Windows Credential Manager takes at most 2560 bytes per entry, and an
// RSA private key of 4096 bits in PEM is about 3300; Enable Banking's sessions
// add to that. So the value is sealed with AES-256-GCM into a file (mode 0600,
// beside the configuration), and only the 32-byte key that opens it goes into
// the keychain or the Credential Manager. The file alone is useless; so is the
// keychain entry alone.
//
// The file is JSON `{ v: 1, iv, data }` (base64); the authentication tag is
// part of `data`, and the label is bound in as associated data, so a sealed
// file of one purpose cannot be passed off as another's.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class SealedFileError extends Error {
	/** @param {string} message @param {'SEALED_MISSING' | 'SEALED_BROKEN'} code */
	constructor(message, code) {
		super(message);
		this.name = 'SealedFileError';
		this.code = code;
	}
}

/**
 * @param {object} options
 * @param {string} options.path the sealed file
 * @param {import('./keychain.js').Keychain} options.keychain holds the file's key, as hex
 * @param {string} options.label bound to the content (associated data), e.g. `enablebanking`
 * @param {string} [options.setup] the command that writes it, for messages
 */
export function sealedFile({ path, keychain, label, setup = 'setup' }) {
	const aad = Buffer.from(`belege-bridge:${label}:v1`);

	/** @returns {Promise<Buffer>} */
	async function fileKey() {
		const hex = await keychain.read();
		if (!/^[0-9a-f]{64}$/.test(hex)) {
			throw new SealedFileError(
				`The key to the sealed ${label} file is unusable; run \`pnpm ${setup}\` again.`,
				'SEALED_BROKEN'
			);
		}
		return Buffer.from(hex, 'hex');
	}

	return {
		/** @returns {Promise<any>} the value as written */
		async read() {
			let text;
			try {
				text = await readFile(path, 'utf8');
			} catch (/** @type {any} */ error) {
				if (error.code === 'ENOENT') {
					throw new SealedFileError(
						`Nothing set up for ${label} yet; run \`pnpm ${setup}\`.`,
						'SEALED_MISSING'
					);
				}
				throw error;
			}
			const key = await fileKey();
			try {
				const { v, iv, data } = JSON.parse(text);
				if (v !== 1) throw new Error('version');
				const raw = Buffer.from(data, 'base64');
				const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
				decipher.setAAD(aad);
				decipher.setAuthTag(raw.subarray(raw.length - 16));
				const plain = Buffer.concat([
					decipher.update(raw.subarray(0, raw.length - 16)),
					decipher.final()
				]);
				return JSON.parse(plain.toString('utf8'));
			} catch {
				throw new SealedFileError(
					`The sealed ${label} file does not open with its key; run \`pnpm ${setup}\` again.`,
					'SEALED_BROKEN'
				);
			}
		},

		/**
		 * Seal `value` with the existing key, or a new one on the first write.
		 * Written to a temporary file and renamed, so a crash leaves the old file.
		 *
		 * @param {unknown} value JSON
		 */
		async write(value) {
			let key;
			try {
				key = await fileKey();
			} catch {
				key = randomBytes(32);
				await keychain.write(key.toString('hex'));
			}
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			cipher.setAAD(aad);
			const sealed = Buffer.concat([
				cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
				cipher.final(),
				cipher.getAuthTag()
			]);
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			const tmp = `${path}.${process.pid}.tmp`;
			const body = JSON.stringify({
				v: 1,
				iv: iv.toString('base64'),
				data: sealed.toString('base64')
			});
			await writeFile(tmp, `${body}\n`, { mode: 0o600 });
			await chmod(tmp, 0o600);
			await rename(tmp, path);
		},

		/** The file and its key; nothing there is fine. */
		async remove() {
			await rm(path, { force: true });
			await keychain.remove?.();
		}
	};
}
