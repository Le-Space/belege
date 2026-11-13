import { describe, expect, it } from 'vitest';
import {
	cleanSettings,
	isEnclaveLlm,
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
			secrets: { imap: 'pw', kraken: '{"key":"k","secret":"s"}', enablebanking: 'aa' },
			files: { enablebanking_sealed: 'sealed-text', other: 'no' },
			config: { mail: { host: 'imap.example.com' }, node: { relays: [] } }
		});
		expect(out.bridge_auth).toBe('aa');
		expect(out.imap).toBe('pw');
		expect(out.kraken).toBe('{"key":"k","secret":"s"}');
		// Enable Banking's sealed file goes as it is, beside its key.
		expect(out.enablebanking).toBe('aa');
		expect(out.enablebanking_sealed).toBe('sealed-text');
		expect(out.other).toBeUndefined();
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
			{
				secrets: { imap: 'old', kraken: 'k' },
				config: { mail: { host: 'a.example.com' } },
				files: {}
			},
			{
				secrets: { imap: 'new' },
				config: { paperless: { url: 'https://p.example.com' } },
				files: {}
			}
		);
		expect(merged.secrets).toEqual({ imap: 'new', kraken: 'k' });
		expect(keptNames(merged)).toEqual({
			accounts: ['imap', 'kraken'],
			sections: ['mail', 'paperless']
		});
	});

	it('take a model only in LibertAI’s attested enclave, and its key only beside it', () => {
		const pinned = {
			baseUrl: 'https://api.libertai.io/v1',
			model: 'test-model-tee',
			tee: { provider: 'libertai', itemHash: 'ab'.repeat(32), measurement: 'cd'.repeat(48) }
		};
		expect(isEnclaveLlm(pinned)).toBe(true);
		const kept = cleanSettings({ config: { llm: pinned }, secrets: { llm: 'key' } });
		expect(kept.config.llm).toEqual(pinned);
		expect(kept.secrets.llm).toBe('key');
		const out = withHostedSettings({}, kept);
		expect(out.llm).toBe('key');
		expect(JSON.parse(out.bridge_config).llm.tee.provider).toBe('libertai');
		for (const llm of [
			{ ...pinned, tee: null },
			{ ...pinned, baseUrl: 'https://api.deepseek.com' },
			{ ...pinned, tee: { ...pinned.tee, itemHash: 'nope' } }
		]) {
			expect(isEnclaveLlm(llm)).toBe(false);
			const dropped = cleanSettings({ config: { llm }, secrets: { llm: 'key' } });
			expect(dropped.config.llm).toBeUndefined();
			expect(dropped.secrets.llm).toBeUndefined();
		}
	});
});
