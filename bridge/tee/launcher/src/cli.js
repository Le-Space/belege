#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The launcher, as it runs at Le Space. Configuration from the environment:
//
//   LAUNCHER_PORT              default 8790
//   LAUNCHER_HOST              default 127.0.0.1 (the reverse proxy is in front); in a container
//                              0.0.0.0, with the port published to the proxy's network only
//   LAUNCHER_ORIGINS           browser origins, comma-separated (default the hosted app and localhost:5173)
//   NEAR_RPC_URL               default https://rpc.testnet.fastnear.com
//   BRIDGE_CONTRACT_ID         the contract (bridge/tee/near-contract)
//   LAUNCHER_ACCOUNT_ID        the launcher's NEAR account (named a launcher in the contract)
//   LAUNCHER_NEAR_KEY_FILE     its key, a near-cli credentials file (default ~/.near-credentials/<network>/<id>.json)
//   PHALA_API_KEY              or the macOS keychain, service "phala"
//   BRIDGE_IMAGE               the released bridge image, pinned: ghcr.io/…@sha256:…
//   LAUNCHER_PUBLIC_URL        where the VM sends its quote (default https://bridge-launcher.le-space.de);
//                              part of the compose, so another URL is another hash to approve
//   LAUNCHER_QUOTE_DIR         a test run: keep each quote the VMs hand in (public data), to
//                              read the measurements the contract is to approve from it
//
// Secrets are read, never printed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createLauncher } from './launcher.js';
import { nearClient } from './near.js';
import { phalaClient } from './phala.js';
import { launcherServer } from './server.js';
import { provisionBody } from '../../dstack/provision.mjs';

const env = process.env;
const need = (/** @type {string} */ name) => {
	if (!env[name]) {
		console.error(`[launcher] set ${name}`);
		process.exit(2);
	}
	return /** @type {string} */ (env[name]);
};

const rpcUrl = env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const network = rpcUrl.includes('testnet') ? 'testnet' : 'mainnet';
const contractId = need('BRIDGE_CONTRACT_ID');
const accountId = need('LAUNCHER_ACCOUNT_ID');
const image = need('BRIDGE_IMAGE');
const keyFile =
	env.LAUNCHER_NEAR_KEY_FILE || join(homedir(), '.near-credentials', network, `${accountId}.json`);
const secretKey = JSON.parse(readFileSync(keyFile, 'utf8')).private_key;

let phalaKey = env.PHALA_API_KEY ?? '';
if (!phalaKey) {
	try {
		phalaKey = execFileSync('security', ['find-generic-password', '-s', 'phala', '-w'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	} catch {
		// none
	}
}

const near = nearClient({ rpcUrl, contractId, accountId, secretKey });
const phala = phalaClient({ apiKey: phalaKey });
const launcher = createLauncher({
	near,
	phala,
	// One VM name per books, without the account in it: Phala sees a hash, not the books' name.
	provisionBody: (books) =>
		provisionBody(image, {
			name: `belege-bridge-${createHash('sha256').update(books).digest('hex').slice(0, 16)}`,
			launcherUrl: env.LAUNCHER_PUBLIC_URL || undefined
		})
});

if (env.LAUNCHER_QUOTE_DIR) {
	const quote = launcher.quote;
	launcher.quote = async (body) => {
		const file = join(env.LAUNCHER_QUOTE_DIR ?? '', `quote-${Date.now()}.json`);
		writeFileSync(file, JSON.stringify(body));
		console.error(`[launcher] quote kept in ${file}`);
		return quote(body);
	};
}

const origins = (env.LAUNCHER_ORIGINS || 'https://belege.le-space.de,http://localhost:5173').split(
	','
);
const port = Number(env.LAUNCHER_PORT || 8790);
const host = env.LAUNCHER_HOST || '127.0.0.1';
launcherServer(launcher, { origins }).listen(port, host, () =>
	console.error(`[launcher] on ${host}:${port}, contract ${contractId}, as ${accountId}`)
);

const tick = () =>
	launcher
		.tick()
		.catch((e) => console.error(`[launcher] tick: ${e.message}`))
		.finally(() => setTimeout(tick, 5_000));
tick();
