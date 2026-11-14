// What each device may do with the bridge over the stream (grants.js, #579):
// scopes, expiry after days unused, and the limits on what costs. Made-up peer
// ids and times; nothing is real.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
	DEFAULT_LIMITS,
	createGrants as create,
	limitsOf,
	parseDevices,
	scopesOf,
	tokensIn,
	usageOf
} from '../src/grants.js';

const A = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
const B = '12D3KooWQYhTNQdmr3ArTeUHRYzFg94BKyTkoWBDWez9kSCVe2Xo';
const ALL = ['bridge:backup', 'bridge:bank:read', 'bridge:llm', 'bridge:mail:read'];
const DAY = 24 * 60 * 60 * 1000;

/** Every store made, so the last writes land before the directory goes. */
/** @type {ReturnType<typeof create>[]} */
const made = [];
/** @param {Parameters<typeof create>[0]} p */
const createGrants = (p) => {
	const g = create(p);
	made.push(g);
	return g;
};

/** @param {unknown} code */
const refused = (code) => (/** @type {any} */ e) => e.code === code;

describe('grants', () => {
	/** @type {string} */ let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-grants-'));
	});
	after(async () => {
		await Promise.all(made.map((g) => g.flushed()));
		await rm(dir, { recursive: true, force: true });
	});

	test('scopesOf: the scopes the commands name, once each', () => {
		assert.deepEqual(
			scopesOf([
				{ scope: 'bridge:llm' },
				{ scope: '' },
				{ scope: 'bridge:bank:read' },
				{ scope: 'bridge:llm' }
			]),
			['bridge:bank:read', 'bridge:llm']
		);
	});

	test('parseDevices: a peer id holds all scopes; { peerId, scopes } only those offered', () => {
		const m = parseDevices(
			[A, { peerId: B, scopes: ['bridge:llm', 'bridge:llm', 'bridge:other'] }],
			ALL
		);
		assert.deepEqual(m.get(A), ALL);
		assert.deepEqual(m.get(B), ['bridge:llm']);
		assert.throws(() => parseDevices(['not a peer'], ALL), refused('INVALID_ARGUMENTS'));
		assert.throws(
			() => parseDevices([{ peerId: A, scopes: ['../x'] }], ALL),
			refused('INVALID_ARGUMENTS')
		);
		assert.throws(() => parseDevices(new Array(65).fill(A), ALL), refused('INVALID_ARGUMENTS'));
	});

	test('limitsOf: positive integers from bridge.json, else the default', () => {
		assert.deepEqual(limitsOf(undefined), DEFAULT_LIMITS);
		assert.deepEqual(limitsOf({ llmPerMinute: 5, idleDays: -1, backupPerHour: 1.5 }), {
			...DEFAULT_LIMITS,
			llmPerMinute: 5
		});
	});

	test('tokensIn: every usage with prompt and completion', () => {
		assert.equal(
			tokensIn({
				calls: [{ usage: { prompt: 100, completion: 20 } }, { usage: { prompt: 5, completion: 1 } }]
			}),
			126
		);
		assert.equal(tokensIn({ fields: { vendor: 'Wolkenfabrik Hosting GmbH' } }), 0);
		assert.equal(tokensIn(null), 0);
	});

	test('a device off the list holds nothing; one listed alone holds every scope', async () => {
		const grants = createGrants({ file: join(dir, 'one.json'), scopes: ALL });
		await grants.adopt([A]);
		await grants.authorize(A, 'bridge:llm');
		await assert.rejects(grants.authorize(B, ''), refused('PAIRING_REQUIRED'));
		await grants.set(new Map([[A, ['bridge:bank:read']]]));
		await assert.rejects(grants.authorize(A, 'bridge:llm'), refused('SCOPE_MISSING'));
		await grants.authorize(A, 'bridge:bank:read');
		await grants.authorize(A, '');
		// Kept on disk: peer ids, scopes and times, nothing else.
		await grants.flushed();
		const kept = JSON.parse(await readFile(join(dir, 'one.json'), 'utf8'));
		assert.deepEqual(Object.keys(kept.devices), [A]);
		assert.deepEqual(Object.keys(kept.devices[A]).sort(), [
			'grantedAt',
			'lastUsedAt',
			'scopes',
			'usage'
		]);
		// A second start reads them back; a device no longer listed goes.
		const again = createGrants({ file: join(dir, 'one.json'), scopes: ALL });
		await again.adopt([A, B]);
		await assert.rejects(again.authorize(A, 'bridge:llm'), refused('SCOPE_MISSING'));
		await again.authorize(B, 'bridge:llm');
		await again.adopt([B]);
		await assert.rejects(again.authorize(A, ''), refused('PAIRING_REQUIRED'));
	});

	test('scopes lapse after the days unused, except for the device that paired the bridge', async () => {
		let now = Date.UTC(2026, 0, 1);
		const grants = createGrants({ file: join(dir, 'two.json'), scopes: ALL, now: () => now });
		await grants.adopt([A, B]);
		now += 89 * DAY;
		await grants.authorize(A, 'bridge:bank:read');
		now += 89 * DAY;
		await grants.authorize(A, 'bridge:bank:read', {});
		await assert.rejects(grants.authorize(B, 'bridge:bank:read'), refused('GRANT_EXPIRED'));
		// Telling the same list again renews nothing.
		await grants.set(
			new Map([
				[A, ALL],
				[B, ALL]
			])
		);
		await assert.rejects(grants.authorize(B, ''), refused('GRANT_EXPIRED'));
		// The device that paired the bridge does not lapse.
		await grants.authorize(B, 'bridge:bank:read', { holder: true });
		// Renewing lets a lapsed device in again.
		now += 91 * DAY;
		await assert.rejects(grants.authorize(A, ''), refused('GRANT_EXPIRED'));
		assert.equal(await grants.renew(A), true);
		await grants.authorize(A, '');
		const list = await grants.list((p) => p === B);
		assert.equal(list.find((g) => g.peerId === B)?.expiresAt, null);
		assert.equal(list.find((g) => g.peerId === A)?.expiresAt, now + 90 * DAY);
	});

	test('the settings export is for the device that paired the bridge only (#728)', async () => {
		const grants = createGrants({
			file: join(dir, 'export.json'),
			scopes: [...ALL, 'bridge:settings:export']
		});
		await grants.adopt([A, B]);
		await grants.authorize(A, 'bridge:settings:export', { holder: true });
		await assert.rejects(grants.authorize(B, 'bridge:settings:export'), refused('SCOPE_MISSING'));
		// Listing the scope for a device does not give it either.
		await grants.set(new Map([[B, ['bridge:settings:export']]]));
		await assert.rejects(
			grants.authorize(B, 'bridge:settings:export', {}),
			refused('SCOPE_MISSING')
		);
	});

	test('usage: per device and command, counts and times only, kept with the grant (#579)', async () => {
		let now = Date.UTC(2026, 0, 1);
		const file = join(dir, 'usage.json');
		const grants = createGrants({ file, scopes: ALL, now: () => now });
		await grants.adopt([A, B]);
		grants.record(A, 'mail.search', true);
		now += 1000;
		grants.record(A, 'mail.search', true);
		grants.record(A, 'mail.search', false);
		now += 1000;
		grants.record(A, 'llm.extract', true);
		// Not a device, not a command name: nothing counted.
		grants.record('12D3KooWnope', 'mail.search', true);
		grants.record(B, '../etc', true);
		const listed = await grants.list();
		assert.deepEqual(listed.find((g) => g.peerId === A)?.usage, [
			{ command: 'llm.extract', calls: 1, refused: 0, lastAt: now },
			{ command: 'mail.search', calls: 2, refused: 1, lastAt: now - 1000 }
		]);
		assert.deepEqual(listed.find((g) => g.peerId === B)?.usage, []);
		// Written at stop (else within a minute); new scopes keep the counts.
		await grants.set(
			new Map([
				[A, ['bridge:mail:read']],
				[B, ALL]
			])
		);
		await grants.flush();
		const kept = JSON.parse(await readFile(file, 'utf8'));
		assert.deepEqual(Object.keys(kept.devices[A].usage).sort(), ['llm.extract', 'mail.search']);
		assert.deepEqual(Object.keys(kept.devices[A].usage['mail.search']).sort(), [
			'calls',
			'lastAt',
			'refused'
		]);
		// Read back at the next start; a device off the list takes its usage with it.
		const again = createGrants({ file, scopes: ALL, now: () => now });
		await again.adopt([A]);
		assert.equal((await again.list())[0].usage.length, 2);
		await again.adopt([B]);
		await again.adopt([A, B]);
		assert.deepEqual((await again.list()).find((g) => g.peerId === A)?.usage, []);
	});

	test('usageOf: only command names with counts and times come back from the file', () => {
		assert.deepEqual(
			usageOf({
				'mail.search': { calls: 3, refused: -1, lastAt: 5, body: 'Rechnung' },
				'../x': { calls: 1 },
				'llm.extract': 'nope'
			}),
			{ 'mail.search': { calls: 3, refused: 0, lastAt: 5 } }
		);
		assert.deepEqual(usageOf(null), {});
		assert.deepEqual(usageOf([1]), {});
	});

	test('limits per device: model calls a minute, tokens a day, backups an hour', async () => {
		let now = Date.UTC(2026, 0, 1, 12);
		const grants = createGrants({
			file: join(dir, 'three.json'),
			scopes: ALL,
			limits: { ...DEFAULT_LIMITS, llmPerMinute: 2, llmTokensPerDay: 1000, backupPerHour: 1 },
			now: () => now
		});
		await grants.adopt([A, B]);
		await grants.authorize(A, 'bridge:llm');
		await grants.authorize(A, 'bridge:llm');
		await assert.rejects(grants.authorize(A, 'bridge:llm'), refused('RATE_LIMITED'));
		await grants.authorize(B, 'bridge:llm');
		now += 61_000;
		await grants.authorize(A, 'bridge:llm');
		grants.spent(A, { usage: { prompt: 900, completion: 100 } });
		now += 61_000;
		await assert.rejects(grants.authorize(A, 'bridge:llm'), refused('RATE_LIMITED'));
		await grants.authorize(A, 'bridge:bank:read');
		now += DAY;
		await grants.authorize(A, 'bridge:llm');

		await grants.authorize(A, 'bridge:backup');
		await assert.rejects(grants.authorize(A, 'bridge:backup'), refused('RATE_LIMITED'));
		now += 60 * 60_000 + 1;
		await grants.authorize(A, 'bridge:backup');
	});
});
