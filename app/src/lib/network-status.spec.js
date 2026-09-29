import { describe, expect, it } from 'vitest';

import { networkStatus } from './network-status.js';

const off = {
	sync: { online: false, error: null, state: null },
	ucep: { status: /** @type {const} */ ('off') }
};

describe('what the header says about the network', () => {
	it('paused in the header menu: paused, whatever runs', () => {
		expect(
			networkStatus({
				...off,
				network: { paused: true },
				sync: { online: true, error: null, state: null }
			})
		).toEqual({ state: 'paused', parts: [] });
	});

	it('nothing on: off', () => {
		expect(networkStatus(off)).toEqual({ state: 'off', parts: [] });
	});

	it('device sync: connecting, online without a device, connected, failed', () => {
		const sync = (/** @type {any} */ s) => networkStatus({ ...off, sync: { ...off.sync, ...s } });
		expect(sync({ online: true }).state).toBe('connecting');
		expect(sync({ online: true, state: { devices: [{ connected: false }] } }).state).toBe('online');
		expect(
			sync({ online: true, state: { devices: [{ connected: true }, { connected: true }] } })
				.parts[0]
		).toEqual({
			id: 'devices',
			state: 'connected',
			devices: 2
		});
		expect(sync({ online: false, error: 'kein Relay' }).parts[0]).toMatchObject({
			state: 'failed',
			error: 'kein Relay'
		});
	});

	it('the invoicing app, and both: the most telling state wins', () => {
		const ucep = (/** @type {any} */ u) => networkStatus({ ...off, ucep: u });
		expect(ucep({ status: 'starting' }).state).toBe('connecting');
		expect(ucep({ status: 'running', app: null }).state).toBe('online');
		expect(ucep({ status: 'running', app: { peerId: 'x' } }).state).toBe('connected');
		const both = networkStatus({
			sync: { online: true, error: null, state: { devices: [{ connected: true }] } },
			ucep: { status: 'starting' }
		});
		expect(both.parts.map((p) => p.id)).toEqual(['devices', 'invoice-app']);
		expect(both.state).toBe('connecting');
	});
});
