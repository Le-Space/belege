// The member key bundle and the member vault (#610): what a member gets of
// the books, kept under the member's own passkey. Made-up keys and passkeys.
import { describe, expect, it } from 'vitest';

import {
	MEMBERSHIPS_STORAGE_KEY,
	MemberBundleError,
	createMemberVault,
	decodeBundle,
	encodeBundle,
	memberBundle,
	openMemberships
} from './member-vault.js';
import { COLLECTIONS } from '../store/repository.js';

const key = (/** @type {number} */ n) => new Uint8Array(32).fill(n);
const DID_BOOKS = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const DID_WRITER = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';
const address = (/** @type {number} */ i) => `/orbitdb/zdpuA${'abcdefghijk'[i]}${'b'.repeat(45)}`;
const addresses = Object.fromEntries(COLLECTIONS.map((c, i) => [c, address(i)]));
const bundle = () =>
	memberBundle({
		books: { did: DID_BOOKS, identityId: DID_WRITER, label: 'Wolkenfabrik Hosting GmbH' },
		keys: {
			database: key(1),
			replication: key(2),
			blob: key(3),
			deviceAuth: key(4),
			backup: key(5)
		},
		addresses
	});

/** A storage of this browser, in memory. */
function memoryStorage() {
	/** @type {Map<string, string>} */
	const m = new Map();
	return {
		getItem: (/** @type {string} */ k) => m.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, v),
		raw: m
	};
}
const passkey = (/** @type {number} */ n) => ({
	prfOutput: key(100 + n),
	rawCredentialId: new Uint8Array(16).fill(n),
	credentialId: `cred-${n}`,
	label: `Passkey ${n}`
});

describe('the member bundle', () => {
	it('round-trips, and carries the five keys and every collection’s address – nothing else', () => {
		const b = bundle();
		const again = decodeBundle(encodeBundle(b));
		expect(again).toEqual(b);
		expect(Object.keys(again.keys).sort()).toEqual([
			'backup',
			'blob',
			'database',
			'deviceAuth',
			'replication'
		]);
		expect(Object.keys(again.addresses)).toEqual([...COLLECTIONS]);
		const text = encodeBundle(b);
		for (const word of ['root', 'secret', 'vaultKey', 'booksSecret']) {
			expect(text).not.toContain(word);
		}
	});

	it('refuses a key of the wrong size, a missing address, a foreign field, another version', () => {
		expect(() =>
			memberBundle({
				books: bundle().books,
				keys: { ...bundle().keys, backup: new Uint8Array(16) },
				addresses
			})
		).toThrow(MemberBundleError);
		const short = Object.fromEntries(Object.entries(addresses).filter(([c]) => c !== 'travel'));
		expect(() =>
			memberBundle({ books: bundle().books, keys: bundle().keys, addresses: short })
		).toThrow(/address for travel/);
		const parsed = JSON.parse(encodeBundle(bundle()));
		expect(() => decodeBundle(JSON.stringify({ ...parsed, root: 'ab' }))).toThrow(
			/more than it should/
		);
		expect(() => decodeBundle(JSON.stringify({ ...parsed, version: 2 }))).toThrow(/version/);
		expect(() => decodeBundle(JSON.stringify({ ...parsed, books: { did: 'x' } }))).toThrow(/books/);
	});
});

describe('the member vault', () => {
	it('opens with the member’s passkey: the bundle and the member’s own root', async () => {
		const storage = memoryStorage();
		const memberRoot = key(9);
		await createMemberVault({ bundle: bundle(), passkey: passkey(1), storage, memberRoot });
		const [opened, ...more] = await openMemberships({ ...passkey(1), storage });
		expect(more).toEqual([]);
		expect(opened.bundle).toEqual(bundle());
		expect([...opened.memberRoot]).toEqual([...memberRoot]);
		expect(opened.record.books).toEqual({ did: DID_BOOKS, label: 'Wolkenfabrik Hosting GmbH' });
	});

	it('another passkey opens no membership; kept at rest is ciphertext only', async () => {
		const storage = memoryStorage();
		await createMemberVault({ bundle: bundle(), passkey: passkey(1), storage });
		expect(await openMemberships({ ...passkey(2), storage })).toEqual([]);
		const atRest = String(storage.raw.get(MEMBERSHIPS_STORAGE_KEY));
		expect(atRest).not.toContain('01'.repeat(32));
		expect(atRest).not.toContain(addresses.transactions);
	});

	it('the same passkey with a wrong PRF answer opens nothing', async () => {
		const storage = memoryStorage();
		await createMemberVault({ bundle: bundle(), passkey: passkey(1), storage });
		await expect(openMemberships({ ...passkey(1), prfOutput: key(77), storage })).rejects.toThrow();
	});

	it('several memberships side by side, each opened by its own slot', async () => {
		const storage = memoryStorage();
		await createMemberVault({ bundle: bundle(), passkey: passkey(1), storage });
		await createMemberVault({ bundle: bundle(), passkey: passkey(1), storage });
		await createMemberVault({ bundle: bundle(), passkey: passkey(3), storage });
		expect(await openMemberships({ ...passkey(1), storage })).toHaveLength(2);
		expect(await openMemberships({ ...passkey(3), storage })).toHaveLength(1);
	});
});
