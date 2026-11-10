// SPDX-License-Identifier: AGPL-3.0-or-later
//
// provision.mjs <image@sha256:…>: ask Phala Cloud to provision the hosted
// bridge's compose (#696) and print what it answers – the compose hash the
// NEAR contract approves, the app id, and the key the browser encrypts the
// secrets to. Provisioning starts nothing and costs nothing; Phala keeps it
// 14 days.
//
// Phala adds its own pre-launch script to the compose, so the hash can only
// come from Phala, never from compose.yaml alone.
//
// The API key is read from PHALA_API_KEY, or the macOS keychain
// (service "phala"), and never printed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const API = 'https://cloud-api.phala.com/api/v1';
const IMAGE = /^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/;

export const LAUNCHER_URL = 'https://bridge-launcher.le-space.de';
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/;

/**
 * @param {string} image pinned by digest
 * @param {{ launcherUrl?: string }} [o] where the quote goes; another launcher
 *   (a test one) makes another compose, and so another hash to approve
 */
export function composeFor(image, { launcherUrl = LAUNCHER_URL } = {}) {
	if (!IMAGE.test(image)) throw new Error('the image must be pinned: <name>@sha256:<64 hex>');
	if (!HTTPS_ORIGIN.test(launcherUrl)) throw new Error('the launcher must be an https origin');
	const template = readFileSync(fileURLToPath(new URL('./compose.yaml', import.meta.url)), 'utf8');
	return template
		.replace(/\$\{BELEGE_BRIDGE_IMAGE:\?[^}]*\}/, image)
		.replace(`BELEGE_LAUNCHER_URL: ${LAUNCHER_URL}`, `BELEGE_LAUNCHER_URL: ${launcherUrl}`);
}

/** @param {string} image */
export function provisionBody(
	image,
	{ name = 'belege-bridge', instanceType = 'tdx.small', launcherUrl = LAUNCHER_URL } = {}
) {
	return {
		name,
		instance_type: instanceType,
		listed: false,
		env_keys: ['BELEGE_BRIDGE_SECRETS'],
		compose_file: {
			// Not the VM's name: that one is per books, and the compose is
			// measured, so a name in it would make a hash to approve per books.
			name: 'belege-bridge',
			docker_compose_file: composeFor(image, { launcherUrl }),
			allowed_envs: ['BELEGE_BRIDGE_SECRETS'],
			// The log is the operator's to see otherwise; keep it to ourselves.
			public_logs: false,
			public_sysinfo: true,
			public_tcbinfo: true,
			// No inbound route: the bridge dials out to the books' relays.
			gateway_enabled: false,
			kms_enabled: true,
			manifest_version: 2,
			runner: 'docker-compose'
		}
	};
}

function apiKey() {
	if (process.env.PHALA_API_KEY) return process.env.PHALA_API_KEY;
	try {
		return execFileSync('security', ['find-generic-password', '-s', 'phala', '-w'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		return '';
	}
}

/** @param {string} image */
export async function provision(image, o = {}) {
	const key = apiKey();
	if (!key) throw new Error('no Phala API key (PHALA_API_KEY or keychain service "phala")');
	const res = await fetch(`${API}/cvms/provision`, {
		method: 'POST',
		headers: {
			'X-API-Key': key,
			'content-type': 'application/json',
			'user-agent': 'belege-bridge-tee'
		},
		body: JSON.stringify(provisionBody(image, o))
	});
	if (!res.ok) throw new Error(`Phala provision: HTTP ${res.status}`);
	const d = await res.json();
	return { appId: d.app_id, composeHash: d.compose_hash, envPublicKey: d.app_env_encrypt_pubkey };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const image = process.argv[2];
	if (!image) {
		console.error('usage: provision.mjs <image@sha256:…>');
		process.exit(2);
	}
	provision(image).then(
		(r) => console.log(JSON.stringify(r)),
		(e) => {
			console.error(e.message);
			process.exit(1);
		}
	);
}
