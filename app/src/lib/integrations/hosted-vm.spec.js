// Starting and stopping the hosted bridge's VM (#587) against the fake Aleph
// (@belege/bridge/testing/aleph), which judges the messages as Aleph does: the
// signature, the owner, a day of credits. Made-up key, node and image.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Loaded by name, so the app's type check stays out of the bridge's sources.
const FAKE_ALEPH = '@belege/bridge/testing/aleph';
const { FAKE_CRN, FAKE_INSTANCE_CREDITS_PER_HOUR, FAKE_MAPPED_443, startFakeAleph } =
	/** @type {any} */ (await import(/* @vite-ignore */ FAKE_ALEPH));

import { alephAddressOf, alephSign } from '../backup/aleph-signer.js';
import { newAlephKey } from '../backup/aleph-key.js';
import { fetchInstance, HOSTED_IMAGE } from './hosted-bridge.js';
import {
	confidentialNodes,
	creditsOf,
	creditsPerHour,
	forgetContent,
	forward443Content,
	instanceContent,
	listInstances,
	loadNodes,
	nodeUrlOf,
	notifyNode,
	onNode,
	sendMessage,
	signedMessage,
	usage
} from './hosted-vm.js';

const key = newAlephKey();
const owner = alephAddressOf(key);
const sign = (/** @type {string} */ payload) => alephSign(key, payload);
const pins = {
	mode: 'sev_snp',
	policy: 0x30000,
	measurements: [{ platform: 'sev_snp', registers: { launch: '11'.repeat(48) } }]
};
const patience = { answerMs: 5_000, pollMs: 50, waitMs: 2_000 };

/** @type {any} */
let aleph;
beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {} });
});
afterAll(() => aleph?.close());

describe('the node list', () => {
	it('takes only https names, and 127.0.0.1 when a test says so', () => {
		expect(nodeUrlOf('https://crn.example.com/')).toBe('https://crn.example.com');
		expect(nodeUrlOf('https://crn.example.com/path')).toBeNull();
		expect(nodeUrlOf('http://crn.example.com')).toBeNull();
		expect(nodeUrlOf('https://192.0.2.1')).toBeNull();
		expect(nodeUrlOf('https://user:x@crn.example.com')).toBeNull();
		expect(nodeUrlOf('http://127.0.0.1:1234')).toBeNull();
		expect(nodeUrlOf('http://127.0.0.1:1234', { loopback: true })).toBe('http://127.0.0.1:1234');
	});

	it('keeps confidential nodes with room, best first', () => {
		const room = {
			active: true,
			cpu: { count: 8, load_average: { load1: 1 } },
			mem: { available_kB: 4e6 },
			disk: { available_kB: 5e7 }
		};
		const nodes = confidentialNodes({
			crns: [
				{
					hash: 'a'.repeat(64),
					address: 'https://a.example.com',
					confidential_support: false,
					system_usage: room
				},
				{
					hash: 'b'.repeat(64),
					address: 'https://b.example.com',
					confidential_support: true,
					score: 0.5,
					system_usage: room
				},
				{
					hash: 'c'.repeat(64),
					address: 'https://c.example.com',
					confidential_support: true,
					score: 0.9,
					system_usage: { ...room, mem: { available_kB: 1 } }
				},
				{
					hash: 'd'.repeat(64),
					address: 'https://d.example.com',
					confidential_support: true,
					score: 0.7,
					system_usage: room
				},
				{
					hash: 'e'.repeat(64),
					address: 'http://e.example.com',
					confidential_support: true,
					system_usage: room
				}
			]
		});
		expect(nodes.map((n) => [n.hash[0], n.fits])).toEqual([
			['d', true],
			['b', true],
			['c', false]
		]);
	});
});

