import { describe, expect, it } from 'vitest';
import {
	cleanSettings,
	keptNames,
	mergeSettings,
	secretFileOf,
	withHostedSettings
} from './hosted-settings.js';

describe('the hosted bridge’s settings', () => {
	it('keep only what a hosted bridge reads', () => {
		const kept = cleanSettings({
			secrets: {
				imap: 'pw',
				'portal:stromwerk-test': 'pw2',
				hibiscus: 'not for a VM',
				llm: 'not for a VM',
				'bridge-auth': 'never',
				kraken: '',
				alchemy: 7
			},
			config: {
				mail: { host: 'imap.example.com', user: 'belege@example.com' },
				llm: { baseUrl: 'https://llm.example.com' },
				hibiscus: { host: '127.0.0.1' },
				node: { relays: [] },
				kraken: 'not an object'
			}
		});
		// A portal password stays home: a hosted image has no browser to log in with.
		expect(kept.secrets).toEqual({ imap: 'pw' });
		expect(kept.config).toEqual({
			mail: { host: 'imap.example.com', user: 'belege@example.com' }
		});
	});

	it('go into the VM’s start beside the pairing, which stays the pairing’s', () => {
		const pairing = {
			bridge_auth: 'aa',
			bridge_peer_key: 'bb',
			bridge_config: JSON.stringify({
				node: { relays: ['/dns4/relay.example/p2p/x'], devices: [] }
			})
		};
		const out = withHostedSettings(pairing, {
			secrets: { imap: 'pw', kraken: '{"key":"k","secret":"s"}' },
			config: { mail: { host: 'imap.example.com' }, node: { relays: [] } }
		});
		expect(out.bridge_auth).toBe('aa');
		expect(out.imap).toBe('pw');
		expect(out.kraken).toBe('{"key":"k","secret":"s"}');
		expect(JSON.parse(out.bridge_config)).toEqual({
			mail: { host: 'imap.example.com' },
			node: { relays: ['/dns4/relay.example/p2p/x'], devices: [] }
		});
	});

	it('name the files as the bridge reads them', () => {
		expect(secretFileOf('imap')).toBe('imap');
		expect(secretFileOf('portal:stromwerk-test')).toBe('portal_stromwerk_test');
	});

	it('take a newer value over an older one, and show names only', () => {
		const merged = mergeSettings(
			{ secrets: { imap: 'old', kraken: 'k' }, config: { mail: { host: 'a.example.com' } } },
			{ secrets: { imap: 'new' }, config: { paperless: { url: 'https://p.example.com' } } }
		);
		expect(merged.secrets).toEqual({ imap: 'new', kraken: 'k' });
		expect(keptNames(merged)).toEqual({
			accounts: ['imap', 'kraken'],
			sections: ['mail', 'paperless']
		});
	});
});
