// A hosted VM Aleph has forgotten while the books still record it as running
// (#1036): stopping it sends no second FORGET, a refused one ends the same
// way, and the card's check on load records it as stopped at the FORGET's
// time. A mocked Aleph; every hash and address is made up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setNetworkPause } from '$lib/network-pause.js';
import { VM_SETTING, usage } from '$lib/integrations/hosted-vm.js';
import * as aleph from './hosted-aleph.js';

const API = 'https://api.example.com';
const OWNER = '0x' + '1'.repeat(40);
const VM = 'a'.repeat(64);
const OTHER_VM = 'b'.repeat(64);
const FORGET = 'f'.repeat(64);
const CRN = 'e'.repeat(64);
/** The FORGET from another device, a day after the start. */
const FORGOTTEN_AT = Date.parse('2026-01-02T10:00:00.000Z') / 1000;
const STARTED = '2026-01-01T10:00:00.000Z';

/** @type {Map<string, any>} */
const settings = new Map();
vi.mock('$lib/store/settings.js', () => ({
	getSetting: async (/** @type {any} */ _db, /** @type {string} */ key) =>
		settings.get(key) ?? null,
	setSetting: async (/** @type {any} */ _db, /** @type {string} */ key, /** @type {any} */ v) => {
		settings.set(key, v);
	}
}));
vi.mock('$lib/backup/keeper.js', () => ({
	alephEndpoints: () => ({ apiHost: API }),
	ensureBackupKey: async () => new Uint8Array(32).fill(7)
}));
vi.mock('$lib/backup/aleph-signer.js', () => ({
	alephAddressOf: () => OWNER,
	alephSign: async () => '0x' + '0'.repeat(130)
}));

/** What the mocked Aleph says of each message, and what it does with a POST. */
/** @type {Record<string, any>} */
let said;
/** @type {(message: any) => { status: number, body: any }} */
let onPost;
/** @type {Array<{ method: string, url: string, body?: any }>} */
let asked;
const removeDevice = vi.fn(async () => {});

const context = /** @type {any} */ ({
	session: { online: true, store: { settings: {} }, relays: [], peerId: 'peer' },
	app: { member: false },
	deviceSync: { removeDevice },
	bridgeConsumer: {},
	keptHostedSettings: async () => ({})
});

const json = (/** @type {number} */ status, /** @type {any} */ body) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	settings.clear();
	settings.set(VM_SETTING, {
		instance: VM,
		crn: CRN,
		nodeUrl: 'https://node.example.com',
		payer: OWNER,
		paidBy: 'books',
		startedAt: STARTED,
		creditsPerHour: 100
	});
	settings.set('bridge/hosted', {
		instance: VM,
		host: 'vm.example.com',
		peerId: 'bridge-peer',
		measurement: '11'.repeat(48),
		attestedAt: STARTED
	});
	said = {};
	onPost = () => json(200, { message_status: 'processed' });
	asked = [];
	removeDevice.mockClear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
			const method = init.method ?? 'GET';
			const body = init.body ? JSON.parse(init.body) : undefined;
			asked.push({ method, url, body });
			if (method === 'POST' && url === `${API}/api/v0/messages`) {
				const { status, body: answer } = onPost(body.message);
				return json(status, answer);
			}
			const hash = /\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(url)?.[1];
			if (method === 'GET' && hash) {
				const s = typeof said[hash] === 'function' ? said[hash]() : said[hash];
				return s ? json(200, s) : json(404, { error: 'not found' });
			}
			return json(404, {});
		})
	);
	aleph.bindSession(context);
	setNetworkPause(null);
});
afterEach(() => {
	vi.unstubAllGlobals();
	setNetworkPause(null);
});

const forgottenVm = () => ({ status: 'forgotten', item_hash: VM, forgotten_by: [FORGET] });
const forgetMessage = {
	status: 'processed',
	item_hash: FORGET,
	message: { type: 'FORGET', item_hash: FORGET, time: FORGOTTEN_AT }
};
const posts = () => asked.filter((a) => a.method === 'POST');

