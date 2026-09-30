// The bridge's secrets on Windows (issue #205): the Credential Manager, where
// the macOS keychain is on a Mac. One generic credential per account:
//
//   target `belege-bridge:hibiscus`, `belege-bridge:imap`, `belege-bridge:llm`, …
//
// visible under "Windows-Anmeldeinformationen" (Control Panel → Credential
// Manager → Windows Credentials), protected by Windows for the signed-in user
// (DPAPI), kept on this computer only (no roaming).
//
// Windows has no command that reads a generic credential back, so this calls
// the Credential Manager's own functions (CredReadW, CredWriteW, CredDeleteW in
// advapi32.dll) from Windows PowerShell, which every Windows 10 and 11 has. No
// native Node module, nothing to install.
//
// As on the Mac, the secret never goes through argv, where other processes
// could see it: writing sends it on stdin, reading takes it from stdout, both
// as hex so no console code page can change it. What is on the command line
// is the script itself (`-EncodedCommand`); the operation and the target's
// name travel in the environment.
//
// Same shape as macosKeychain (`read`, `write`, `remove`), same error codes.

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { KeychainError, SERVICE, ACCOUNT, describeAccount } from './keychain.js';

/** ERROR_NOT_FOUND: no such credential. The script exits with 44, as `security` does. */
const NOT_FOUND = 44;
/** A generic credential's secret may be 2560 bytes at most (CRED_MAX_CREDENTIAL_BLOB_SIZE). */
export const MAX_SECRET_BYTES = 2560;

/**
 * The PowerShell that talks to the Credential Manager. Type 1 is
 * CRED_TYPE_GENERIC, persist 2 is CRED_PERSIST_LOCAL_MACHINE (this computer,
 * this user), 1168 is ERROR_NOT_FOUND.
 */
