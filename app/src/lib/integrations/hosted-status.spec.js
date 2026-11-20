// The start of the unlocked VM, as its card hands it to the status block.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/session.svelte.js', () => ({
	app: { sync: { bridgeRoute: 'local' } },
	hostedBridgeRecord: async () => null,
	hostedVmRecord: async () => null,
	nearHostedRecord: async () => null
}));
vi.mock('./bridge-state.svelte.js', () => ({
	bridge: { state: 'offline', peerId: null },
	bridgePaired: () => false
}));

const { alephStart, hosted, noteAleph, noteAlephStart } = await import('./hosted-status.svelte.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => {
	noteAleph(null, null);
	noteAlephStart(null, null, false);
});

describe('the unlocked VM’s start, for the status block', () => {
	it('nothing read: nothing said', () => {
		expect(alephStart()).toEqual({ startHint: null, notUp: false });
	});

	it('what the card read about the VM unlocked last', () => {
		noteAleph({ instance: A }, { instance: A });
		noteAlephStart(A, 'starting', false);
		expect(alephStart()).toEqual({ startHint: 'starting', notUp: false });
		noteAlephStart(A, null, true);
		expect(alephStart()).toEqual({ startHint: null, notUp: true });
	});

	it('nothing of another VM’s: a new unlock starts clean', () => {
		noteAleph({ instance: A }, { instance: A });
		noteAlephStart(A, 'nodeStuck', true);
		noteAleph({ instance: B }, { instance: B });
		expect(alephStart()).toEqual({ startHint: null, notUp: false });
	});

	it('the same reading again changes nothing', () => {
		noteAlephStart(A, 'starting', false);
		const before = hosted.start;
		noteAlephStart(A, 'starting', false);
		expect(hosted.start).toBe(before);
	});
});
