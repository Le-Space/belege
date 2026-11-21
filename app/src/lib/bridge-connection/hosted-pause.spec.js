// "Alles pausieren" and the hosted bridge: while the network is paused, no
// function of hosted-aleph.js or hosted-near.js that dials asks anybody – the
// card does not offer it, and a caller that goes around the card is refused.
// Stopping is the exception: a VM costs while it runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '$lib/i18n/index.js';
import { setNetworkPause } from '$lib/network-pause.js';
import { fetchStartStatus } from '$lib/integrations/hosted-start.js';
import { unlockVerdict } from '$lib/integrations/hosted-unlock.js';
import * as aleph from './hosted-aleph.js';
import * as near from './hosted-near.js';

const VM = 'a'.repeat(64);
const CRN = 'e'.repeat(64);

/** A session that went online at unlock, on the owner's device; its store is never reached while paused. */
const context = /** @type {any} */ ({
	session: {
		online: true,
		store: { settings: {} },
		bridgeAuthBase: new Uint8Array(32),
		imageBase: new Uint8Array(32),
		relays: [],
		peerId: 'peer'
	},
	app: { member: false },
	deviceSync: {},
	bridgeConsumer: {},
	keptHostedSettings: async () => ({})
});

/** @type {Map<string, string>} */
let kept;
/** @type {ReturnType<typeof vi.fn>} */
let asked;

beforeEach(() => {
	kept = new Map();
	/** @type {any} */ (globalThis).localStorage = {
		getItem: (/** @type {string} */ k) => kept.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => kept.delete(k)
	};
	asked = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', asked);
	aleph.bindSession(context);
	near.bindSession(context);
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete (/** @type {any} */ (globalThis).localStorage);
});

/** Every function that dials and says so when it may not. @type {Array<[string, () => Promise<unknown>]>} */
const REFUSING = [
	['hostedNodes', () => aleph.hostedNodes()],
	['hostedCredits', () => aleph.hostedCredits()],
	['hostedInstances', () => aleph.hostedInstances()],
	['chooseHostedPlan', () => aleph.chooseHostedPlan('bridge-s')],
	['startHostedBridge', () => aleph.startHostedBridge({ crn: CRN, passphrase: 'made-up' })],
	['continueHostedStart', () => aleph.continueHostedStart({ passphrase: 'made-up' })],
	['unlockHostedBridge', () => aleph.unlockHostedBridge({ instance: VM, passphrase: 'made-up' })],
	['buildHostedImage', () => aleph.buildHostedImage()],
	['startNearHostedBridge', () => near.startNearHostedBridge()]
];

/** The ones a card asks by itself: quiet, with nothing to show. @type {Array<[string, () => Promise<unknown>, unknown]>} */
const QUIET = [
	['forgetLeftHostedBuilder', () => aleph.forgetLeftHostedBuilder(), undefined],
	['hostedBuildReserve', () => aleph.hostedBuildReserve(), null],
	['nearBridgeStatus', () => near.nearBridgeStatus(), null],
	['fetchStartStatus', () => fetchStartStatus(VM, { fetch: /** @type {any} */ (asked) }), null]
];

describe('the hosted bridge while the network is paused', () => {
	beforeEach(() => setNetworkPause({ ucep: false }));

	it.each(REFUSING)('%s refuses and asks nobody', async (_name, call) => {
		await expect(call()).rejects.toThrow(t('messages.hostedBridge.paused'));
		expect(asked).not.toHaveBeenCalled();
	});

	it.each(QUIET)('%s asks nobody and has nothing to say', async (_name, call, nothing) => {
		expect(await call()).toBe(nothing);
		expect(asked).not.toHaveBeenCalled();
	});

	// A VM costs while it runs: stopping is the one thing the pause does not hold back.
	it.each(
		/** @type {Array<[string, () => Promise<unknown>]>} */ ([
			['stopHostedBridge', () => aleph.stopHostedBridge()],
			['stopHostedInstance', () => aleph.stopHostedInstance(VM)],
			['stopNearHostedBridge', () => near.stopNearHostedBridge()]
		])
	)('%s is not refused for the pause', async (_name, call) => {
		// These made-up books have nothing to stop: what it says is not the pause.
		const said = await call().then(
			() => '',
			(/** @type {any} */ e) => String(e?.message ?? e)
		);
		expect(said).not.toBe(t('messages.hostedBridge.paused'));
	});

	it('ends the waiting for a VM that boots: trying again is no use', async () => {
		const error = await aleph
			.unlockHostedBridge({ instance: VM, passphrase: 'made-up' })
			.catch((/** @type {unknown} */ e) => e);
		expect(unlockVerdict(error)).toBe('stop');
	});
});

describe('the hosted bridge once the network is resumed', () => {
	it('asks again: the node list is fetched', async () => {
		setNetworkPause({ ucep: false });
		setNetworkPause(null);
		await aleph.hostedNodes().catch(() => []);
		expect(asked).toHaveBeenCalled();
	});
});
