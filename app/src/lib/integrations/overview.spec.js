import { describe, expect, it } from 'vitest';

import { integrationsOverview } from './overview.js';

/** @param {Partial<import('./overview.js').Facts>} over */
const facts = (over = {}) => ({
	bridge: {
		token: 'tok',
		state: 'online',
		health: { hibiscus: true, kraken: false, mail: true, llm: true }
	},
	devices: { flag: false, online: false, removed: false, error: null, connected: 0 },
	accounts: [],
	events: [],
	wallets: 0,
	aleph: 0,
	invoiceApp: false,
	isWalletSource: (/** @type {string} */ s) => s === 'nyx',
	...over
});
const row = (/** @type {any} */ v, /** @type {string} */ id) =>
	v.rows.find((/** @type {any} */ r) => r.id === id);

describe('the Integrationen overview', () => {
	it('a paired bridge that answers: set-up integrations count as connected, the rest as not set up', () => {
		const v = integrationsOverview(facts());
		expect(row(v, 'bridge')).toMatchObject({ kind: 'ok', state: 'connected' });
		expect(row(v, 'ki')).toMatchObject({ kind: 'ok', state: 'setUp' });
		expect(row(v, 'kraken')).toMatchObject({ kind: 'off', state: 'notSetUp' });
		expect(v.counts.ok + v.counts.off).toBeLessThanOrEqual(v.rows.length);
	});

	it('Hibiscus set up but never synced needs the person; after a sync it does not', () => {
		expect(integrationsOverview(facts()).needs).toEqual([
			{ id: 'bank', kind: 'warn', text: 'neverSynced', params: { name: 'Hibiscus' } }
		]);
		const synced = integrationsOverview(
			facts({
				accounts: [{ source: 'hibiscus' }],
				events: [{ kind: 'bank-sync', source: 'hibiscus', at: '2026-09-28T09:00:00Z' }]
			})
		);
		expect(synced.needs).toEqual([]);
		expect(row(synced, 'bank')).toMatchObject({ kind: 'ok', when: '2026-09-28T09:00:00Z' });
	});

	it('a paired bridge that does not answer is an error to fix; an unpaired one is not', () => {
		const down = integrationsOverview(
			facts({ bridge: { token: 'tok', state: 'offline', health: facts().bridge.health } })
		);
		expect(row(down, 'bridge')).toMatchObject({ kind: 'err' });
		expect(down.needs[0]).toMatchObject({ id: 'bridge', kind: 'err', text: 'bridgeOffline' });
		const unpaired = integrationsOverview(
			facts({
				bridge: {
					token: null,
					state: 'online',
					health: { hibiscus: false, kraken: false, mail: false, llm: false }
				}
			})
		);
		expect(row(unpaired, 'bridge')).toMatchObject({ kind: 'warn', state: 'unpaired' });
		expect(unpaired.needs).toEqual([]);
		expect(row(unpaired, 'ki').kind).toBe('off');
	});

	it('wallets, Aleph accounts, devices and the invoice app from what the books keep', () => {
		const v = integrationsOverview(
			facts({
				wallets: 2,
				aleph: 1,
				invoiceApp: true,
				devices: { flag: true, online: true, removed: false, error: null, connected: 1 },
				events: [
					{ kind: 'bank-sync', source: 'nyx', at: '2026-09-28T08:00:00Z' },
					{ kind: 'bank-sync', source: 'hibiscus', at: '2026-09-27T08:00:00Z' }
				]
			})
		);
		expect(row(v, 'wallets')).toMatchObject({
			kind: 'ok',
			params: { count: 2 },
			when: '2026-09-28T08:00:00Z'
		});
		expect(row(v, 'aleph')).toMatchObject({ kind: 'ok', params: { count: 1 } });
		expect(row(v, 'geraete')).toMatchObject({ kind: 'ok', state: 'on', params: { count: 1 } });
		expect(row(v, 'rechnungs-app')).toMatchObject({ kind: 'ok', state: 'paired' });
	});

	it('a device removed elsewhere needs the person', () => {
		const v = integrationsOverview(
			facts({ devices: { flag: false, online: false, removed: true, error: null, connected: 0 } })
		);
		expect(row(v, 'geraete')).toMatchObject({ kind: 'warn', state: 'removed' });
		expect(v.needs.map((n) => n.text)).toContain('deviceRemoved');
	});

	it('a phone using the Mac’s bridge: working, no pairing to fix; both unreachable says so', () => {
		const phone = integrationsOverview(
			facts({
				bridge: { ...facts().bridge, via: 'device' },
				devices: { ...facts().devices, online: true }
			})
		);
		expect(phone.viaDevice).toBe(true);
		expect(row(phone, 'bridge')).toMatchObject({
			kind: 'ok',
			state: 'viaDevice',
			line: 'bridgeViaDevice'
		});
		const lost = integrationsOverview(
			facts({
				bridge: { ...facts().bridge, state: 'offline', via: 'device' },
				devices: { ...facts().devices, online: true }
			})
		);
		expect(lost.viaDevice).toBe(false);
		expect(lost.needs[0]).toMatchObject({ id: 'bridge', text: 'bridgeOfflineDevices' });
	});

	it('what the last runs left: a refused Kraken key, wallets with hints', () => {
		const v = integrationsOverview(
			facts({
				alerts: { kraken: { raw: 'EAPI:Invalid nonce' }, wallets: { w1: 2, w2: 0 } },
				wallets: 2
			})
		);
		expect(row(v, 'kraken')).toMatchObject({ kind: 'err', state: 'error' });
		expect(row(v, 'wallets')).toMatchObject({ kind: 'warn' });
		expect(v.needs).toEqual(
			expect.arrayContaining([
				{ id: 'kraken', kind: 'err', text: 'krakenRefused' },
				{ id: 'wallets', kind: 'warn', text: 'walletHints', params: { count: 1 } }
			])
		);
	});
});
