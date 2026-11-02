// Which relays the app uses: the trusted wallets' newest registrations on
// Aleph, else the fallback. Made-up wallets, hosts and peer ids.
import { describe, expect, it } from 'vitest';
import {
	FALLBACK_RELAYS,
	TRUSTED_RELAY_OWNERS,
	TRUSTED_RELAY_SENDERS,
	RELAY_REGISTRATION,
	browserDialable,
	ownedInstance,
	ownerRegistrations,
	relayAddrs,
	relaysFromPosts,
	twoN6Host
} from './net.js';

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
		await relayAddrs({ configured: '', fetch });
		expect(asked).toHaveLength(2);
		for (const url of asked) {
			expect(url.searchParams.get('channels')).toBe('simple-todo');
			expect(url.searchParams.get('refs')).toBe('simple-todo-bootstrap');
			expect(url.searchParams.get('types')).toBe('relay-bootstrap-v2');
		}
		expect(asked.map((url) => url.searchParams.get('addresses')?.split(',') ?? null)).toEqual([
			null,
			[...TRUSTED_RELAY_SENDERS]
		]);
	});

	it('puts a relay of a trusted account first, once Aleph confirms its instance', async () => {
		const owner = TRUSTED_RELAY_OWNERS[0];
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
						return new Response(
							JSON.stringify({ posts: [post(TRUSTED_RELAY_SENDERS[0], 1, [wallet])] })
						);
					return new Response(JSON.stringify({ posts: [ownerPost(owner, INSTANCE, 2, [relay])] }));
				}
			);
		expect(await relayAddrs({ configured: '', fetch: fetchWith(owner) })).toEqual([relay, wallet]);
		expect(await relayAddrs({ configured: '', fetch: fetchWith(STRANGER) })).toEqual([wallet]);
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

// A relay registered by a trusted account: made-up instance hashes whose
// 2n6.me names follow from their first 44 bits.
const OWNER = '0x00000000000000000000000000000000000000c1';
const INSTANCE = '0'.repeat(64);
const HOST = 'abandon-abandon-abandon-abandon.2n6.me';
const OTHER_INSTANCE = 'f'.repeat(64);

/** @param {string} owner @param {string} instance @param {number} time @param {string[]} multiaddrs */
const ownerPost = (owner, instance, time, multiaddrs) => ({
	sender: '0x00000000000000000000000000000000000000d1',
	time,
	item_content: JSON.stringify({
		content: {
			registrationId: `relay:orbitdb-relay:relay-main:${instance}`,
			ownerAddress: owner,
			multiaddrs
		}
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
	it('takes a trusted account’s newest registration per instance, on its own 2n6 name only', () => {
		const payload = {
			posts: [
				ownerPost(OWNER, INSTANCE, 100, [`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`]),
				ownerPost(OWNER.toUpperCase().replace('0X', '0x'), INSTANCE, 200, [
					`/dns4/evil.example.com/tcp/443/tls/ws/p2p/${PEER_A}`,
					`/dns6/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`,
					`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_B}`
				]),
				ownerPost(STRANGER, OTHER_INSTANCE, 300, [
					`/dns4/zoo-zoo-zoo-zoo.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`
				])
			]
		};
		expect(ownerRegistrations(payload, [OWNER])).toEqual([
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
		const elsewhere = ownerPost(OWNER, INSTANCE, 100, [
			`/dns4/zoo-zoo-zoo-zoo.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`
		]);
		const noInstance = post(A, 100, [`/dns4/${HOST}/tcp/443/tls/ws/p2p/${PEER_A}`]);
		expect(ownerRegistrations({ posts: [elsewhere, noInstance] }, [OWNER, A])).toEqual([]);
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
