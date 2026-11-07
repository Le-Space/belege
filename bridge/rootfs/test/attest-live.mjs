#!/usr/bin/env node
// Attest (and unlock) the hosted bridge's VM the way the browser does (#583,
// #584): relay-button's RA-TLS client in WASM (@le-space/attest-wasm), over a
// WebSocket through an attest relay's /attest, the AMD chain checked against
// KDS, the expected measurement computed here from Aleph's published SEV-SNP
// runtime and the owner's address – not read from the node.
//
//   node attest-live.mjs unlock <instance hash> <node hash> <relay wss url>
//     env: ALEPH_PRIVATE_KEY (the owner), PASSPHRASE_FILE, SECRETS_FILE (JSON, optional), VCPUS
//   node attest-live.mjs attest <instance hash> <node hash> <relay wss url>
//     env: ALEPH_PRIVATE_KEY (only its address is used), VCPUS
//
// Needs @le-space/attest-wasm and ethers next to it (the workflow installs
// them into the directory it copies this script to). Prints JSON on stdout:
// whether the measurement the INSTANCE pins is the one computed here, the
// measurement the guest reported, and the phase timings in ms. Secrets are
// never printed.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { Wallet } from 'ethers';
import * as wasm from '@le-space/attest-wasm/pkg/relay_button_attest.js';
import {
	confidentialTrustedExecution,
	pinsOf,
	unlockInstance
} from '@le-space/attest-wasm/instance';
import { attestGuest, websocketTransport } from '@le-space/attest-wasm/ratls';

const API = process.env.ALEPH_API_HOST ?? 'https://api2.aleph.im';
const [mode, vm, crn, relay] = process.argv.slice(2);
if (
	!['unlock', 'attest'].includes(mode ?? '') ||
	!/^[0-9a-f]{64}$/.test(vm ?? '') ||
	!/^[0-9a-f]{64}$/.test(crn ?? '') ||
	!/^wss:\/\/[a-z0-9.-]+(:\d+)?\/attest$/.test(relay ?? '')
) {
	console.error(
		'usage: attest-live.mjs unlock|attest <instance hash> <node hash> <wss://host/attest>'
	);
	process.exit(2);
}
const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
	require.resolve('@le-space/attest-wasm/pkg/relay_button_attest_bg.wasm')
);
wasm.initSync({ module: wasmBytes });

const owner = new Wallet(/** @type {string} */ (process.env.ALEPH_PRIVATE_KEY));
const vcpus = Number(process.env.VCPUS ?? 2);
const started = Date.now();
/** @type {Record<string, number>} */
const timings = {};
const mark = (/** @type {string} */ phase) => (timings[phase] = Date.now() - started);

// The published measurement: Aleph's SEV-SNP runtime for this owner and vCPU count.
const published = await confidentialTrustedExecution({
	wasm,
	owner: owner.address,
	vcpus,
	apiHost: API
});
mark('measured');
const message = await (await fetch(`${API}/api/v0/messages/${vm}`)).json();
const content = message.message?.content ?? message.content;
const pinned = content?.environment?.trusted_execution;
const ours = pinsOf(published);
const theirs = pinsOf(pinned);
const same =
	ours.expectedPolicy === theirs.expectedPolicy &&
	ours.expectedMeasurements.length === theirs.expectedMeasurements.length &&
	ours.expectedMeasurements.every((m) => theirs.expectedMeasurements.includes(m));
if (!same) {
	console.log(JSON.stringify({ mode, published: false, ours, theirs, timings }));
	console.error('the INSTANCE pins a measurement other than the published one: no secret goes out');
	process.exit(1);
}
const url = `${relay}?crn=${crn}&vm=${vm}`;

if (mode === 'unlock') {
	const passphrase = (
		await readFile(/** @type {string} */ (process.env.PASSPHRASE_FILE), 'utf8')
	).replace(/\r?\n$/, '');
	const secrets = process.env.SECRETS_FILE
		? JSON.parse(await readFile(process.env.SECRETS_FILE, 'utf8'))
		: {};
	const result = await unlockInstance({
		wasm,
		relayUrl: relay,
		crnHash: crn,
		instanceItemHash: vm,
		// What this script computed, not what the message says: the same pins, checked above.
		trustedExecution: published,
		passphrase,
		secrets,
		sign: (payload) => owner.signMessage(payload),
		onProgress: ({ phase, detail }) => {
			console.error(`${phase}: ${detail}`);
			if (phase === 'unlock' && !timings.attested) mark('attested');
		}
	});
	mark('unlocked');
	console.log(
		JSON.stringify({
			mode,
			published: true,
			injected: result.injected,
			measurement: result.measurement,
			policy: result.policy,
			launchTcb: result.launchTcb,
			timings
		})
	);
} else {
	const attested = await attestGuest({ wasm, transport: websocketTransport(url), ...ours });
	mark('attested');
	attested.channel.close();
	console.log(
		JSON.stringify({
			mode,
			published: true,
			measurement: ours.expectedMeasurements,
			relay,
			certVerified: Boolean(attested.certVerified),
			freshVerified: Boolean(attested.freshVerified),
			timings
		})
	);
}
process.exit(0);
