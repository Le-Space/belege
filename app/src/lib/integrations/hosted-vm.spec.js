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
