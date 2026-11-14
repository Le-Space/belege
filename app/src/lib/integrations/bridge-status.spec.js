import { describe, expect, it } from 'vitest';
import {
	bridgeStatusRows,
	expectedBridge,
	hostedBridgeOf,
	hostedVmRunning,
	llmAttested
} from './bridge-status.js';

const HASH = 'a'.repeat(64);
/** @param {ReturnType<typeof bridgeStatusRows>} rows */
const states = (rows) => rows.map((r) => `${r.id}:${r.kind}:${r.state}`);

describe('bridgeStatusRows', () => {
	it('nothing anywhere: three quiet lines, none an error', () => {
		const rows = bridgeStatusRows({ local: { state: 'offline', paired: false } });
		expect(states(rows)).toEqual(['local:idle:none', 'aleph:idle:none', 'near:idle:none']);
	});

	it('the paired bridge on the computer answers over HTTP', () => {
		const rows = bridgeStatusRows({ local: { state: 'online', route: 'local', paired: true } });
		expect(states(rows)[0]).toBe('local:ok:answers');
		expect(rows.filter((r) => r.answers).map((r) => r.id)).toEqual(['local']);
	});

	it('a paired bridge on the computer that is silent is the only error', () => {
		const rows = bridgeStatusRows({ local: { state: 'offline', paired: true } });
		expect(states(rows)).toEqual(['local:err:silent', 'aleph:idle:none', 'near:idle:none']);
	});

	it('a VM Aleph has but this browser has not unlocked: running, locked', () => {
		const rows = bridgeStatusRows({
			local: { state: 'offline', paired: false },
			aleph: { vm: { instance: HASH }, kept: null }
		});
		expect(states(rows)).toEqual(['local:idle:none', 'aleph:warn:locked', 'near:idle:none']);
	});

	it('an unlocked VM that answers over the stream: Aleph answers, the computer has none', () => {
		const rows = bridgeStatusRows({
			local: { state: 'online', route: 'stream', paired: true, peerId: 'peer-vm' },
			aleph: { vm: { instance: HASH }, kept: { instance: HASH, peerId: 'peer-vm' } }
		});
		expect(states(rows)).toEqual(['local:idle:none', 'aleph:ok:answers', 'near:idle:none']);
	});

	it('an unlocked VM that does not answer is the error, not the computer', () => {
		const rows = bridgeStatusRows({
			local: { state: 'offline', paired: true, peerId: 'peer-vm' },
			aleph: { vm: { instance: HASH }, kept: { instance: HASH, peerId: 'peer-vm' } }
		});
		expect(states(rows)).toEqual(['local:idle:none', 'aleph:err:silent', 'near:idle:none']);
	});

	it('a stopped VM is stopped, even with the record of its unlock', () => {
		const rows = bridgeStatusRows({
			local: { state: 'offline', paired: false },
			aleph: {
				vm: { instance: HASH, stoppedAt: '2026-01-02T00:00:00Z' },
				kept: { instance: HASH, peerId: 'peer-vm' }
			}
		});
		expect(states(rows)[1]).toBe('aleph:idle:stopped');
	});

	it("the computer's own node over the stream is the computer, beside an unlocked VM", () => {
		const rows = bridgeStatusRows({
			local: { state: 'online', route: 'stream', paired: true, peerId: 'peer-mac' },
			aleph: { vm: { instance: HASH }, kept: { instance: HASH, peerId: 'peer-vm' } }
		});
		expect(states(rows)).toEqual(['local:ok:answers', 'aleph:ok:unlocked', 'near:idle:none']);
	});

	it('the bridge on Phala: pending, then answering', () => {
		const pending = bridgeStatusRows({
			local: { state: 'offline', paired: false },
			near: { running: false, pending: 'start' }
		});
		expect(states(pending)[2]).toBe('near:warn:pending');
		const answering = bridgeStatusRows({
			local: { state: 'online', route: 'stream', paired: true, peerId: 'peer-near' },
			near: { running: true, peerId: 'peer-near' }
		});
		expect(states(answering)).toEqual(['local:idle:none', 'aleph:idle:none', 'near:ok:answers']);
	});

	it('a phone using the computer’s bridge: the computer answers, through a device', () => {
		const rows = bridgeStatusRows({ local: { state: 'online', route: 'device', paired: true } });
		expect(states(rows)[0]).toBe('local:ok:viaDevice');
	});
});