describe('a VM of the books’ key', () => {
	it('is refused without a day of credits, then started, placed, forwarded and forgotten', async () => {
		const endpoints = { apiHost: aleph.url };
		const [node] = await loadNodes({ url: `${aleph.url}/crns.json`, loopback: true });
		expect(node.hash).toBe(FAKE_CRN);

		const content = instanceContent({
			payer: owner,
			image: HOSTED_IMAGE,
			crn: node.hash,
			trustedExecution: pins,
			name: 'belege-bridge-test'
		});
		const poor = await signedMessage({ type: 'INSTANCE', content, sign });
		expect(await creditsPerHour(poor, endpoints)).toBe(FAKE_INSTANCE_CREDITS_PER_HOUR);
		expect(await creditsOf(owner, endpoints)).toBe(0);
		await expect(sendMessage(poor, { ...endpoints, ...patience })).rejects.toThrow(
			/too few credits/
		);

		aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
		const message = await signedMessage({
			type: 'INSTANCE',
			content: { ...content, time: content.time + 1 },
			sign
		});
		const hash = await sendMessage(message, { ...endpoints, ...patience });
		const held = await fetchInstance(hash, endpoints);
		expect(held.content.address).toBe(owner);
		expect(held.content.rootfs.parent.ref).toBe(HOSTED_IMAGE);
		expect(held.crn).toBe(FAKE_CRN);
		// Listed among the key's VMs, with its node; another key's list does not hold it.
		const listed = (await listInstances(owner, endpoints)).find((i) => i.hash === hash);
		expect(listed).toMatchObject({ crn: FAKE_CRN, payer: owner });
		expect(Date.parse(String(listed?.createdAt))).toBeGreaterThan(0);
		const stranger = alephAddressOf(newAlephKey());
		expect((await listInstances(stranger, endpoints)).map((i) => i.hash)).not.toContain(hash);

		expect(await onNode(node.url, hash)).toBeNull();
		await notifyNode(node.url, hash, { delayMs: 10 });
		expect(await onNode(node.url, hash)).toEqual({ running: true, port443: null });
		await sendMessage(
			await signedMessage({ type: 'AGGREGATE', content: forward443Content(owner, hash), sign }),
			{ ...endpoints, ...patience }
		);
		expect(await onNode(node.url, hash)).toEqual({ running: true, port443: FAKE_MAPPED_443 });

		await sendMessage(
			await signedMessage({ type: 'FORGET', content: forgetContent(owner, hash), sign }),
			{ ...endpoints, ...patience }
		);
		expect(aleph.instances.get(hash)?.status).toBe('forgotten');
		expect(await onNode(node.url, hash)).toBeNull();
		await expect(fetchInstance(hash, endpoints)).rejects.toThrow(/no running INSTANCE/);
		// Forgotten: Aleph no longer lists it.
		expect((await listInstances(owner, endpoints)).map((i) => i.hash)).not.toContain(hash);
	});

	it('cannot be forgotten by another key', async () => {
		const other = newAlephKey();
		aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
		const hash = await sendMessage(
			await signedMessage({
				type: 'INSTANCE',
				content: instanceContent({
					payer: owner,
					image: HOSTED_IMAGE,
					crn: FAKE_CRN,
					trustedExecution: pins,
					name: 'belege-bridge-test-2'
				}),
				sign
			}),
			{ apiHost: aleph.url, ...patience }
		);
		const forget = await signedMessage({
			type: 'FORGET',
			content: forgetContent(alephAddressOf(other), hash),
			sign: (p) => alephSign(other, p)
		});
		await expect(sendMessage(forget, { apiHost: aleph.url, ...patience })).rejects.toThrow(
			/refused/
		);
		expect(aleph.instances.get(hash)?.status).toBe('processed');
	});

	it('is paid by Le Space’s sub-account once it lets the books’ key act for it', async () => {
		const sub = alephAddressOf(newAlephKey());
		aleph.fund(sub, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
		const endpoints = { apiHost: aleph.url, ...patience };
		const content = instanceContent({
			payer: sub,
			image: HOSTED_IMAGE,
			crn: FAKE_CRN,
			trustedExecution: pins,
			name: 'belege-bridge-lespace'
		});
		expect(content.address).toBe(sub);
		const send = async (/** @type {any} */ type, /** @type {any} */ c) =>
			sendMessage(await signedMessage({ type, content: c, sign, sender: owner }), endpoints);

		// Not yet authorized: Aleph refuses the books' key sending for the sub-account.
		await expect(send('INSTANCE', content)).rejects.toThrow(/refused/);

		aleph.authorize(sub, owner, ['INSTANCE', 'FORGET', 'AGGREGATE'], ['port-forwarding']);
		const hash = await send('INSTANCE', { ...content, time: content.time + 1 });
		const held = aleph.instances.get(hash);
		expect(held.sender).toBe(owner);
		expect(held.address).toBe(sub);

		await notifyNode(aleph.url, hash, { delayMs: 10 });
		await send('AGGREGATE', forward443Content(sub, hash));
		expect(await onNode(aleph.url, hash)).toEqual({ running: true, port443: FAKE_MAPPED_443 });

		await send('FORGET', forgetContent(sub, hash));
		expect(aleph.instances.get(hash)?.status).toBe('forgotten');
	});

	it('says when the node gave up bringing it up', async () => {
		aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
		aleph.failStarts(true);
		try {
			const hash = await sendMessage(
				await signedMessage({
					type: 'INSTANCE',
					content: instanceContent({
						payer: owner,
						image: HOSTED_IMAGE,
						crn: FAKE_CRN,
						trustedExecution: pins,
						name: 'belege-bridge-stuck'
					}),
					sign
				}),
				{ apiHost: aleph.url, ...patience }
			);
			await notifyNode(aleph.url, hash, { delayMs: 10 });
			expect(await onNode(aleph.url, hash)).toEqual({
				running: false,
				port443: null,
				failed: { code: 'startup_failed', attempts: 5 }
			});
		} finally {
			aleph.failStarts(false);
		}
	});

	it('pins a measurement, or nothing is asked for', () => {
		expect(() =>
			instanceContent({
				payer: owner,
				image: HOSTED_IMAGE,
				crn: FAKE_CRN,
				trustedExecution: {},
				name: 'x'
			})
		).toThrow(/measurement/);
	});
});

// An image of its own per set of books (#777) is the same plain image sealed
// with another passphrase: another STORE. The pins are computed from Aleph's
// runtime and the owner; the image is no input, so they stay the same.
describe('the launch measurement and the image', () => {
	const OTHER_IMAGE = 'f'.repeat(64);
	const runtime = {
		itemHash: 'a'.repeat(64),
		manifest: {
			boot: { cmdline_template: 'console=ttyS0 owner={owner}', cpu_models: ['EPYC-v4'] }
		},
		ovmf: new Uint8Array([1]),
		kernel: new Uint8Array([2]),
		initrd: new Uint8Array([3])
	};
	/**
	 * A stand-in for the WASM that records what it is asked to measure and
	 * answers with a digest of exactly that (the real one needs AMD's firmware).
	 */
	const recording = () => {
		/** @type {any[][]} */
		const asked = [];
		const digest = (/** @type {any[]} */ parts) => {
			let h = 0x811c9dc5;
			for (const c of JSON.stringify(parts.map((x) => (x instanceof Uint8Array ? [...x] : x)))) {
				h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
			}
			return h.toString(16).padStart(8, '0').repeat(12);
		};
		return {
			asked,
			instanceCmdline: (/** @type {string} */ template, /** @type {string} */ who) => {
				asked.push(['instanceCmdline', template, who]);
				return template.replace('{owner}', who);
			},
			launchMeasurements: (/** @type {any[]} */ ...args) => {
				asked.push(['launchMeasurements', ...args]);
				return args[5].map((/** @type {string} */ vcpuType) => ({
					vcpuType,
					launch: digest(args)
				}));
			}
		};
	};

	it('is computed from the runtime, the owner and the vCPUs, and nothing else', async () => {
		const { trustedExecution } = await import('@le-space/attest-wasm/runtime');
		const wasm = recording();
		const tee = trustedExecution({ wasm, runtime, owner, vcpus: 2 });
		expect(wasm.asked).toEqual([
			['instanceCmdline', 'console=ttyS0 owner={owner}', owner],
			[
				'launchMeasurements',
				runtime.ovmf,
				runtime.kernel,
				runtime.initrd,
				`console=ttyS0 owner=${owner}`,
				2,
				['EPYC-v4']
			]
		]);
		// Another owner or another kernel is another measurement.
		const other = alephAddressOf(newAlephKey());
		expect(trustedExecution({ wasm: recording(), runtime, owner: other, vcpus: 2 })).not.toEqual(
			tee
		);
		expect(
			trustedExecution({
				wasm: recording(),
				runtime: { ...runtime, kernel: new Uint8Array([9]) },
				owner,
				vcpus: 2
			})
		).not.toEqual(tee);
		// The same once more, as for a VM from a re-sealed image: the same pins.
		expect(trustedExecution({ wasm: recording(), runtime, owner, vcpus: 2 })).toEqual(tee);
	});

	it('is pinned unchanged in an INSTANCE that boots a re-sealed image', () => {
		const of = (/** @type {string} */ image) =>
			instanceContent({
				payer: owner,
				image,
				crn: FAKE_CRN,
				trustedExecution: pins,
				name: 'belege-bridge-test',
				now: 1
			});
		const shared = of(HOSTED_IMAGE);
		const own = of(OTHER_IMAGE);
		expect(own.environment.trusted_execution).toEqual(shared.environment.trusted_execution);
		expect(own.rootfs.parent.ref).toBe(OTHER_IMAGE);
		expect({
			...own,
			rootfs: { ...own.rootfs, parent: { ...own.rootfs.parent, ref: HOSTED_IMAGE } }
		}).toEqual(shared);
	});
});

describe('usage', () => {
	it('counts hours and credits since the start', () => {
		const startedAt = '2026-11-11T10:00:00.000Z';
		expect(
			usage({ startedAt, creditsPerHour: 1800 }, Date.parse('2026-11-11T12:30:00.000Z'))
		).toEqual({
			hours: 2.5,
			credits: 4500
		});
		expect(usage({ startedAt, creditsPerHour: null }, Date.parse(startedAt))).toEqual({
			hours: 0,
			credits: null
		});
		expect(usage(null)).toBeNull();
	});
});
