// The vault handed to a new device with its own passkey (#962): sealed to its
// one-time key and opened only with it; over a real connection the new device
// says what it wants, gets the vault only after "Zulassen", sends its own
// invite and gets the answer; a refusal ends it on both sides; a device that
// does not speak the protocol is left to the device proof; a third peer gets
// nothing. Two libp2p nodes over the in-memory transport; made-up bytes.
import { afterEach, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';

import {
	HandoverError,
	awaitVault,
	giveVault,
	oneTimeKey,
	openHandover,
	sealHandover
} from './vault-handover.js';

const record = { vault: { id: 'v1', slots: [] }, slots: [], removed: [] };
const vaultKey = new Uint8Array(32).fill(9);

/** @type {any[]} */
let nodes = [];

async function node() {
	const n = await createLibp2p({
		addresses: { listen: [`/memory/handover-${Math.random().toString(36).slice(2)}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()]
	});
	nodes.push(n);
	return n;
}

afterEach(async () => {
	await Promise.all(nodes.map((n) => n.stop()));
	nodes = [];
});

describe('sealing the vault for a new device (#962)', () => {
	it('opens with the one-time key only', async () => {
		const key = oneTimeKey();
		const sealed = await sealHandover({ record, vaultKey }, key.publicKey);
		const opened = await openHandover(sealed, key);
		expect(opened.record).toEqual(record);
		expect(Array.from(opened.vaultKey)).toEqual(Array.from(vaultKey));
		await expect(openHandover(sealed, oneTimeKey())).rejects.toThrow(HandoverError);
		const changed = { ...sealed, sealed: sealed.sealed.slice(0, -4) + 'AAAA' };
		await expect(openHandover(changed, key)).rejects.toThrow(HandoverError);
	});
});

describe('handing over the vault on a connection (#962)', () => {
	/** @param {{ allow: boolean }} p */
	async function run({ allow }) {
		const books = await node();
		const fresh = await node();
		const connection = await books.dial(fresh.getMultiaddrs());
		const key = oneTimeKey();
		/** @type {string[]} */
		const steps = [];
		const waiting = awaitVault(fresh, {
			key,
			from: books.peerId.toString(),
			onVault: async (vault) => {
				steps.push(`vault ${vault.record.vault.id}`);
				return 'offer-of-the-new-node';
			},
			onAnswer: async (answer) => {
				steps.push(`answer ${answer}`);
			}
		});
		const giving = giveVault(connection, {
			allow: async (peer) => {
				steps.push(`asked ${peer === fresh.peerId.toString()}`);
				return allow;
			},
			vault: () => ({ record, vaultKey }),
			answerOffer: async (offer) => {
				steps.push(`offer ${offer}`);
				return 'answer-of-the-books-node';
			}
		});
		return { giving, waiting, steps, fresh, key };
	}

	it('gives the vault after "Zulassen", and the two set up the next connection', async () => {
		const { giving, waiting, steps, fresh, key } = await run({ allow: true });
		expect(await giving).toEqual({ peer: fresh.peerId.toString() });
		await waiting;
		expect(steps).toEqual([
			'asked true',
			'vault v1',
			'offer offer-of-the-new-node',
			'answer answer-of-the-books-node'
		]);
		// The one-time key is gone once the vault is open.
		expect(key.secretKey.every((b) => b === 0)).toBe(true);
	});

	it('gives nothing without "Zulassen", and the new device hears so', async () => {
		const { giving, waiting, steps } = await run({ allow: false });
		await expect(giving).rejects.toMatchObject({ code: 'refused' });
		await expect(waiting).rejects.toMatchObject({ code: 'refused' });
		expect(steps).toEqual(['asked true']);
	});

	it('leaves a device that does not speak it to the device proof', async () => {
		const books = await node();
		const own = await node();
		const connection = await books.dial(own.getMultiaddrs());
		const result = await giveVault(connection, {
			allow: async () => {
				throw new Error('not asked');
			},
			vault: () => ({ record, vaultKey }),
			answerOffer: async () => ''
		});
		expect(result).toBeNull();
	});

	it('serves no peer but the one whose invite it answered', async () => {
		const books = await node();
		const stranger = await node();
		const fresh = await node();
		const key = oneTimeKey();
		const waiting = awaitVault(fresh, {
			key,
			from: books.peerId.toString(),
			onVault: async () => 'x',
			onAnswer: async () => {}
		});
		const connection = await stranger.dial(fresh.getMultiaddrs());
		let asked = false;
		const result = await giveVault(connection, {
			allow: async () => (asked = true),
			vault: () => ({ record, vaultKey }),
			answerOffer: async () => ''
		}).catch((e) => e);
		expect(asked).toBe(false);
		expect(result === null || result instanceof Error).toBe(true);
		// Still waiting for the right one.
		const settled = await Promise.race([
			waiting.then(() => 'settled'),
			new Promise((r) => setTimeout(() => r('waiting'), 200))
		]);
		expect(settled).toBe('waiting');
	});
});
