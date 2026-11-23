// How devices meet is the owner's to set: the network mode and the own
// network's relay are taken as the books themselves wrote them, never as a
// member did, however new. Made-up identities, addresses and peer ids.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/bridge-connection/record.js', () => ({ readBridgeRecord: async () => null }));
vi.mock('$lib/bridge-connection/paired-client.js', () => ({ pairedClient: async () => null }));

import { settingWrittenBy } from '$lib/store/settings.js';
import {
	LAN_RELAY_KEY,
	LAN_RELAY_SETTING,
	NETWORK_MODE_KEY,
	NETWORK_MODE_SETTING
} from '$lib/sync/network-mode.js';
import { applyStoredMode, bindSession } from './network.js';

const BOOKS = 'did:key:z6MkBooks';
const MEMBER = 'did:key:z6MkMember';
const relay = (/** @type {string} */ host, /** @type {string} */ c) =>
	`/ip4/${host}/udp/40000/webrtc-direct/certhash/u${'A'.repeat(43)}/p2p/12D3KooW${c.repeat(44)}`;
const OWN_RELAY = relay('192.168.0.2', 'a');
const MEMBERS_RELAY = relay('192.168.0.66', 'b');

/** @param {{ writer: string, key: string, value: any }[]} entries newest first */
const settingsLog = (entries) => ({
	log: {
		async *iterator() {
			for (const e of entries) {
				yield { writer: e.writer, payload: { op: 'PUT', value: { key: e.key, value: e.value } } };
			}
		}
	},
	access: { writerOf: async (/** @type {any} */ entry) => entry.writer }
});

/** @type {Map<string, string>} */
let stored;

beforeEach(() => {
	stored = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (/** @type {string} */ k) => stored.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void stored.set(k, v),
		removeItem: (/** @type {string} */ k) => void stored.delete(k)
	});
});
afterEach(() => vi.unstubAllGlobals());

/** @param {{ writer: string, key: string, value: any }[]} entries */
function open(entries) {
	const db = settingsLog(entries);
	const app = { network: { modeWanted: null, lanRelay: null } };
	bindSession(
		/** @type {any} */ ({
			session: {
				booksSetting: (/** @type {string} */ key) => settingWrittenBy(db, key, BOOKS),
				// The collection as it lists them: every writer's, the newest last written first.
				store: {
					settings: {
						list: async ({ where = () => true } = {}) =>
							entries
								.map((e, i) => ({ key: e.key, value: e.value, updatedAt: `2026-01-0${9 - i}` }))
								.filter(where)
					}
				}
			},
			app,
			readOnly: () => false,
			filePrefetch: null
		})
	);
	return app;
}

describe('where devices meet, as the books set it', () => {
	it('takes the mode and the relay the books wrote; a member’s newer ones are passed over', async () => {
		const app = open([
			{ writer: MEMBER, key: NETWORK_MODE_SETTING, value: { mode: 'public' } },
			{ writer: MEMBER, key: LAN_RELAY_SETTING, value: { addr: MEMBERS_RELAY } },
			{ writer: BOOKS, key: NETWORK_MODE_SETTING, value: { mode: 'lan' } },
			{ writer: BOOKS, key: LAN_RELAY_SETTING, value: { addr: OWN_RELAY } }
		]);
		await applyStoredMode();
		expect(stored.get(NETWORK_MODE_KEY)).toBe('lan');
		expect(app.network.modeWanted).toBe('lan');
		expect(stored.get(LAN_RELAY_KEY)).toBe(OWN_RELAY);
		expect(app.network.lanRelay).toBe(OWN_RELAY);
	});

	it('changes nothing when only a member set them', async () => {
		stored.set(NETWORK_MODE_KEY, 'qr');
		const app = open([
			{ writer: MEMBER, key: NETWORK_MODE_SETTING, value: { mode: 'both' } },
			{ writer: MEMBER, key: LAN_RELAY_SETTING, value: { addr: MEMBERS_RELAY } }
		]);
		await applyStoredMode();
		expect(stored.get(NETWORK_MODE_KEY)).toBe('qr');
		expect(app.network.modeWanted).toBeNull();
		expect(stored.has(LAN_RELAY_KEY)).toBe(false);
		expect(app.network.lanRelay).toBeNull();
	});
});
