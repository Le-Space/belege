// Joining as a member (#611): the join code, the sealed answer, and that only
// the device that made the code opens it. Made-up keys, DIDs and peer ids.
import { describe, expect, it } from 'vitest';

import {
	JoinError,
	createJoinRequest,
	openJoinAnswer,
	parseJoinRequest,
	sealJoinAnswer
} from './join.js';
import { memberBundle } from './member-vault.js';
import { COLLECTIONS } from '../store/repository.js';

const WRITER = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';
const BOOKS = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const DEVICE = '12D3KooWQu5E1ZkGC5x2dSVTEWxYvsssWjXgk2Mzc8GZHN26cYzS';
const key = (/** @type {number} */ n) => new Uint8Array(32).fill(n);
const bundle = memberBundle({
	books: { did: BOOKS, identityId: BOOKS, label: 'Wolkenfabrik Hosting GmbH' },
	keys: {
		database: key(1),
		replication: key(2),
		blob: key(3),
		deviceAuth: key(4),
		backup: key(5),
		bridgeAuth: key(6)
	},
	addresses: Object.fromEntries(
		COLLECTIONS.map((c, i) => [c, `/orbitdb/zdpuA${'abcdefghijk'[i]}${'b'.repeat(45)}`])
	)
});

describe('joining as a member', () => {
	it('a join code says the key, the writer and the device – and the same fingerprint on both sides', () => {
		const mine = createJoinRequest({ writer: WRITER, device: DEVICE, label: 'Buchhaltung' });
		expect(mine.text).toMatch(/^belege-join:/);
		const read = parseJoinRequest(mine.text);
		expect(read.writer).toBe(WRITER);
		expect(read.device).toBe(DEVICE);
		expect(read.label).toBe('Buchhaltung');
		expect(read.fingerprint).toBe(mine.fingerprint);
		expect(mine.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
		// Nothing secret in it.
		expect(mine.text).not.toContain(Buffer.from(mine.secretKey).toString('base64url'));
	});

	it('the answer opens with the code’s key, to the bundle the owner sealed', async () => {
		const mine = createJoinRequest({ writer: WRITER, device: DEVICE, label: 'Buchhaltung' });
		const answer = await sealJoinAnswer({ request: parseJoinRequest(mine.text), bundle });
		expect(answer).toMatch(/^belege-member:/);
		expect(answer).not.toContain('0101010101');
		expect(await openJoinAnswer(answer, mine)).toEqual(bundle);
	});

	it('another join code’s key, or a changed answer, opens nothing', async () => {
		const mine = createJoinRequest({ writer: WRITER, device: DEVICE, label: 'Buchhaltung' });
		const other = createJoinRequest({ writer: WRITER, device: DEVICE, label: 'Jemand' });
		const answer = await sealJoinAnswer({ request: parseJoinRequest(mine.text), bundle });
		await expect(openJoinAnswer(answer, other)).rejects.toThrow(/another join code/);
		const body = JSON.parse(
			Buffer.from(answer.slice('belege-member:'.length), 'base64url').toString('utf8')
		);
		const flipped = body.sealed.slice(0, -4) + (body.sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
		const changed = `belege-member:${Buffer.from(JSON.stringify({ ...body, sealed: flipped })).toString('base64url')}`;
		await expect(openJoinAnswer(changed, mine)).rejects.toThrow(JoinError);
	});

	it('refuses what is no join code, a damaged one, or one without writer or device', () => {
		expect(() => parseJoinRequest('belege-move:abc')).toThrow(/no join code/);
		expect(() => parseJoinRequest('belege-join:%%%')).toThrow(JoinError);
		expect(() => createJoinRequest({ writer: 'did:web:x', device: DEVICE, label: '' })).toThrow(
			/no DID/
		);
		expect(() => createJoinRequest({ writer: WRITER, device: 'nope', label: '' })).toThrow(
			/no peer id/
		);
	});
});