export const CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$op = $env:BELEGE_KEYCHAIN_OP
$target = $env:BELEGE_KEYCHAIN_TARGET
$user = $env:BELEGE_KEYCHAIN_USER
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BelegeCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWrite(ref CREDENTIAL credential, int flags);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr buffer);

  public static int Read(string target, out byte[] blob) {
    blob = new byte[0];
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return Marshal.GetLastWin32Error();
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      blob = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, blob, 0, c.CredentialBlobSize);
      return 0;
    } finally {
      CredFree(p);
    }
  }
  public static int Write(string target, string user, byte[] blob) {
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1;
    c.TargetName = target;
    c.UserName = user;
    c.Persist = 2;
    c.CredentialBlobSize = blob.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
      return CredWrite(ref c, 0) ? 0 : Marshal.GetLastWin32Error();
    } finally {
      Marshal.FreeHGlobal(c.CredentialBlob);
    }
  }
  public static int Delete(string target) {
    return CredDelete(target, 1, 0) ? 0 : Marshal.GetLastWin32Error();
  }
}
"@
function ToHex([byte[]]$bytes) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($b.ToString('x2')) }
  $sb.ToString()
}
function FromHex([string]$hex) {
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
  return ,$bytes
}
if ($op -eq 'read') {
  $blob = New-Object byte[] 0
  $rc = [BelegeCred]::Read($target, [ref]$blob)
  if ($rc -eq 1168) { exit 44 }
  if ($rc -ne 0) { [Console]::Error.WriteLine("CredRead failed with error $rc"); exit 1 }
  [Console]::Out.Write('hex:' + (ToHex $blob))
  exit 0
}
if ($op -eq 'write') {
  $hex = [Console]::In.ReadToEnd().Trim()
  if ($hex -notmatch '^([0-9a-f]{2})+$') { [Console]::Error.WriteLine('Nothing to store'); exit 1 }
  $rc = [BelegeCred]::Write($target, $user, (FromHex $hex))
  if ($rc -ne 0) { [Console]::Error.WriteLine("CredWrite failed with error $rc"); exit 1 }
  exit 0
}
if ($op -eq 'remove') {
  $rc = [BelegeCred]::Delete($target)
  if ($rc -eq 0 -or $rc -eq 1168) { exit 0 }
  [Console]::Error.WriteLine("CredDelete failed with error $rc")
  exit 1
}
[Console]::Error.WriteLine("Unknown operation")
exit 2
`;

/** Windows PowerShell 5.1, which ships with Windows 10 and 11. */
export function defaultPowershellPath(env = process.env) {
	return join(
		env.SystemRoot || env.windir || 'C:\\Windows',
		'System32',
		'WindowsPowerShell',
		'v1.0',
		'powershell.exe'
	);
}

/**
 * @param {{ service?: string, account?: string, platform?: string, powershellPath?: string }} [options]
 * @returns {import('./keychain.js').Keychain}
 */
export function windowsKeychain({
	service = SERVICE,
	account = ACCOUNT,
	platform = process.platform,
	powershellPath = defaultPowershellPath()
} = {}) {
	const { what, setup } = describeAccount(account);
	const target = `${service}:${account}`;
	// `-EncodedCommand` takes the script as base64 of UTF-16LE.
	const encoded = Buffer.from(CREDENTIAL_SCRIPT, 'utf16le').toString('base64');

	/**
	 * @param {'read' | 'write' | 'remove'} op
	 * @param {string} [stdin]
	 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
	 */
	function run(op, stdin = '') {
		if (platform !== 'win32') {
			throw new KeychainError(
				`The Windows Credential Manager is only on Windows; this is ${platform}.`,
				'KEYCHAIN_UNSUPPORTED'
			);
		}
		return new Promise((resolve, reject) => {
			const child = spawn(
				powershellPath,
				['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
				{
					stdio: ['pipe', 'pipe', 'pipe'],
					windowsHide: true,
					env: {
						...process.env,
						BELEGE_KEYCHAIN_OP: op,
						BELEGE_KEYCHAIN_TARGET: target,
						BELEGE_KEYCHAIN_USER: account
					}
				}
			);
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (d) => (stdout += d));
			child.stderr.on('data', (d) => (stderr += d));
			child.on('error', (e) =>
				reject(
					new KeychainError(
						`Cannot run ${powershellPath}: ${e.message}. The bridge needs Windows PowerShell to reach the Credential Manager.`,
						'KEYCHAIN_UNSUPPORTED'
					)
				)
			);
			child.on('close', (code) => resolve({ code, stdout, stderr }));
			child.stdin.on('error', () => {});
			child.stdin.end(stdin);
		});
	}

	/** What PowerShell said, without anything that could be the secret (it is never on stderr). */
	const said = (/** @type {string} */ stderr) =>
		stderr.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';

	return {
		async read() {
			const { code, stdout, stderr } = await run('read');
			if (code === NOT_FOUND) {
				throw new KeychainError(
					`No ${what} in the Windows Credential Manager (${target}). Run \`pnpm ${setup}\`.`,
					'KEYCHAIN_MISSING'
				);
			}
			if (code !== 0) {
				throw new KeychainError(
					`The Credential Manager refused to hand out the ${what} (exit ${code}${said(stderr) ? `: ${said(stderr)}` : ''}).`,
					'KEYCHAIN_DENIED'
				);
			}
			const stored = stdout.trim();
			if (!/^hex:([0-9a-f]{2})+$/.test(stored)) {
				throw new KeychainError('The credential is empty.', 'KEYCHAIN_MISSING');
			}
			return Buffer.from(stored.slice(4), 'hex').toString('utf8');
		},

		/** @param {string} password */
		async write(password) {
			if (!password)
				throw new KeychainError('Refusing to store an empty password.', 'KEYCHAIN_EMPTY');
			const bytes = Buffer.from(password, 'utf8');
			if (bytes.length > MAX_SECRET_BYTES) {
				throw new KeychainError(
					`The ${what} is longer than the Credential Manager keeps (${MAX_SECRET_BYTES} bytes).`,
					'KEYCHAIN_WRITE'
				);
			}
			const { code, stderr } = await run('write', bytes.toString('hex'));
			if (code !== 0) {
				throw new KeychainError(
					`Storing the ${what} failed: ${said(stderr) || `exit ${code}`}`,
					'KEYCHAIN_WRITE'
				);
			}
		},

		async remove() {
			const { code, stderr } = await run('remove');
			if (code !== 0) {
				throw new KeychainError(
					`The Credential Manager refused to delete the ${what} (exit ${code}${said(stderr) ? `: ${said(stderr)}` : ''}).`,
					'KEYCHAIN_DENIED'
				);
			}
		}
	};
}
