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
	publishIndex,
	publishVault,
	readIndex,
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

/**
 * Aleph as it was met live (paperless-anywhere, 2026-10-23): the synchronous
 * broadcast that never answers although the message is processed, the one
 * that never arrived, and `pending` before it decides.
 *
 * @param {'hang' | 'lost' | 'pending' | 'rejected'} mode
 */
function moodyAleph(mode) {
	const aleph = fakeAleph();
	/** @type {Map<string, string>} status by item hash */
	const status = new Map();
	let lostOnce = mode === 'lost';
	const reply = (/** @type {number} */ code, /** @type {any} */ body) => ({
		ok: code < 300,
		status: code,
		json: async () => body,
		text: async () => JSON.stringify(body)
	});
	const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
		const u = new URL(url);
		if (u.pathname === '/api/v0/messages' && init?.method === 'POST') {
			const { message, sync } = JSON.parse(init.body);
			if (lostOnce) {
				lostOnce = false;
				throw new TypeError('Failed to fetch');
			}
			await aleph.fetch(url, init);
			const hash = message.item_hash;
			if (mode === 'rejected') {
				status.set(hash, 'rejected');
				return reply(202, { message_status: 'pending' });
			}
			status.set(hash, mode === 'pending' ? 'pending' : 'processed');
			if (mode === 'hang' && sync) {
				// Processed, but the answer never comes: until the caller gives up.
				return new Promise((_, reject) =>
					init.signal?.addEventListener('abort', () => reject(init.signal.reason))
				);
			}
			return reply(sync && mode !== 'pending' ? 200 : 202, {
				message_status: status.get(hash)
			});
		}
		const m = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(u.pathname);
		if (m) {
			const now = status.get(m[1]);
			if (!now) return reply(404, {});
			// Pending decides on the next look.
			if (now === 'pending') status.set(m[1], 'processed');
			return reply(200, { status: now });
		}
		return aleph.fetch(url, init);
	};
	return { ...aleph, status, fetch: /** @type {any} */ (fetchImpl) };
}

describe('publishing the index waits until Aleph has it', () => {
	const patience = { answerMs: 50, pollMs: 5, waitMs: 2_000 };
	const content = { vault: { version: 1, id: 'v1', slots: [] }, slots: [] };

	it('an answer that never comes: asked for its status instead', async () => {
		const aleph = moodyAleph('hang');
		const key = await rootIndexKey(bytes(4));
		const { itemHash } = await publishIndex({
			key,
			content,
			endpoints,
			fetch: aleph.fetch,
			patience
		});
		expect(aleph.status.get(itemHash)).toBe('processed');
		expect(await readIndex({ key, endpoints, fetch: aleph.fetch })).toEqual(content);
	});

	it('a broadcast that never arrived: sent again', async () => {
		const aleph = moodyAleph('lost');
		const key = await rootIndexKey(bytes(5));
		await publishIndex({ key, content, endpoints, fetch: aleph.fetch, patience });
		expect(aleph.posted).toHaveLength(1);
		expect(await readIndex({ key, endpoints, fetch: aleph.fetch })).toEqual(content);
	});

	it('pending: waits for processed', async () => {
		const aleph = moodyAleph('pending');
		const key = await rootIndexKey(bytes(6));
		const { itemHash } = await publishIndex({
			key,
			content,
			endpoints,
			fetch: aleph.fetch,
			patience
		});
		expect(aleph.status.get(itemHash)).toBe('processed');
	});

	it('pending, then rejected: an error, not a success', async () => {
		const aleph = moodyAleph('rejected');
		const key = await rootIndexKey(bytes(8));
		await expect(
			publishIndex({ key, content, endpoints, fetch: aleph.fetch, patience })
		).rejects.toThrow(/refused the vault index: rejected/);
	});
});
