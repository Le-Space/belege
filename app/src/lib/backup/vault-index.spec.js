// The vault's index on Aleph (#406): addresses derived alike from the same
// secret and apart for passkey and root; the pointer opens only with its root;
// what is published carries no passkey names; an empty device finds the vault
// at its passkey's index and the current one at the books' index. Against an
// in-memory Aleph in a fetch; every byte is made up.
import { describe, expect, it } from 'vitest';

import { alephAddressOf } from './aleph-signer.js';
import {
	findVaultOnAleph,
	openPointer,
	passkeyIndexKey,
	publishVault,
	readRootIndex,
	rootIndexKey,
	sealPointer
} from './vault-index.js';

const bytes = (/** @type {number} */ fill) => new Uint8Array(32).fill(fill);
const endpoints = {
	ingestUrl: 'https://aleph.test/api/v0/add',
	apiHost: 'https://aleph.test',
	gateways: []
};

/** Aleph's aggregates in a fetch: content merged per address and key. */
function fakeAleph() {
	/** @type {Map<string, Record<string, any>>} */
	const kept = new Map();
	/** @type {any[]} */
	const posted = [];
	const reply = (/** @type {number} */ status, /** @type {any} */ body) => ({
		ok: status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body)
	});
	const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
		const u = new URL(url);
		if (u.pathname === '/api/v0/messages' && init?.method === 'POST') {
			const { message } = JSON.parse(init.body);
			posted.push(message);
			const content = JSON.parse(message.item_content);
			kept.set(content.address, {
				...(kept.get(content.address) ?? {}),
				[content.key]: content.content
			});
			return reply(200, { message_status: 'processed' });
		}
		const m = /^\/api\/v0\/aggregates\/(0x[0-9a-fA-F]{40})\.json$/.exec(u.pathname);
		if (m) {
			const value = kept.get(m[1])?.[String(u.searchParams.get('keys'))];
			return value
				? reply(200, { data: { [String(u.searchParams.get('keys'))]: value } })
				: reply(404, {});
		}
		return reply(404, {});
	};
	return { kept, posted, fetch: /** @type {any} */ (fetchImpl) };
}

describe('the vault index', () => {
	it('derives the same address from the same secret, and others for passkey and root', async () => {
		const a = alephAddressOf(await passkeyIndexKey(bytes(1)));
		expect(alephAddressOf(await passkeyIndexKey(bytes(1)))).toBe(a);
		expect(alephAddressOf(await passkeyIndexKey(bytes(2)))).not.toBe(a);
		expect(alephAddressOf(await rootIndexKey(bytes(1)))).not.toBe(a);
	});

	it('the pointer opens with its root only', async () => {
		const sealed = await sealPointer(bytes(1), {
			owner: '0x00000000000000000000000000000000000000aa'
		});
		expect(await openPointer(bytes(1), sealed)).toEqual({
			owner: '0x00000000000000000000000000000000000000aa'
		});
		expect(await openPointer(bytes(2), sealed)).toBeNull();
		expect(await openPointer(bytes(1), null)).toBeNull();
	});

	it('an empty device finds the vault at its passkey’s index, and the current one at the books’', async () => {
		const aleph = fakeAleph();
		const root = bytes(7);
		const prfB = bytes(9);
		const record = {
			vault: { version: 1, id: 'v1', slots: [{ kid: 'kb' }] },
			slots: [
				{
					kid: 'kb',
					label: 'YubiKey im Safe',
					credentialId: 'cred-b',
					addedAt: '2026-10-25T08:00:00Z'
				}
			],
			removed: []
		};
		await publishVault({
			root,
			record,
			passkeyKeys: [await passkeyIndexKey(prfB)],
			owner: '0x00000000000000000000000000000000000000aa',
			endpoints,
			fetch: aleph.fetch
		});
		expect(aleph.posted).toHaveLength(2);
		expect(aleph.posted.every((m) => m.type === 'AGGREGATE' && m.channel === 'BELEGE-VAULT')).toBe(
			true
		);
		// No names on Aleph.
		expect(JSON.stringify(aleph.posted)).not.toContain('YubiKey');

		const found = await findVaultOnAleph({ prfOutput: prfB, endpoints, fetch: aleph.fetch });
		expect(found?.vault).toEqual(record.vault);
		expect(found?.slots).toEqual([
			{ kid: 'kb', label: '', credentialId: 'cred-b', addedAt: '2026-10-25T08:00:00Z' }
		]);
		const current = await readRootIndex({ root, endpoints, fetch: aleph.fetch });
		expect(current?.vault).toEqual(record.vault);
		expect(current?.pointer).toEqual({ owner: '0x00000000000000000000000000000000000000aa' });

		// Another passkey, or another root, finds nothing.
		expect(
			await findVaultOnAleph({ prfOutput: bytes(3), endpoints, fetch: aleph.fetch })
		).toBeNull();
		expect(await readRootIndex({ root: bytes(3), endpoints, fetch: aleph.fetch })).toBeNull();
	});
});
