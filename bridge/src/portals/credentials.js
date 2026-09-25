// "Zugangsdaten speichern" from the app: the user name comes from the app,
// the password never does. The bridge asks for it in a native macOS dialog
// (osascript `display dialog … with hidden answer`) on its own Mac and puts
// it straight into the keychain (service belege-bridge, account portal:<id>),
// as `pnpm setup:portal` does. The password is not logged, not returned and
// not stored anywhere else.
//
// The portal's name and host reach the AppleScript as `argv` (`on run argv`),
// never interpolated into the script, so a name cannot change what runs.
// The dialog is a function the manager is handed (`askPassword`), so tests
// hand in a fake and no dialog ever opens there.

import { execFile } from 'node:child_process';

import { PortalError } from './errors.js';

/** How long the dialog waits for the user before it gives up by itself. */
export const DIALOG_SECONDS = 300;

/**
 * The AppleScript, one line per `-e`. argv: 1 the portal's name, 2 its host.
 * Prints `ok:<password>` or `cancel`.
 */
export const PASSWORD_DIALOG_SCRIPT = [
	'on run argv',
	'set portalName to item 1 of argv',
	'set portalHost to item 2 of argv',
	'set prompt to "Passwort für " & portalName & " (" & portalHost & ")" & return & return & "Le Space Belege legt es im macOS-Schlüsselbund ab und tippt es nur in das Anmeldeformular dieses Portals."',
	'try',
	`set answer to display dialog prompt with title "Le Space Belege" default answer "" with hidden answer buttons {"Abbrechen", "Im Schlüsselbund speichern"} default button 2 cancel button 1 with icon note giving up after ${DIALOG_SECONDS}`,
	'on error number -128',
	'return "cancel"',
	'end try',
	'if gave up of answer then return "cancel"',
	'return "ok:" & (text returned of answer)',
	'end run'
];

/**
 * @typedef {(portal: { id: string, name: string, host: string }) => Promise<string | null>} AskPassword
 *   the password the user typed ('' when none), null when the dialog was cancelled
 */

/**
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.osascriptPath]
 * @param {typeof execFile} [options.run] for tests of the argv; the default runs osascript
 * @returns {AskPassword}
 */
export function macosPasswordDialog({
	platform = process.platform,
	osascriptPath = '/usr/bin/osascript',
	run = execFile
} = {}) {
	return async ({ id, name, host }) => {
		if (platform !== 'darwin') throw credentialsUnsupported(id, platform);
		const args = [...PASSWORD_DIALOG_SCRIPT.flatMap((line) => ['-e', line]), '--', name, host];
		const stdout = await new Promise((resolve, reject) => {
			run(
				osascriptPath,
				args,
				{ encoding: 'utf8', timeout: (DIALOG_SECONDS + 30) * 1000, maxBuffer: 64 * 1024 },
				(error, out) => {
					if (error) {
						// The message may name the script; never the answer, which is on stdout only.
						return reject(
							/** @type {any} */ (error).code === 'ENOENT'
								? credentialsUnsupported(id, platform)
								: new PortalError(
										'The password dialog could not be shown.',
										'PORTAL_CREDENTIALS_DIALOG',
										500
									)
						);
					}
					resolve(String(out));
				}
			);
		});
		const answer = stdout.replace(/\r?\n$/, '');
		if (answer === 'cancel') return null;
		if (!answer.startsWith('ok:')) {
			throw new PortalError(
				'The password dialog answered something unexpected.',
				'PORTAL_CREDENTIALS_DIALOG',
				500
			);
		}
		return answer.slice(3);
	};
}

/** @param {string} id @param {string} platform */
export const credentialsUnsupported = (id, platform) =>
	new PortalError(
		`The password dialog needs macOS (this is ${platform}): run \`pnpm setup:portal ${id}\` on the bridge's machine.`,
		'PORTAL_CREDENTIALS_UNSUPPORTED',
		501
	);

/** @param {string} id */
export const credentialsCancelled = (id) =>
	new PortalError(
		`No password was entered for ${id}; nothing is stored.`,
		'PORTAL_CREDENTIALS_CANCELLED',
		409
	);

/**
 * A user name as bridge.json keeps it: one line, 1–200 characters.
 *
 * @param {unknown} v
 */
export function validUsername(v) {
	return typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\r\n\0]/.test(v);
}
