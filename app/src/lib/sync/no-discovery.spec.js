// No DHT, no discovery, no NAT probing, no provide (AGENTS.md, "Network";
// audit plan #209, standing test 4 of #537).
//
// Every libp2p node the app can start is listed here with the services it
// runs. Three ways in are closed:
//   1. the options of each node, in every network mode: the exact service
//      list, no peer discovery, no routers;
//   2. each node started as the app starts it (Helia light, bitswap), over the
//      in-memory transport: what it answers to, and that a provide has nowhere
//      to go;
//   3. the sources: no node is made anywhere else, Helia never builds its own
//      libp2p (whose defaults carry a DHT), and no discovery package is
//      imported or depended on.
// A new service, a new node or an upgrade that brings one of these back fails
// here, and the line that changes says what was allowed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { CID } from 'multiformats/cid';

import { createOfflineLibp2pConfig } from '../network.js';
import { ucepLibp2pConfig } from '../ucep/net.js';
import { restoreLibp2pConfig } from '../backup/restore-peers.js';
import { createDeviceGate } from './device-gate.js';
import { syncLibp2pConfig } from './device-sync.js';
import { loopbackConfig } from './loopback-bridge.js';
import { joinLibp2pConfig } from './join-node.js';

const RELAY = '/dns4/relay.example/tcp/443/wss/p2p/12D3KooWExample';
const GATED = ['deviceGate', 'identify', 'identifyPush', 'identifyPushDevices'];

/** A gate nobody passes: every peer is checked against a key nobody has. */
const gate = () => createDeviceGate({ keyFor: () => crypto.getRandomValues(new Uint8Array(32)) });

/**
 * Every node of the app: where it is made, its options, the services it runs.
 *
 * @type {{ name: string, file: string, config: (privateKey: any) => import('libp2p').Libp2pOptions<any>, services: string[] }[]}
 */
const NODES = [
	.../** @type {const} */ (['public', 'qr', 'lan', 'both']).map((mode) => ({
		name: `device sync, mode ${mode}`,
		file: 'node.js',
		config: (/** @type {any} */ privateKey) =>
			syncLibp2pConfig({ privateKey, relays: mode === 'qr' ? [] : [RELAY], gate: gate(), mode }),
		services: [...GATED, 'pubsub']
	})),
	{
		name: 'the books without device sync',
		file: 'network.js',
		config: (privateKey) => createOfflineLibp2pConfig(privateKey),
		services: ['identify', 'pubsub']
	},
	{
		name: 'the invoicing link (UCEP)',
		file: 'ucep/net.js',
		config: (privateKey) => ucepLibp2pConfig({ privateKey, relays: [RELAY] }),
		services: ['identify', 'identifyPush']
	},
	{
		name: 'the bridge on this machine',
		file: 'sync/loopback-bridge.js',
		config: (privateKey) => loopbackConfig({ privateKey, gate: gate() }),
		services: GATED
	},
	{
		name: 'a new device joining with its own passkey (#962)',
		file: 'session/own-join.js',
		config: (privateKey) => joinLibp2pConfig({ privateKey, getOutboundSession: () => null }),
		services: []
	},
	{
		name: 'a restore from other nodes',
		file: 'backup/restore-peers.js',
		config: () => restoreLibp2pConfig(),
		services: ['identify']
	}
];

/** What a protocol id must not look like, whoever registered it. */
const FORBIDDEN_PROTOCOL = /kad|autonat|dcutr|rendezvous|mdns|\/hop|fetch|peer-exchange/i;
/** What the nodes answer to: identify, gossipsub, bitswap, the device proof. */
const KNOWN_PROTOCOL =
	/^\/(ipfs\/id\/|ipfs\/id\/push\/|meshsub\/|floodsub\/|ipfs\/bitswap|belege\/)/;

describe('the options of every node', () => {
	for (const node of NODES) {
		it(`${node.name}: ${node.services.join(', ')} – nothing else`, () => {
			const config = /** @type {any} */ (node.config({}));
			expect(Object.keys(config.services ?? {})).toEqual(node.services);
			expect(config.peerDiscovery ?? []).toEqual([]);
			expect(config.contentRouters ?? []).toEqual([]);
			expect(config.peerRouters ?? []).toEqual([]);
			// Nothing of libp2p's is written down: no peer store, no keychain on disk.
			expect(config.datastore).toBeUndefined();
		});
	}
});