describe('hostedBridgeOf', () => {
	const peers = { aleph: 'peer-aleph', near: 'peer-near' };

	it('the books’ bridge is a hosted one when its node is a VM’s', () => {
		expect(hostedBridgeOf('peer-aleph', peers)).toBe('aleph');
		expect(hostedBridgeOf('peer-near', peers)).toBe('near');
	});

	it('the bridge on a computer, or none, is not hosted', () => {
		expect(hostedBridgeOf('peer-mac', peers)).toBe(null);
		expect(hostedBridgeOf(null, peers)).toBe(null);
		expect(hostedBridgeOf('peer-mac', null)).toBe(null);
		// No VM known and no bridge paired: nothing equals nothing, and that is not a hosted bridge.
		expect(hostedBridgeOf(null, { aleph: null, near: null })).toBe(null);
		expect(hostedBridgeOf(undefined, {})).toBe(null);
	});
});

describe('hostedVmRunning', () => {
	it('a VM on Aleph that was not stopped, or a bridge the contract holds', () => {
		expect(hostedVmRunning({ aleph: { vm: { instance: HASH } } })).toBe(true);
		expect(hostedVmRunning({ near: { running: true } })).toBe(true);
	});

	it('none, or a stopped one', () => {
		expect(hostedVmRunning({})).toBe(false);
		expect(hostedVmRunning({ aleph: { vm: null }, near: null })).toBe(false);
		expect(
			hostedVmRunning({ aleph: { vm: { instance: HASH, stoppedAt: '2026-01-01T00:00:00Z' } } })
		).toBe(false);
		expect(hostedVmRunning({ near: { running: false } })).toBe(false);
	});
});

describe('expectedBridge', () => {
	const peers = { aleph: 'peer-aleph', near: 'peer-near' };

	it('the hosted bridge that is the books’ bridge', () => {
		expect(expectedBridge({ peerId: 'peer-aleph', paired: true, peers })).toBe('aleph');
		expect(expectedBridge({ peerId: 'peer-near', paired: true, peers })).toBe('near');
	});

	it('the bridge on a computer when that is paired, whatever VM the books once started', () => {
		expect(expectedBridge({ peerId: 'peer-mac', paired: true, peers })).toBe('local');
		expect(expectedBridge({ peerId: null, paired: true, peers, alephVm: { instance: HASH } })).toBe(
			'local'
		);
	});

	it('nothing paired: a VM the books started and did not unlock yet, or stopped; else none', () => {
		expect(expectedBridge({ paired: false, alephVm: { instance: HASH } })).toBe('aleph');
		expect(
			expectedBridge({
				paired: false,
				alephVm: { instance: HASH, stoppedAt: '2026-01-01T00:00:00Z' }
			})
		).toBe('aleph');
		expect(expectedBridge({ paired: false })).toBe(null);
	});
});

describe('llmAttested', () => {
	const at = '2026-01-01T10:00:00.000Z';
	const tee = { itemHash: HASH, measurement: 'b'.repeat(96), verifiedAt: at, error: null };

	it('only what the bridge itself reports as checked', () => {
		expect(llmAttested({ configured: true, models: { primary: 'model-a' }, tee })).toEqual({
			model: 'model-a',
			verifiedAt: at
		});
	});

	it('not a pin that was not checked yet, a check that failed, or no model', () => {
		expect(llmAttested({ configured: true, tee: { ...tee, verifiedAt: null } })).toBe(null);
		expect(llmAttested({ configured: true, tee: { ...tee, error: 'measurement differs' } })).toBe(
			null
		);
		expect(llmAttested({ configured: false, tee })).toBe(null);
		expect(llmAttested({ configured: true, tee: null })).toBe(null);
		expect(llmAttested({ configured: true, tee: { ...tee, verifiedAt: 'yes' } })).toBe(null);
		expect(llmAttested(null)).toBe(null);
	});
});
