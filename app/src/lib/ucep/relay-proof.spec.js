// A relay registration counts only signed by its account and its publisher,
// for what it names. Made-up keys, instances and peer ids.
import { describe, expect, it } from 'vitest';
import { recoverSigner, signedRegistration } from './relay-proof.js';
import { personalSign, signedContent, testKey } from './relay-proof.fixtures.js';

const OWNER = testKey(1);
const PUBLISHER = testKey(2);
const STRANGER = testKey(3);
const INSTANCE = '0'.repeat(64);
const PEER = '12D3KooWAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PEER = '12D3KooWBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ADDR = `/dns4/abandon-abandon-abandon-abandon.2n6.me/tcp/443/tls/ws/p2p/${PEER}`;

const content = (/** @type {Partial<Parameters<typeof signedContent>[0]>} */ over = {}) =>
	signedContent({
		owner: OWNER,
		publisher: PUBLISHER,
		instance: INSTANCE,
		peerId: PEER,
		multiaddrs: [ADDR],
		updatedAt: 1000,
		...over
	});

describe('recoverSigner', () => {
	it('recovers the address that signed, and nothing from a broken signature', () => {
		expect(recoverSigner('hello', personalSign('hello', OWNER.secret))).toBe(OWNER.address);
		expect(recoverSigner('hello!', personalSign('hello', OWNER.secret))).not.toBe(OWNER.address);
		expect(recoverSigner('hello', '0x1234')).toBeNull();
		expect(recoverSigner('hello', undefined)).toBeNull();
	});
});

describe('signedRegistration', () => {
	it('holds for a registration signed by its account and the publisher it authorised', () => {
		expect(signedRegistration(content(), { instance: INSTANCE })).toBe(true);
		expect(
			signedRegistration(content({ instanceItemHash: INSTANCE }), { instance: INSTANCE })
		).toBe(true);
	});

	it('fails without signatures, or signed by someone else', () => {
		const good = content();
		const bare = { ...good, authorization: undefined, relayProof: undefined };
		expect(signedRegistration(bare, { instance: INSTANCE })).toBe(false);
		expect(
			signedRegistration({ ...bare, authorization: good.authorization }, { instance: INSTANCE })
		).toBe(false);
		// Signed by a stranger, but naming the account.
		const forged = content({ owner: STRANGER });
		expect(
			signedRegistration(
				{
					...forged,
					ownerAddress: OWNER.address,
					authorization: {
						...forged.authorization,
						payload: { ...forged.authorization.payload, ownerAddress: OWNER.address }
					}
				},
				{ instance: INSTANCE }
			)
		).toBe(false);
		// The account's own authorisation, with a proof by another publisher.
		const other = content({ publisher: STRANGER });
		expect(
			signedRegistration({ ...content(), relayProof: other.relayProof }, { instance: INSTANCE })
		).toBe(false);
	});

	it('fails when what it names is not what was signed', () => {
		const good = content();
		const check = (/** @type {any} */ c) => signedRegistration(c, { instance: INSTANCE });
		expect(check({ ...good, peerId: OTHER_PEER })).toBe(false);
		expect(check({ ...good, multiaddrs: [ADDR.replace(PEER, OTHER_PEER)] })).toBe(false);
		expect(
			check({ ...good, registrationId: `relay:orbitdb-relay:relay-main:${'f'.repeat(64)}` })
		).toBe(false);
		expect(check({ ...good, updatedAt: 2000 })).toBe(false);
		expect(check({ ...good, ownerAddress: STRANGER.address })).toBe(false);
		// Authorised for another instance.
		expect(
			signedRegistration(content({ instanceItemHash: 'f'.repeat(64) }), { instance: INSTANCE })
		).toBe(false);
	});
});