describe('every node, started as the app starts it', () => {
	/** @type {any[]} */
	const started = [];
	afterAll(async () => {
		await Promise.all(started.map((h) => h.stop().catch(() => {})));
	});

	for (const node of NODES) {
		it(`${node.name}: answers to nothing but its own protocols, and provides nowhere`, async () => {
			const libp2p = await createLibp2p({
				...node.config(await generateKeyPair('Ed25519')),
				// Not the browser's transports: nothing is dialled here.
				addresses: { listen: [] },
				transports: [memory()]
			});
			const helia = await withBitswap(withLibp2p(createHeliaLight({}), libp2p)).start();
			started.push(helia);

			expect(Object.keys(libp2p.services)).toEqual(node.services);
			const protocols = libp2p.getProtocols();
			expect(protocols.filter((p) => FORBIDDEN_PROTOCOL.test(p))).toEqual([]);
			expect(protocols.filter((p) => !KNOWN_PROTOCOL.test(p))).toEqual([]);

			// No router: a provide, a provider search and a peer search have nowhere to go.
			const cid = CID.parse('bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy');
			await expect(libp2p.contentRouting.provide(cid)).rejects.toThrow(/no content routers/i);
			await expect(
				(async () => {
					for await (const _ of libp2p.contentRouting.findProviders(cid)) void _;
				})()
			).rejects.toThrow(/no content routers/i);
			await expect(libp2p.peerRouting.findPeer(libp2p.peerId)).rejects.toThrow(/no peer routers/i);
		});
	}
});

describe('the sources', () => {
	const SRC = fileURLToPath(new URL('../..', import.meta.url));
	const APP = join(SRC, '..');
	/** @param {string} dir @returns {string[]} */
	const filesIn = (dir) =>
		readdirSync(dir).flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? filesIn(path) : [path];
		});
	const sources = filesIn(SRC)
		.filter((file) => /\.(js|svelte)$/.test(file) && !/\.spec\.js$/.test(file))
		.map((file) => ({ file: relative(join(SRC, 'lib'), file), text: readFileSync(file, 'utf8') }));
	/** @param {RegExp} pattern @returns {string[]} the files with a match */
	const filesWith = (pattern) => sources.filter((s) => pattern.test(s.text)).map((s) => s.file);

	it('a libp2p node is made only where this spec knows of it', () => {
		expect(filesWith(/\bcreateLibp2p\s*\(/).sort()).toEqual(
			[...new Set(NODES.map((n) => n.file))].sort()
		);
	});

	it('Helia is the light one and is always handed a libp2p node, never options for one', () => {
		// `createHelia` and `libp2pDefaults` bring routers and a DHT of their own.
		expect(
			filesWith(/\bcreateHelia\s*\(|\blibp2pDefaults\b|from 'helia\/|@helia\/routers/)
		).toEqual([]);
		const handed = sources.flatMap((s) => s.text.match(/\bwithLibp2p\s*\(.*\)/g) ?? []);
		expect(handed.length).toBeGreaterThan(0);
		for (const call of handed) expect(call).toMatch(/,\s*libp2p\)/);
	});

	const DISCOVERY =
		/@libp2p\/(kad-dht|autonat|autonat-v2|mdns|bootstrap|pubsub-peer-discovery|upnp-nat|dcutr|rendezvous|peer-discovery|fetch)\b|@helia\/(routers|delegated-routing|ipns)|ipni|@chainsafe\/discv5/;

	it('no discovery, DHT or NAT package is imported', () => {
		expect(filesWith(new RegExp(`from '(${DISCOVERY.source})`))).toEqual([]);
	});

	it('… or depended on', () => {
		const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
		const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
		expect(names.filter((name) => DISCOVERY.test(name))).toEqual([]);
	});

	it('nothing provides, reprovides or pins', () => {
		expect(
			filesWith(
				/\.routing\.provide\s*\(|contentRouting\.provide\s*\(|\.pins\.(add|rm)\s*\(|\b(cancelR|r)eprovide/
			)
		).toEqual([]);
	});
});
