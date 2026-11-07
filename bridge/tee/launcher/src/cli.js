#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The launcher, as it runs at Le Space. Configuration from the environment:
//
//   LAUNCHER_PORT              default 8790, on 127.0.0.1 (the reverse proxy is in front)
//   LAUNCHER_ORIGINS           browser origins, comma-separated (default the hosted app and localhost:5173)
//   NEAR_RPC_URL               default https://rpc.testnet.fastnear.com
//   BRIDGE_CONTRACT_ID         the contract (bridge/tee/near-contract)
//   LAUNCHER_ACCOUNT_ID        the launcher's NEAR account (named a launcher in the contract)
//   LAUNCHER_NEAR_KEY_FILE     its key, a near-cli credentials file (default ~/.near-credentials/<network>/<id>.json)
//   PHALA_API_KEY              or the macOS keychain, service "phala"
//   BRIDGE_IMAGE               the released bridge image, pinned: ghcr.io/…@sha256:…
//
// Secrets are read, never printed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
			name: `belege-bridge-${createHash('sha256').update(books).digest('hex').slice(0, 16)}`
		})
});

const origins = (env.LAUNCHER_ORIGINS || 'https://belege.le-space.de,http://localhost:5173').split(
	','
);
const port = Number(env.LAUNCHER_PORT || 8790);
launcherServer(launcher, { origins }).listen(port, '127.0.0.1', () =>
	console.error(`[launcher] on 127.0.0.1:${port}, contract ${contractId}, as ${accountId}`)
);

const tick = () =>
	launcher
		.tick()
		.catch((e) => console.error(`[launcher] tick: ${e.message}`))
		.finally(() => setTimeout(tick, 5_000));
tick();