describe('stopping a VM Aleph has forgotten already', () => {
	it('sends no FORGET and records the stop at the FORGET’s time', async () => {
		said[VM] = forgottenVm();
		said[FORGET] = forgetMessage;
		const done = await aleph.stopHostedBridge();
		expect(done).toEqual({ stoppedAt: new Date(FORGOTTEN_AT * 1000).toISOString(), already: true });
		expect(posts()).toEqual([]);
		expect(settings.get(VM_SETTING).stoppedAt).toBe(done.stoppedAt);
		expect(removeDevice).toHaveBeenCalledWith('bridge-peer');
		// A second "Stoppen" has nothing to stop.
		await expect(aleph.stopHostedBridge()).rejects.toThrow();
	});

	it('also for a VM of the list that these books did not record', async () => {
		said[OTHER_VM] = { ...forgottenVm(), item_hash: OTHER_VM };
		said[FORGET] = forgetMessage;
		const done = await aleph.stopHostedInstance(OTHER_VM);
		expect(done.already).toBe(true);
		expect(posts()).toEqual([]);
	});

	it('sends the FORGET for one Aleph still holds', async () => {
		said[VM] = { status: 'processed', item_hash: VM, message: { type: 'INSTANCE' } };
		const done = await aleph.stopHostedBridge();
		expect(done.already).toBe(false);
		expect(posts()).toHaveLength(1);
		expect(posts()[0].body.message.type).toBe('FORGET');
		expect(settings.get(VM_SETTING).stoppedAt).toBe(done.stoppedAt);
	});
});

describe('a FORGET Aleph refuses', () => {
	it('because the VM is forgotten meanwhile: stopped all the same, at the FORGET’s time', async () => {
		let forgotten = false;
		said[VM] = () =>
			forgotten ? forgottenVm() : { status: 'processed', item_hash: VM, message: {} };
		said[FORGET] = forgetMessage;
		onPost = () => {
			// Another device's FORGET got there first.
			forgotten = true;
			return json(200, { message_status: 'rejected' });
		};
		const done = await aleph.stopHostedBridge();
		expect(posts()).toHaveLength(1);
		expect(done).toEqual({ stoppedAt: new Date(FORGOTTEN_AT * 1000).toISOString(), already: true });
		expect(settings.get(VM_SETTING).stoppedAt).toBe(done.stoppedAt);
	});

	it('for another reason: the error stands and the VM stays recorded as running', async () => {
		said[VM] = { status: 'processed', item_hash: VM, message: {} };
		onPost = () => json(200, { message_status: 'rejected' });
		await expect(aleph.stopHostedBridge()).rejects.toThrow(/refused the FORGET/);
		expect(settings.get(VM_SETTING).stoppedAt).toBeUndefined();
	});
});

describe('the card’s check on load', () => {
	it('records a VM Aleph has forgotten as stopped, and its bridge leaves the devices', async () => {
		said[VM] = forgottenVm();
		said[FORGET] = forgetMessage;
		const r = await aleph.reconcileHostedVm();
		expect(r.state).toBe('forgotten');
		const at = new Date(FORGOTTEN_AT * 1000).toISOString();
		expect(r.record.stoppedAt).toBe(at);
		expect(settings.get(VM_SETTING).stoppedAt).toBe(at);
		expect(removeDevice).toHaveBeenCalledWith('bridge-peer');
		expect(posts()).toEqual([]);
		// Runtime and credits from the start to the FORGET, not to now: a day.
		const used = usage(r.record, Date.parse(r.record.stoppedAt));
		expect(used).toEqual({ hours: 24, credits: 2400 });
	});

	it('leaves a VM Aleph holds as it is: one question', async () => {
		said[VM] = { status: 'processed', item_hash: VM, message: {} };
		const r = await aleph.reconcileHostedVm();
		expect(r.state).toBe('running');
		expect(settings.get(VM_SETTING).stoppedAt).toBeUndefined();
		expect(asked).toHaveLength(1);
	});

	it('says when Aleph does not answer, and changes nothing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		const r = await aleph.reconcileHostedVm();
		expect(r.state).toBe('unreachable');
		expect(settings.get(VM_SETTING).stoppedAt).toBeUndefined();
	});

	it('asks nobody while the network is paused', async () => {
		setNetworkPause({ ucep: false });
		const r = await aleph.reconcileHostedVm();
		expect(r.state).toBe('unasked');
		expect(asked).toEqual([]);
	});

	it('asks nothing for a VM recorded as stopped', async () => {
		settings.set(VM_SETTING, { ...settings.get(VM_SETTING), stoppedAt: STARTED });
		expect((await aleph.reconcileHostedVm()).state).toBe('stopped');
		expect(asked).toEqual([]);
	});
});
