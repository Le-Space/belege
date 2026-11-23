// Which relays the app uses: the trusted wallets' newest registrations on
// Aleph, else the fallback. Made-up wallets, hosts and peer ids.
import { describe, expect, it } from 'vitest';
import {
	FALLBACK_RELAYS,
	TRUSTED_RELAY_SENDERS,
	RELAY_REGISTRATION,
	browserDialable,
	ownedInstance,
	ownerRegistrations,
	relayAddrs,
	relaysFromPosts,
	twoN6Host
} from './net.js';
import { signedContent, testKey } from './relay-proof.fixtures.js';

const A = '0x000000000000000000000000000000000000000a';
const B = '0x000000000000000000000000000000000000000b';
const STRANGER = '0x00000000000000000000000000000000000000ff';
const PEER_A = '12D3KooWAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PEER_B = '12D3KooWBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** @param {string} sender @param {number} time @param {string[]} multiaddrs @param {string} [registrationId] */
const post = (
	sender,
	time,
	multiaddrs,
	registrationId = String(RELAY_REGISTRATION.registrationId)
) => ({
	sender,
	time,
	item_content: JSON.stringify({ content: { registrationId, multiaddrs } })
});

describe('relaysFromPosts', () => {
	const payload = {
		posts: [
			post(A, 100, [`/dns4/old-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`]),
			post(A, 200, [
				`/ip4/10.0.0.1/tcp/9092/ws/p2p/${PEER_A}`,
				`/dns6/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`,
				`/dns4/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`
			]),
			post(B, 150, [`/dns4/b.example.com/tcp/443/tls/ws/p2p/${PEER_B}`]),
			post(STRANGER, 300, [`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_A}`]),
			post(B, 400, [`/dns4/other.example.com/tcp/443/tls/ws/p2p/${PEER_B}`], 'relay:uc-go-peer:x')
		]
	};

	it('takes each trusted wallet’s newest orbitdb-relay registration, one IPv4 name each', () => {
		expect(relaysFromPosts(payload, [A, B.toUpperCase()])).toEqual([
			`/dns4/new-a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`,
			`/dns4/b.example.com/tcp/443/tls/ws/p2p/${PEER_B}`
		]);
	});

	it('ignores a stranger, however new, and anything unreadable', () => {
		expect(relaysFromPosts(payload, [STRANGER, 'nobody'])).toEqual([
			`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_A}`
		]);
		expect(relaysFromPosts(payload, [])).toEqual([]);
		expect(relaysFromPosts({ posts: [{ sender: A, item_content: '{' }] }, [A])).toEqual([]);
		expect(relaysFromPosts(null, [A])).toEqual([]);
	});

	it('takes only what a browser on an https page can dial', () => {
		expect(browserDialable(`/dns4/a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`)).toBe(true);
		expect(browserDialable(`/dns4/a.example.com/tcp/443/wss/p2p/${PEER_A}`)).toBe(true);
		expect(browserDialable(`/dns4/a.example.com/tcp/4002/ws/p2p/${PEER_A}`)).toBe(false);
		expect(browserDialable(`/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${PEER_A}`)).toBe(false);
		expect(browserDialable('/dns4/a.example.com/tcp/443/tls/ws')).toBe(false);
	});
});

