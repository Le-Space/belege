#!/usr/bin/env node
// The relay for own devices in the own network (lan-relay.js, issue #148):
//
//   pnpm setup:relay            choose this Mac's address in the network and a UDP port
//   pnpm setup:relay -- --off   switch it off
//
// Off by default. It listens on the one address chosen, never on all, and is
// never forwarded by the router. Saved in bridge.json (`lanRelay`); the peer
// key and certificate are made at the bridge's next start.

import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { DEFAULT_LAN_RELAY_PORT } from './lan-relay-port.js';
import { lanAddresses } from './lan-relay.js';
import { ask, closePrompts } from './prompt.js';

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {string} deps.configPath
 * @param {boolean} [deps.off]
 * @param {ReturnType<typeof networkInterfaces>} [deps.interfaces]
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runRelaySetup({
	io,
	configPath,
	off = false,
	interfaces = networkInterfaces()
}) {
	const config = await loadConfig(configPath);
	if (off) {
		config.lanRelay = { ...config.lanRelay, host: null };
		await saveConfig(config, configPath);
		io.print('The LAN relay is off from the next start of the bridge.');
		return true;
	}
	const addresses = lanAddresses(interfaces);
	if (addresses.length === 0) {
		io.print(
			'This Mac has no address in a private network (Wi-Fi or Ethernet at home or in the office).'
		);
		return false;
	}
	io.print('Own devices meet at a relay in this bridge, in this network only.');
	io.print('Which address of this Mac? (the one the phone reaches in the same Wi-Fi)');
	addresses.forEach((a, i) => io.print(`  ${i + 1}. ${a.address} (${a.name})`));
	const pick = Number((await io.ask(`Number [1]: `)) || '1');
	const chosen = addresses[pick - 1];
	if (!chosen) {
		io.print('No such number.');
		return false;
	}
	const current = config.lanRelay.port || DEFAULT_LAN_RELAY_PORT;
	const port = Number((await io.ask(`UDP port [${current}]: `)) || current);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		io.print('The port must be 1024–65535.');
		return false;
	}
	config.lanRelay = { host: chosen.address, port };
	await saveConfig(config, configPath);
	io.print(`Saved: ${chosen.address}, UDP ${port}. Restart the bridge (pnpm bridge).`);
	io.print(
		'macOS may ask whether "node" may accept incoming connections: allow it, or phones cannot reach the relay.'
	);
	io.print('Do not forward this port in your router: the relay is for this network only.');
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const saved = await runRelaySetup({
			io: { ask, print: (line) => console.log(line) },
			configPath: defaultConfigPath(),
			off: process.argv.includes('--off')
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}
