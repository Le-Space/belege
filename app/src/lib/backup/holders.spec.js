// "Wer hält es?" (holders.js): the peers announcing a CID, named where they are
// Aleph's core nodes (by IP), placed where ipwho.is says. Against fakes; every
// address, name and place is made up (IPs from the documentation ranges).
import { describe, expect, it } from 'vitest';

import { ALEPH_NODES_ACCOUNT, publicIps, spread, whoHolds } from './holders.js';

const CID_ = 'QmeTPzBhkwP343tMZVSnEH4YigCGXtS4zuZnvgSL7BptZo';
const peers = [
	{
		peerId: 'peer-a',
		addrs: [
			'/ip4/10.0.0.5/tcp/4001',
			'/ip4/203.0.113.7/tcp/4001',
			'/ip4/203.0.113.7/udp/4001/quic-v1'
		]
	},
	{ peerId: 'peer-b', addrs: ['/ip6/2001:db8::1/tcp/4001'] },
	{ peerId: 'peer-c', addrs: ['/ip4/127.0.0.1/tcp/4001'] }
];

/** @param {Record<string, unknown>} answers by URL @returns {typeof fetch} */
const answering = (answers) =>
	/** @type {any} */ (
		async (/** @type {string} */ url) => {
			if (!(url in answers)) return new Response('{}', { status: 404 });
			return new Response(JSON.stringify(answers[url]), { status: 200 });
		}
	);

describe('who holds a backup', () => {
	it('takes only addresses the internet can reach, each once', () => {
		expect(publicIps(peers[0].addrs)).toEqual(['203.0.113.7']);
		expect(publicIps(peers[1].addrs)).toEqual(['2001:db8::1']);
		expect(publicIps(peers[2].addrs)).toEqual([]);
	});

	it('names Aleph’s nodes, places each IP, and counts Aleph’s active nodes', async () => {
		/** @type {string[]} */
		const asked = [];
		const f = answering({
			[`https://aleph.test/api/v0/aggregates/${ALEPH_NODES_ACCOUNT}.json?keys=corechannel`]: {
				data: {
					corechannel: {
						nodes: [
							{
								name: 'Beispielknoten Nord',
								multiaddress: '/ip4/203.0.113.7/tcp/4025/p2p/Qm1',
								status: 'active'
							},
							{
								name: 'Ruhender Knoten',
								multiaddress: '/ip4/198.51.100.9/tcp/4025/p2p/Qm2',
								status: 'waiting'
							},
							{
								name: 'Beispielknoten Süd',
								multiaddress: '/ip4/198.51.100.10/tcp/4025/p2p/Qm3',
								status: 'active'
							}
						]
					}
				}
			},
			'https://geo.test/203.0.113.7': {
				success: true,
				country: 'Finnland',
				country_code: 'FI',
				city: 'Helsinki',
				connection: { org: 'Beispiel Hosting Oy' }
			},
			'https://geo.test/2001%3Adb8%3A%3A1': { success: false, message: 'Reserved range' }
		});
		const result = await whoHolds({
			cid: CID_,
			apiHost: 'https://aleph.test',
			endpoints: { routing: 'https://routing.test', geo: 'https://geo.test' },
			providers: async (cid, { url }) => {
				asked.push(`${url} ${cid}`);
				return peers;
			},
			fetch: f
		});
		expect(asked).toEqual([`https://routing.test ${CID_}`]);
		expect(result.alephActive).toBe(2);
		expect(result.placed).toBe(true);
		expect(result.holders).toEqual([
			{
				peerId: 'peer-a',
				ips: ['203.0.113.7'],
				aleph: 'Beispielknoten Nord',
				place: {
					country: 'Finnland',
					countryCode: 'FI',
					city: 'Helsinki',
					network: 'Beispiel Hosting Oy'
				}
			},
			{ peerId: 'peer-b', ips: ['2001:db8::1'], aleph: null, place: null },
			{ peerId: 'peer-c', ips: [], aleph: null, place: null }
		]);
		expect(spread(result.holders, 'network')).toEqual([{ name: 'Beispiel Hosting Oy', count: 1 }]);
		expect(spread(result.holders, 'country')).toEqual([{ name: 'Finnland', count: 1 }]);
	});

	it('without Aleph’s list or a place: the peers still, unnamed', async () => {
		const result = await whoHolds({
			cid: CID_,
			apiHost: 'https://aleph.test',
			endpoints: { routing: 'https://routing.test', geo: 'https://geo.test' },
			providers: async () => [peers[0]],
			fetch: answering({})
		});
		expect(result.alephActive).toBeNull();
		expect(result.placed).toBe(false);
		expect(result.holders).toEqual([
			{ peerId: 'peer-a', ips: ['203.0.113.7'], aleph: null, place: null }
		]);
	});
});
