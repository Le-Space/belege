// The bridge's secrets, in the macOS keychain, one entry per account:
//
//   service `belege-bridge`, account `hibiscus`  the Jameica master password
//                            account `imap`      the mail password or auth token
//                            account `llm`       the LLM provider's API key
//
// The password never goes through argv (where `ps` would show it): reading
// uses `security find-generic-password -w`, which prints it on stdout;
// writing sends `add-generic-password … -w hex:<hex>` to `security -i` on
// stdin. Stored as `hex:` + UTF-8 hex, because `security -i` splits its input
// on whitespace and quotes, and `-w` prints non-ASCII data as hex on the way
// out: this way the round trip is exact. An entry made by hand in Keychain
// Access (plain text) is read as it is.
//
// Everything that touches the keychain goes through an object with `read()`
// and `write()`, so tests hand in a fake (`memoryKeychain`).

import { execFile, spawn } from 'node:child_process';

export const SERVICE = 'belege-bridge';
export const ACCOUNT = 'hibiscus';

/** What each account holds, and which setup command puts it there; for error messages. */
export const ACCOUNTS = /** @type {const} */ ({
	hibiscus: { what: 'Hibiscus password', setup: 'setup:hibiscus' },
	imap: { what: 'mail password', setup: 'setup:mail' },
	llm: { what: 'LLM API key', setup: 'setup:llm' }
});

/** @param {string} account */
function describe(account) {
	return (
		/** @type {Record<string, { what: string, setup: string }>} */ (ACCOUNTS)[account] ?? {
			what: `${account} secret`,
			setup: 'setup'
		}
	);
}

export class KeychainError extends Error {
	/** @param {string} message @param {string} code */
	constructor(message, code) {
		super(message);
		this.name = 'KeychainError';
		this.code = code;
	}
}

/**
 * @typedef {object} Keychain
 * @property {() => Promise<string>} read the password; throws KeychainError when there is none
 * @property {(password: string) => Promise<void>} write
 */

/**
 * @param {{ service?: string, account?: string, platform?: string, securityPath?: string }} [options]
 * @returns {Keychain}
 */
export function macosKeychain({
	service = SERVICE,
	account = ACCOUNT,
	platform = process.platform,
	securityPath = '/usr/bin/security'
} = {}) {
	const { what, setup } = describe(account);
	function assertMac() {
		if (platform !== 'darwin') {
			throw new KeychainError(
				`The bridge keeps the ${what} in the macOS keychain; this is ${platform}. There is no other store yet.`,
				'KEYCHAIN_UNSUPPORTED'
			);
		}
	}

	return {
		async read() {
			assertMac();
			return new Promise((resolve, reject) => {
				execFile(
					securityPath,
					['find-generic-password', '-s', service, '-a', account, '-w'],
					{ encoding: 'utf8', timeout: 30_000 },
					(error, stdout) => {
						if (error) {
							const code = /** @type {any} */ (error).code;
							if (code === 'ENOENT') {
								return reject(
									new KeychainError(
										`${securityPath} not found: no macOS keychain here.`,
										'KEYCHAIN_UNSUPPORTED'
									)
								);
							}
							// 44: errSecItemNotFound
							return reject(
								new KeychainError(
									code === 44
										? `No ${what} in the keychain (service ${service}, account ${account}). Run \`pnpm ${setup}\`.`
										: `The keychain refused to hand out the ${what} (exit ${code}).`,
									code === 44 ? 'KEYCHAIN_MISSING' : 'KEYCHAIN_DENIED'
								)
							);
						}
						const stored = stdout.replace(/\n$/, '');
						const password = /^hex:([0-9a-f]{2})+$/.test(stored)
							? Buffer.from(stored.slice(4), 'hex').toString('utf8')
							: stored;
						if (!password)
							return reject(new KeychainError('The keychain entry is empty.', 'KEYCHAIN_MISSING'));
						resolve(password);
					}
				);
			});
		},

		/** @param {string} password */
		async write(password) {
			assertMac();
			if (!password)
				throw new KeychainError('Refusing to store an empty password.', 'KEYCHAIN_EMPTY');
			const hex = Buffer.from(password, 'utf8').toString('hex');
			await new Promise((resolve, reject) => {
				const child = spawn(securityPath, ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
				let stderr = '';
				child.stderr.on('data', (d) => (stderr += d));
				child.on('error', (e) =>
					reject(
						new KeychainError(`Cannot run ${securityPath}: ${e.message}`, 'KEYCHAIN_UNSUPPORTED')
					)
				);
				child.on('close', (code) => {
					// `security -i` exits 0 even when a command failed; it says so on stderr.
					if (code !== 0 || /error|returned -?\d+/i.test(stderr)) {
						return reject(
							new KeychainError(
								`Storing the password failed: ${stderr.trim() || `exit ${code}`}`,
								'KEYCHAIN_WRITE'
							)
						);
					}
					resolve(undefined);
				});
				child.stdin.end(
					`add-generic-password -U -s ${service} -a ${account} -l belege-bridge-${account} -w hex:${hex}\n`
				);
			});
		}
	};
}

/**
 * For tests and `--test-mode`: a keychain in memory that counts its reads.
 *
 * @param {string | null} [initial]
 * @param {string} [account] only for the error message
 */
export function memoryKeychain(initial = null, account = ACCOUNT) {
	let value = initial;
	const keychain = {
		reads: 0,
		async read() {
			keychain.reads++;
			if (!value)
				throw new KeychainError(
					`No ${describe(account).what} in the (test) keychain.`,
					'KEYCHAIN_MISSING'
				);
			return value;
		},
		/** @param {string} password */
		async write(password) {
			value = password;
		}
	};
	return keychain;
}
