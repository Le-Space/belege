import { describe, expect, it } from 'vitest';
import { expectedBridgeOf } from './expected.js';

const HASH = 'a'.repeat(64);

/** @param {Record<string, unknown>} values the settings, by key */
const settingsOf = (values) =>
	/** @type {any} */ ({
		list: async ({ where = () => true } = {}) =>
			Object.entries(values)
				.map(([key, value]) => ({ key, value }))
				.filter(where)
	});

describe('expectedBridgeOf', () => {
	it('nothing kept: none', async () => {
		expect(await expectedBridgeOf(settingsOf({}))).toBeNull();
	});

	it('paired by code, or its node by invitation: the bridge on a computer', async () => {
		expect(await expectedBridgeOf(settingsOf({ bridge: { token: 'made-up-token' } }))).toBe(
			'local'
		);
		expect(await expectedBridgeOf(settingsOf({ bridge: { peerId: '12D3KooWnode' } }))).toBe(
			'local'
		);
	});

	it('the books’ bridge is the VM unlocked on Aleph – also with a token left from before', async () => {
		const settings = settingsOf({
			bridge: { token: 'made-up-token', peerId: '12D3KooWvm' },
			'bridge/hosted': { instance: HASH, peerId: '12D3KooWvm' }
		});
		expect(await expectedBridgeOf(settings)).toBe('aleph');
	});

	it('the books’ bridge is the one on Phala', async () => {
		const settings = settingsOf({
			bridge: { peerId: '12D3KooWtee' },
			'bridge/hosted-near': { peerId: '12D3KooWtee' }
		});
		expect(await expectedBridgeOf(settings)).toBe('near');
	});

	it('a VM started on Aleph and no bridge paired: the hosted one', async () => {
		expect(await expectedBridgeOf(settingsOf({ 'bridge/hosted-vm': { instance: HASH } }))).toBe(
			'aleph'
		);
	});

	it('a hosted bridge unlocked once, the books paired with a computer’s since: the computer', async () => {
		const settings = settingsOf({
			bridge: { peerId: '12D3KooWnode' },
			'bridge/hosted': { instance: HASH, peerId: '12D3KooWvm' }
		});
		expect(await expectedBridgeOf(settings)).toBe('local');
	});

	it('a VM record that is none is ignored', async () => {
		expect(await expectedBridgeOf(settingsOf({ 'bridge/hosted-vm': { note: 'x' } }))).toBeNull();
	});
});
