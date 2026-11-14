// What the unlock of a booting VM tries again, and what of an error the card
// shows (#587). Made-up hosts and hashes.
import { describe, expect, it } from 'vitest';

import { cancelled, fatal, isCancelled, pause, reasonOf, unlockVerdict } from './hosted-unlock.js';

describe('trying again', () => {
	it('waits for a VM that is not up yet', () => {
		for (const why of [
			'WebSocket to wss://relay.example.com/attest failed',
			'the connection closed while waiting for the certificate',
			'timed out waiting for the report',
			'the guest answered 502 to the freshness challenge',
			'Aleph answered 503 for the INSTANCE',
			'Failed to fetch'
		]) {
			expect(unlockVerdict(new Error(why)), why).toBe('retry');
		}
	});

	it('stops at a VM not to trust, and at what a later try does not change', () => {
		for (const why of [
			'another image: no secret goes out',
			'measurement not pinned',
			'the guest refused the secrets (403): bad signature',
			'Aleph answered 404 for the INSTANCE',
			'Aleph holds no running INSTANCE under this hash',
			'the guest answered 400 to the freshness challenge',
			'no instance runtime {"x":1} in vm-images',
			'unlocking needs the passphrase of the encrypted rootfs'
		]) {
			expect(unlockVerdict(new Error(why)), why).toBe('stop');
		}
		expect(unlockVerdict(fatal('Keiner der Relays dieser Bücher bietet /attest an.'))).toBe('stop');
		expect(unlockVerdict(cancelled())).toBe('stop');
	});

	it('tries again on what it does not know', () => {
		expect(unlockVerdict(new Error('something odd'))).toBe('retry');
	});
});

describe('the reason shown', () => {
	it('is one short line without query, keys or long hashes', () => {
		const hash = 'ab'.repeat(32);
		const why = reasonOf(
			new Error(
				`WebSocket to wss://relay.example.com/attest?crn=${hash}&vm=${hash} failed\npassphrase=hunter2 token: abc`
			)
		);
		expect(why).toBe('WebSocket to wss://relay.example.com/attest failed passphrase=… token: …');
		expect(reasonOf(`instance ${hash}`)).toBe(`instance ${hash.slice(0, 10)}…`);
		expect(reasonOf(`k ${'Zq'.repeat(25)}==`)).toBe('k …');
		expect(reasonOf('the node said no. '.repeat(30), 20)).toHaveLength(20);
		expect(reasonOf(null)).toBe('');
	});
});

describe('cancelling', () => {
	it('ends the pause at once', async () => {
		const controller = new AbortController();
		const waiting = pause(60_000, controller.signal);
		controller.abort();
		const error = await waiting.catch((e) => e);
		expect(isCancelled(error)).toBe(true);
		await expect(pause(1, controller.signal)).rejects.toThrow('cancelled');
		await expect(pause(1)).resolves.toBeUndefined();
	});
});