describe('relayAddrs', () => {
	it('uses the configured relays first, as the browser specs do', async () => {
		const configured = `/ip4/127.0.0.1/tcp/4492/ws/p2p/${PEER_A}, /ip4/127.0.0.1/tcp/4493/ws/p2p/${PEER_B}`;
		expect(await relayAddrs({ configured, fetch: () => Promise.reject(new Error('no')) })).toEqual([
			`/ip4/127.0.0.1/tcp/4492/ws/p2p/${PEER_A}`,
			`/ip4/127.0.0.1/tcp/4493/ws/p2p/${PEER_B}`
		]);
	});

	it('asks Aleph for the registrations: all of them for the accounts, the trusted wallets’ for the rest', async () => {
		/** @type {URL[]} */
		const asked = [];
		const fetch = /** @type {any} */ (
			async (/** @type {URL} */ url) => {
				asked.push(url);
				return new Response(JSON.stringify({ posts: [] }));
			}
		);
		// Made up: a guest wallet trusted one by one (none is, today).
		const senders = ['0x0000000000000000000000000000000000000001'];
		await relayAddrs({ configured: '', fetch, senders });
		expect(asked).toHaveLength(2);
		for (const url of asked) {
			expect(url.searchParams.get('channels')).toBe('simple-todo');
			expect(url.searchParams.get('refs')).toBe('simple-todo-bootstrap');
			expect(url.searchParams.get('types')).toBe('relay-bootstrap-v2');
		}
		expect(asked.map((url) => url.searchParams.get('addresses')?.split(',') ?? null)).toEqual([
			null,
			senders
		]);
		// No guest wallet trusted: only the accounts are asked.
		asked.length = 0;
		await relayAddrs({ configured: '', fetch });
		expect(TRUSTED_RELAY_SENDERS).toEqual([]);
		expect(asked).toHaveLength(1);
		expect(asked[0].searchParams.get('addresses')).toBeNull();
	});

	it('puts a relay of a trusted account first, once Aleph confirms its instance', async () => {
		const sender = '0x0000000000000000000000000000000000000001';
		const relay = `/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`;
		const wallet = `/dns4/a.example.com/tcp/443/tls/ws/p2p/${PEER_A}`;
		const fetchWith = (/** @type {string} */ instanceOwner) =>
			/** @type {any} */ (
				async (/** @type {URL} */ url) => {
					if (url.pathname.startsWith('/api/v0/messages/'))
						return new Response(
							JSON.stringify({
								status: 'processed',
								message: {
									type: 'INSTANCE',
									item_hash: INSTANCE,
									content: { address: instanceOwner }
								}
							})
						);
					if (url.searchParams.get('addresses'))
						return new Response(JSON.stringify({ posts: [post(sender, 1, [wallet])] }));
					return new Response(
						JSON.stringify({ posts: [ownerPost(OWNER_KEY, INSTANCE, 2, [relay])] })
					);
				}
			);
		const options = { configured: '', senders: [sender], owners: [OWNER] };
		expect(await relayAddrs({ ...options, fetch: fetchWith(OWNER) })).toEqual([
			relay,
			wallet,
			...FALLBACK_RELAYS
		]);
		expect(await relayAddrs({ ...options, fetch: fetchWith(STRANGER) })).toEqual([
			wallet,
			...FALLBACK_RELAYS
		]);
	});

	it('keeps the relays last known after the ones found, once per host', async () => {
		const [first] = FALLBACK_RELAYS;
		const host = first.split('/')[2];
		const found = /** @type {any} */ (
			async (/** @type {URL} */ url) =>
				new Response(
					JSON.stringify({
						posts: url.searchParams.get('addresses')
							? [post(A, 1, [`/dns4/${host}/tcp/443/tls/ws/p2p/${PEER_A}`])]
							: []
					})
				)
		);
		expect(await relayAddrs({ configured: '', fetch: found, senders: [A] })).toEqual([
			`/dns4/${host}/tcp/443/tls/ws/p2p/${PEER_A}`,
			...FALLBACK_RELAYS.slice(1)
		]);
	});

	it('falls back to the relays last known when Aleph cannot be asked or knows none', async () => {
		expect(
			await relayAddrs({ configured: '', fetch: () => Promise.reject(new Error('down')) })
		).toEqual([...FALLBACK_RELAYS]);
		const empty = /** @type {any} */ (async () => new Response(JSON.stringify({ posts: [] })));
		expect(await relayAddrs({ configured: '', fetch: empty })).toEqual([...FALLBACK_RELAYS]);
		const broken = /** @type {any} */ (async () => new Response('nope', { status: 503 }));
		expect(await relayAddrs({ configured: '', fetch: broken })).toEqual([...FALLBACK_RELAYS]);
	});
});

// A relay registered by a trusted account: made-up keys, and instance hashes
// whose 2n6.me names follow from their first 44 bits.
const OWNER_KEY = testKey(1);
const OWNER = OWNER_KEY.address;
const PUBLISHER = testKey(2);
const STRANGER_KEY = testKey(3);
const INSTANCE = '0'.repeat(64);
const HOST = 'abandon-abandon-abandon-abandon.2n6.me';
const OTHER_INSTANCE = 'f'.repeat(64);

/**
 * A registration as the relay posts it, signed by `owner` and the publisher.
 *
 * @param {ReturnType<typeof testKey>} owner @param {string} instance @param {number} time
 * @param {string[]} multiaddrs @param {{ peerId?: string, updatedAt?: number }} [over]
 */
const ownerPost = (owner, instance, time, multiaddrs, over = {}) => ({
	sender: PUBLISHER.address,
	time,
	item_content: JSON.stringify({
		content: signedContent({
			owner,
			publisher: PUBLISHER,
			instance,
			peerId: over.peerId ?? /\/p2p\/([^/]+)$/.exec(multiaddrs[0])?.[1] ?? '',
			multiaddrs,
			updatedAt: over.updatedAt ?? time
		})
	})
});

describe('twoN6Host', () => {
	it('names an instance by its hash’s first 44 bits as four BIP39 words', () => {
		expect(twoN6Host(INSTANCE)).toBe(HOST);
		expect(twoN6Host(OTHER_INSTANCE)).toBe('zoo-zoo-zoo-zoo.2n6.me');
		expect(twoN6Host('00200400801' + '0'.repeat(53))).toBe(
			'ability-ability-ability-ability.2n6.me'
		);
	});
});

