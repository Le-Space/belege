import { describe, expect, it } from 'vitest';
import {
	cleanSettings,
	isEnclaveLlm,
	keptNames,
	keptView,
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

describe('what the card shows of the kept settings', () => {
	const SECRETS = {
		imap: 'SECRET-imap-password',
		llm: 'SECRET-llm-key',
		kraken: '{"key":"SECRET-kraken-key","secret":"SECRET-kraken-secret"}',
		paperless: 'SECRET-paperless-token',
		enablebanking: 'SECRET-enablebanking-key',
		alchemy: 'SECRET-alchemy-key',
		coingecko: 'SECRET-coingecko-key',
		bitcoin: 'SECRET-zpub'
	};
	const kept = {
		secrets: SECRETS,
		files: { enablebanking_sealed: 'SECRET-sealed-file' },
		config: {
			mail: {
				host: 'imap.example.com',
				port: 993,
				user: 'belege@example.com',
				accountingAddress: 'buchhaltung@example.com',
				password: 'SECRET-stray-password'
			},
			llm: {
				baseUrl: 'https://api.libertai.io/v1',
				model: 'model-a',
				apiKey: 'SECRET-stray-key',
				tee: { provider: 'libertai', itemHash: 'a'.repeat(64), measurement: 'b'.repeat(96) }
			},
			kraken: { configured: true },
			paperless: {
				configured: true,
				baseUrl: 'https://user:SECRET-in-url@paperless.example.com/docs?token=SECRET-query'
			},
			enablebanking: { configured: true, appId: 'SECRET-app-id' }
		}
	};

	it('the non-secret values, by name', () => {
		const view = keptView(kept);
		expect(view.map((e) => e.id)).toEqual([
			'mail',
			'llm',
			'kraken',
			'paperless',
			'enablebanking',
			'alchemy',
			'coingecko',
			'bitcoin'
		]);
		expect(view[0]).toEqual({
			id: 'mail',
			fields: [
				{ key: 'host', value: 'imap.example.com' },
				{ key: 'port', value: '993' },
				{ key: 'user', value: 'belege@example.com' },
				{ key: 'accountingAddress', value: 'buchhaltung@example.com' }
			],
			secret: true
		});
		expect(view[1].fields).toEqual([
			{ key: 'model', value: 'model-a' },
			{ key: 'itemHash', value: 'a'.repeat(64) },
			{ key: 'measurement', value: 'b'.repeat(96) }
		]);
		expect(view[3].fields).toEqual([
			{ key: 'baseUrl', value: 'https://paperless.example.com/docs' }
		]);
		expect(view[2]).toEqual({ id: 'kraken', fields: [], secret: true });
	});

	it('no secret in it: no account’s value, no file, no field that is not named', () => {
		const text = JSON.stringify(keptView(kept));
		expect(text).not.toContain('SECRET');
		for (const value of Object.values(SECRETS)) expect(text).not.toContain(value);
		// Of a secret only whether it is there – a boolean, not its length or a mask.
		for (const entry of keptView(kept)) {
			expect(Object.keys(entry).sort()).toEqual(['fields', 'id', 'secret']);
			expect(typeof entry.secret).toBe('boolean');
		}
	});

	it('a section without its secret says so, and nothing kept shows nothing', () => {
		expect(
			keptView({ config: { mail: { host: 'imap.example.com' } }, secrets: {}, files: {} })
		).toEqual([
			{ id: 'mail', fields: [{ key: 'host', value: 'imap.example.com' }], secret: false }
		]);
		expect(keptView({ config: {}, secrets: {}, files: {} })).toEqual([]);
	});
});