describe('ownerRegistrations', () => {
	it('takes a trusted account’s newest signed registration per instance, on its own 2n6 name only', () => {
		const payload = {
			posts: [
				ownerPost(OWNER_KEY, INSTANCE, 100, [`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`]),
				ownerPost(OWNER_KEY, INSTANCE, 200, [
					`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_B}`,
					`/dns6/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`,
					`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`
				]),
				ownerPost(STRANGER_KEY, OTHER_INSTANCE, 300, [
					`/dns4/zoo-zoo-zoo-zoo.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`
				])
			]
		};
		expect(ownerRegistrations(payload, [OWNER.toUpperCase().replace('0X', '0x')])).toEqual([
			{
				instance: INSTANCE,
				owner: OWNER,
				addrs: [
					`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`,
					`/dns6/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`
				]
			}
		]);
	});

	it('drops a registration that points elsewhere or names no instance', () => {
		const elsewhere = ownerPost(OWNER_KEY, INSTANCE, 100, [
			`/dns4/zoo-zoo-zoo-zoo.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`
		]);
		const noInstance = post(A, 100, [`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`]);
		expect(ownerRegistrations({ posts: [elsewhere, noInstance] }, [OWNER, A])).toEqual([]);
	});

	it('takes only what the account signed, newest by the time it was signed', () => {
		const good = ownerPost(OWNER_KEY, INSTANCE, 100, [
			`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`
		]);
		const content = JSON.parse(good.item_content).content;
		/** @param {any} c @param {number} time */
		const as = (c, time) => ({
			sender: STRANGER,
			time,
			item_content: JSON.stringify({ content: c })
		});
		const addr = `/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`;
		// Newer, naming the account, but unsigned or with another peer id than it signed.
		const unsigned = { ...content, authorization: undefined, relayProof: undefined };
		const posts = [
			good,
			as({ ...unsigned, peerId: PEER_B, multiaddrs: [addr] }, 500),
			as({ ...content, peerId: PEER_B, multiaddrs: [addr] }, 600),
			// Signed by a stranger in the account's name.
			ownerPost(STRANGER_KEY, INSTANCE, 700, [addr])
		].map((p, i) =>
			i === 3
				? {
						...p,
						item_content: p.item_content.replaceAll(STRANGER_KEY.address, OWNER)
					}
				: p
		);
		expect(ownerRegistrations({ posts }, [OWNER])).toEqual([
			{ instance: INSTANCE, owner: OWNER, addrs: [`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`] }
		]);
		// An older signed registration posted again later does not win over a newer one.
		const newer = ownerPost(OWNER_KEY, INSTANCE, 200, [addr]);
		expect(ownerRegistrations({ posts: [newer, as(content, 900)] }, [OWNER])).toEqual([
			{ instance: INSTANCE, owner: OWNER, addrs: [addr] }
		]);
	});

	it('dials a found relay on port 443 only', () => {
		const other = ownerPost(OWNER_KEY, INSTANCE, 100, [
			`/dns4/${HOST}/tcp/8443/tls/ws/p2p/${PEER_A}`
		]);
		expect(ownerRegistrations({ posts: [other] }, [OWNER])).toEqual([]);
	});
});

describe('ownedInstance', () => {
	/** @param {any} body @param {number} [status] */
	const answer = (body, status = 200) =>
		/** @type {any} */ (async () => new Response(JSON.stringify(body), { status }));
	const message = (/** @type {Record<string, any>} */ over = {}) => ({
		status: 'processed',
		message: { type: 'INSTANCE', item_hash: INSTANCE, content: { address: OWNER } },
		...over
	});

	it('holds when Aleph has the instance processed and owned by the account', async () => {
		expect(await ownedInstance(INSTANCE, OWNER, answer(message()), 1000)).toBe(true);
	});

	it('fails for another owner, a forgotten instance, another type or no answer', async () => {
		expect(await ownedInstance(INSTANCE, STRANGER, answer(message()), 1000)).toBe(false);
		expect(
			await ownedInstance(INSTANCE, OWNER, answer(message({ status: 'forgotten' })), 1000)
		).toBe(false);
		expect(
			await ownedInstance(
				INSTANCE,
				OWNER,
				answer(
					message({ message: { type: 'POST', item_hash: INSTANCE, content: { address: OWNER } } })
				),
				1000
			)
		).toBe(false);
		expect(await ownedInstance(INSTANCE, OWNER, answer({}, 404), 1000)).toBe(false);
		expect(
			await ownedInstance(
				INSTANCE,
				OWNER,
				/** @type {any} */ (() => Promise.reject(new Error('down'))),
				1000
			)
		).toBe(false);
	});
});
