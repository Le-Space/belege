// How the books survive, measured: two devices of one passkey replicating
// over the local test relay and with no relay at all (QR), a network
// partition with writes on both sides, and a browser that lost everything
// getting its books back from the archive. Made-up books of 50, 500, …
// bookings (RESILIENCE_SIZES), written through the real store in a real
// browser, every timing taken from the page's own state (bench.count), not
// from the UI. Results go to bench/results/<date>-resilience-<scenario>-<size>.json
// and are printed as a table (docs/resilience-report.md).
//
// Every name, amount, key and address here is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import { acceptConsent } from '../e2e/consent.js';
import { device, samePasskey } from '../e2e/devices.js';
import { openIntegration } from '../e2e/integrations.js';
import { addVirtualAuthenticator, forgetThisDevice } from '../e2e/webauthn.js';

const SIZES = (process.env.RESILIENCE_SIZES || '50,500')
	.split(',')
	.map((s) => Number(s.trim()))
	.filter((n) => Number.isInteger(n) && n > 0);
const SCENARIOS = (process.env.RESILIENCE_SCENARIOS || 'relay,qr,partition,recovery')
	.split(',')
	.map((s) => s.trim());
const BATCH = 250;
/** Single-booking round trips per direction. */
const ROUNDS = Number(process.env.RESILIENCE_ROUNDS || 10);
/** Bookings in the burst, and on each side of the partition. */
const BURST = 100;
const PARTITION_EACH = 20;
/** How long the burst may take to arrive before it counts as stalled. */
const BURST_TIMEOUT_MS = Number(process.env.RESILIENCE_BURST_TIMEOUT_MS || 10 * 60 * 1000);
/**
 * A quiet spell before the burst, so a relay's circuit can expire while the
 * devices sit idle on an established direct connection — the shape of a bank
 * import after twenty minutes on a Le Space relay.
 */
const BURST_DELAY_MS = Number(process.env.RESILIENCE_BURST_DELAY_MS || 0);
/** The test relay's circuit limits, as e2e/relay.js reads them; kept with each result. */
const RELAY_LIMITS = {
	/** An outside relay's address when the run went against one, else the local test relay. */
	external: process.env.BENCH_RELAY_ADDR?.trim() || null,
	unlimited: Boolean(process.env.E2E_RELAY_UNLIMITED),
	dataLimit: process.env.E2E_RELAY_DATA_LIMIT ?? null,
	durationMs: process.env.E2E_RELAY_DURATION_MS ?? null
};

/** A small deterministic PRNG, so every run writes the same books. @param {number} seed */
function prng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Made-up bookings over a year on one account — the shape the store takes,
 * nothing the pages need beyond that.
 *
 * @param {number} size
 * @param {string} accountId
 * @param {string} [tag] something to tell one run's bookings from another's
 */
function bookings(size, accountId, tag = 'bench') {
	const rnd = prng(size);
	const vendors = Array.from(
		{ length: Math.max(10, Math.round(size / 25)) },
		(_, i) => `Lieferant ${String(i + 1).padStart(4, '0')} GmbH`
	);
	return Array.from({ length: size }, (_, i) => {
		const bookedOn = new Date(Date.UTC(2025, 0, 1) + Math.floor((i / size) * 365) * 864e5)
			.toISOString()
			.slice(0, 10);
		return {
			accountId,
			source: 'hibiscus',
			sourceId: `${tag}-${i}`,
			bookedOn,
			valueDate: bookedOn,
			amountCents: -Math.round(500 + rnd() * 150000),
			currency: 'EUR',
			counterparty: vendors[Math.floor(rnd() * vendors.length)],
			counterpartyIban: '',
			purpose: `Rechnung RE-${100000 + i} Kunde 4711`,
			endToEndId: '',
			bookingType: 'Basislastschrift',
			bankCode: '',
			receiptId: null,
			deleted: false
		};
	});
}

/** @param {import('@playwright/test').Page} page @param {string} label */
async function createPasskey(page, label) {
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	return String(await page.getByTestId('own-did').getAttribute('data-did'));
}

/** @param {import('@playwright/test').Page} page @param {string} name @param {Record<string, any>[]} records */
async function putMany(page, name, records) {
	const start = Date.now();
	/** @type {string[]} */
	const ids = [];
	for (let i = 0; i < records.length; i += BATCH) {
		ids.push(
			...(await page.evaluate(
				([n, c]) => /** @type {any} */ (window).__belegeE2E.bench.putMany(n, c),
				/** @type {const} */ ([name, records.slice(i, i + BATCH)])
			))
		);
	}
	return { ids, ms: Date.now() - start };
}

/** The books of `size` bookings on this page: one account, the bookings. */
async function writeBooks(
	/** @type {import('@playwright/test').Page} */ page,
	/** @type {number} */ size
) {
	const account = await putMany(page, 'accounts', [
		{
			source: 'hibiscus',
			sourceAccountId: 'bench-1',
			ibanLast4: '0001',
			name: 'Konto A',
			currency: 'EUR'
		}
	]);
	const written = await putMany(page, 'transactions', bookings(size, account.ids[0]));
	return { accountId: account.ids[0], ms: written.ms };
}

/** How many bookings this page's store holds, read from the store itself. */
const count = (/** @type {import('@playwright/test').Page} */ page) =>
	page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.count('transactions'));

/** Every booking's sourceId on this page, sorted: what "the same books" means. */
const sourceIds = (/** @type {import('@playwright/test').Page} */ page) =>
	page.evaluate(async () =>
		(await /** @type {any} */ (window).__belegeE2E.transactions())
			.map((/** @type {any} */ t) => String(t.sourceId))
			.sort()
	);

/**
 * Wait until the page's store holds `n` bookings; the time it took.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} n
 * @param {number} [timeout]
 */
async function untilCount(page, n, timeout = 10 * 60 * 1000) {
	const t0 = Date.now();
	await expect.poll(() => count(page), { timeout, intervals: [50, 100, 200, 500] }).toBe(n);
	return Date.now() - t0;
}

/** The sync node's network as the page sees it: `__belegeE2E.bench` in session.svelte.js. */
const net = {
	watch: (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.watchNet()),
	connections: (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.connections()),
	pubsubPeers: (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.pubsubPeers()),
	log: (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.netlog()),
	peerId: (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(() => /** @type {any} */ (window).__belegeE2E.peerId())
};

/**
 * Watch the two devices' networks while something is measured: a snapshot of
 * every connection whenever one changes, and the pages' event logs at the end.
 *
 * @param {{ mac: import('@playwright/test').Page, phone: import('@playwright/test').Page }} pages
 */
async function watchNetwork(pages) {
	await Promise.all(Object.values(pages).map(net.watch));
	const t0 = Date.now();
	/** @type {Array<Record<string, unknown>>} */
	const samples = [];
	let last = '';
	let stopped = false;
	const sample = async () => {
		if (stopped) return;
		try {
			const snapshot = Object.fromEntries(
				await Promise.all(
					Object.entries(pages).map(async ([name, page]) => [
						name,
						{ connections: await net.connections(page), pubsubPeers: await net.pubsubPeers(page) }
					])
				)
			);
			const key = JSON.stringify(snapshot);
			if (key !== last) {
				last = key;
				samples.push({ t: Date.now() - t0, ...snapshot });
			}
		} catch {
			// A page that is closing; the next tick may do better.
		}
	};
	const timer = setInterval(() => void sample(), 1000);
	await sample();
	return {
		async stop() {
			stopped = true;
			clearInterval(timer);
			const events = Object.fromEntries(
				await Promise.all(
					Object.entries(pages).map(async ([name, page]) => [
						name,
						(await net.log(page))
							.filter((/** @type {any} */ e) => e.t >= t0 - 1000)
							.map((/** @type {any} */ e) => ({ ...e, t: e.t - t0 }))
					])
				)
			);
			return { samples, events };
		}
	};
}

/** @param {number[]} xs */
const stats = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const at = (/** @type {number} */ q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
	return { n: s.length, min: s[0], median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
};

/**
 * Single bookings, one at a time from `from` to `to`: the round trip each
 * took, as the receiving store saw it.
 */
async function roundTrips(
	/** @type {import('@playwright/test').Page} */ from,
	/** @type {import('@playwright/test').Page} */ to,
	/** @type {string} */ accountId,
	/** @type {string} */ tag
) {
	/** @type {number[]} */
	const ms = [];
	for (let i = 0; i < ROUNDS; i++) {
		const before = await count(to);
		await from.evaluate(
			([acc, t, i]) =>
				/** @type {any} */ (window).__belegeE2E.addTransaction({
					accountId: acc,
					source: 'hibiscus',
					sourceId: `${t}-${i}`,
					bookedOn: '2025-06-15',
					valueDate: '2025-06-15',
					amountCents: -1234,
					currency: 'EUR',
					counterparty: `Roundtrip ${t} ${i}`,
					purpose: 'Probe',
					deleted: false
				}),
			/** @type {const} */ ([accountId, tag, i])
		);
		ms.push(await untilCount(to, before + 1, 5 * 60 * 1000));
	}
	return stats(ms);
}

/**
 * Two devices meet through the relay, as device-sync.spec.js does: the Mac's
 * id as a QR code, scanned on the phone. The time from the scan to
 * "verbunden".
 */
async function pairViaRelay(
	/** @type {Awaited<ReturnType<typeof device>>} */ mac,
	/** @type {Awaited<ReturnType<typeof device>>} */ phone
) {
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{
			timeout: 60_000
		}
	);
	const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
	await mac.page.getByTestId('devices-qr-toggle').click();
	const code = String(await mac.page.getByTestId('devices-qr').getAttribute('data-code'));
	await openIntegration(phone.page, 'geraete');
	await expect(phone.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 60_000 }
	);
	await phone.page.getByTestId('devices-scan').click();
	await expect(phone.page.getByTestId('devices-scan-view')).toBeVisible();
	const t0 = Date.now();
	await phone.page.evaluate((c) => {
		/** @type {any} */ (globalThis).__scanValue = c;
	}, code);
	await expect(
		phone.page
			.getByTestId('devices-item')
			.filter({ hasText: macId })
			.getByTestId('devices-item-state')
	).toContainText('verbunden', { timeout: 120_000 });
	return Date.now() - t0;
}

/**
 * Two devices meet with no relay at all, as device-qr.spec.js does: invite,
 * answer, answer pasted back. The time from the invite to "verbunden · direkt"
 * on both.
 */
async function pairViaQr(
	/** @type {Awaited<ReturnType<typeof device>>} */ mac,
	/** @type {Awaited<ReturnType<typeof device>>} */ phone
) {
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-qr-mode')).toBeVisible();
	const t0 = Date.now();
	await mac.page.getByTestId('devices-qr-invite').click();
	const invite = mac.page.getByTestId('devices-qr-code');
	await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 60_000 });
	const offer = String(await invite.getAttribute('data-code'));
	await openIntegration(phone.page, 'geraete');
	await phone.page.getByTestId('devices-scan').click();
	await phone.page.evaluate((c) => {
		/** @type {any} */ (globalThis).__scanValue = c;
	}, offer);
	const answer = phone.page.getByTestId('devices-qr-code');
	await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 60_000 });
	const reply = String(await answer.getAttribute('data-code'));
	await mac.page.getByTestId('devices-qr-paste').fill(reply);
	await mac.page.getByTestId('devices-qr-use').click();
	await expect(mac.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
		timeout: 120_000
	});
	await expect(phone.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
		timeout: 120_000
	});
	return Date.now() - t0;
}

/** @type {Record<string, any>[]} */
const results = [];
/** @param {Record<string, any>} r */
const keep = (r) => {
	results.push(r);
	console.log(JSON.stringify(r));
};

// ---------------------------------------------------------------- replication

for (const mode of /** @type {const} */ (['relay', 'qr'])) {
	if (!SCENARIOS.includes(mode)) continue;
	for (const size of SIZES) {
		test(`replication over ${mode}, books of ${size} bookings`, async ({ browser }) => {
			const mac = await device(browser, { mode: mode === 'qr' ? 'qr' : 'public' });
			const phone = await device(browser, { mode: mode === 'qr' ? 'qr' : 'public' });
			/** @type {string[]} */
			const outside = [];
			if (mode === 'qr') {
				const local = (/** @type {string} */ url) =>
					/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
				for (const d of [mac, phone]) {
					d.context.on('request', (r) => {
						if (!local(r.url())) outside.push(r.url());
					});
					d.page.on('websocket', (ws) => outside.push(`websocket ${ws.url()}`));
				}
			}
			try {
				/** @type {Record<string, any>} */
				const r = { scenario: `replication-${mode}`, size };
				const did = await createPasskey(mac.page, `Bench ${mode}`);
				const books = await writeBooks(mac.page, size);
				r.writeMs = books.ms;
				await samePasskey(mac, phone, did);
				expect(await count(phone.page)).toBe(0);

				// The late joiner: connected, then every booking the Mac already had.
				r.pairMs = mode === 'qr' ? await pairViaQr(mac, phone) : await pairViaRelay(mac, phone);
				r.initialSyncMs = await untilCount(phone.page, size);
				expect(await sourceIds(phone.page)).toEqual(await sourceIds(mac.page));

				// Single bookings, both ways.
				r.macToPhone = await roundTrips(mac.page, phone.page, books.accountId, `m2p-${mode}`);
				r.phoneToMac = await roundTrips(phone.page, mac.page, books.accountId, `p2m-${mode}`);

				// A burst, as a bank import is — watched, because this is where a
				// relay's circuit limit shows (docs/resilience-report.md).
				const before = await count(phone.page);
				const watching = await watchNetwork({ mac: mac.page, phone: phone.page });
				if (BURST_DELAY_MS > 0) await mac.page.waitForTimeout(BURST_DELAY_MS);
				const burst = await putMany(
					mac.page,
					'transactions',
					bookings(BURST, books.accountId, `burst-${mode}`)
				);
				/** @type {number | null} */
				let syncMs = null;
				try {
					syncMs = await untilCount(phone.page, before + BURST, BURST_TIMEOUT_MS);
				} catch {
					// Stalled: what arrived, and what the network did, go into the result.
				}
				r.burst = {
					size: BURST,
					writeMs: burst.ms,
					syncMs,
					arrived: (await count(phone.page)) - before,
					network: await watching.stop()
				};
				r.peers = { mac: await net.peerId(mac.page), phone: await net.peerId(phone.page) };
				if (mode === 'relay') r.relayLimits = RELAY_LIMITS;
				if (mode === 'qr') r.outsideRequests = outside.length;
				keep(r);
				expect(syncMs, `the burst stalled at ${r.burst.arrived} of ${BURST}`).not.toBeNull();
				expect(await sourceIds(phone.page)).toEqual(await sourceIds(mac.page));
			} finally {
				await mac.context.close();
				await phone.context.close();
			}
		});
	}
}

// ------------------------------------------------------------------ partition

if (SCENARIOS.includes('partition')) {
	test(`partition: writes on both sides while apart, merged after`, async ({ browser }) => {
		const size = SIZES[0];
		const mac = await device(browser);
		const phone = await device(browser);
		try {
			/** @type {Record<string, any>} */
			const r = { scenario: 'partition', size, each: PARTITION_EACH };
			const did = await createPasskey(mac.page, 'Bench partition');
			const books = await writeBooks(mac.page, size);
			await samePasskey(mac, phone, did);
			r.pairMs = await pairViaRelay(mac, phone);
			r.initialSyncMs = await untilCount(phone.page, size);

			// The phone goes offline: "Alles pausieren" in the badge's menu.
			const badge = phone.page.getByTestId('local-only');
			await badge.click();
			await phone.page.getByTestId('network-pause').click();
			await expect(badge).toHaveAttribute('data-state', 'paused');
			// Both sides write while apart; neither sees the other's.
			await putMany(
				mac.page,
				'transactions',
				bookings(PARTITION_EACH, books.accountId, 'apart-mac')
			);
			await putMany(
				phone.page,
				'transactions',
				bookings(PARTITION_EACH, books.accountId, 'apart-phone')
			);
			await phone.page.waitForTimeout(3000);
			r.macWhileApart = await count(mac.page);
			r.phoneWhileApart = await count(phone.page);
			expect(r.macWhileApart).toBe(size + PARTITION_EACH);
			expect(r.phoneWhileApart).toBe(size + PARTITION_EACH);

			// Back online: both converge, nothing lost.
			await badge.click();
			const t0 = Date.now();
			await phone.page.getByTestId('network-resume').click();
			await expect(badge).toHaveAttribute('data-state', 'connected', { timeout: 120_000 });
			r.reconnectMs = Date.now() - t0;
			r.convergeMs = Math.max(
				await untilCount(mac.page, size + 2 * PARTITION_EACH),
				await untilCount(phone.page, size + 2 * PARTITION_EACH)
			);
			const a = await sourceIds(mac.page);
			const b = await sourceIds(phone.page);
			expect(a).toEqual(b);
			r.lostWrites = size + 2 * PARTITION_EACH - a.length;
			keep(r);
		} finally {
			await mac.context.close();
			await phone.context.close();
		}
	});
}

// ------------------------------------------------------------------- recovery

if (SCENARIOS.includes('recovery')) {
	test.describe('recovery from the archive', () => {
		const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4397);
		const APP_ORIGIN = `http://localhost:${process.env.BENCH_PORT || 4396}`;
		const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
		const KEY = createHash('sha256').update('belege bench restore key').digest('hex');

		/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
		/** @type {import('node:child_process').ChildProcess | null} */ let bridge = null;
		/** @type {string} */ let dir;
		/** @type {string} */ let configPath;
		let bridgeOut = '';

		async function startBridge() {
			bridgeOut = '';
			bridge = spawn(process.execPath, [CLI, '--test-mode', '--pair', '--config', configPath], {
				env: {
					...process.env,
					BELEGE_BRIDGE_TEST_ALEPH_URL: aleph.url,
					BELEGE_BRIDGE_TEST_ALEPH_BACKUP_KEY: KEY
				},
				stdio: ['ignore', 'pipe', 'pipe']
			});
			bridge.stdout?.on('data', (d) => (bridgeOut += d));
			bridge.stderr?.on('data', (d) => (bridgeOut += d));
			await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
		}

		async function stopBridge() {
			const running = bridge;
			bridge = null;
			if (!running || running.exitCode !== null) return;
			await new Promise((resolve) => {
				running.once('exit', resolve);
				running.kill('SIGTERM');
			});
		}

		/** @param {import('@playwright/test').Page} page */
		async function pair(page) {
			await page.getByRole('link', { name: 'Integrationen' }).click();
			const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
			await page.getByTestId('pairing-code').fill(code);
			await page.getByRole('button', { name: 'Koppeln' }).click();
			await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
		}

		test.beforeAll(async () => {
			aleph = await startFakeAleph({
				accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000_000, rows: [] } }
			});
			dir = await mkdtemp(join(tmpdir(), 'belege-bench-restore-'));
			configPath = join(dir, 'bridge.json');
			await saveConfig(
				{
					...defaultConfig(),
					bridge: { port: BRIDGE_PORT },
					appOrigins: [APP_ORIGIN],
					alephBackup: { configured: true }
				},
				configPath
			);
		});

		test.afterAll(async () => {
			await stopBridge();
			await aleph?.close();
			if (dir) await rm(dir, { recursive: true, force: true });
		});

		for (const size of SIZES) {
			test(`a browser that lost everything gets ${size} bookings back`, async ({ page }) => {
				/** @type {Record<string, any>} */
				const r = { scenario: 'recovery', size };
				await startBridge();
				await page.addInitScript(
					(url) => localStorage.setItem('belege.e2e.alephUrl', url),
					aleph.url
				);
				await addVirtualAuthenticator(page);
				const did = await createPasskey(page, 'Bench recovery');
				await pair(page);
				r.writeMs = (await writeBooks(page, size)).ms;
				const estimate = await page.evaluate(() => navigator.storage.estimate());
				r.storageMB = Math.round(((estimate.usage ?? 0) / 1e6) * 10) / 10;

				// The backup, timed from the click to "von Aleph aufbewahrt".
				await openIntegration(page, 'backup');
				let t0 = Date.now();
				await page.getByTestId('backup-card').getByTestId('backup-now').click();
				await expect(page.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
					timeout: 10 * 60 * 1000
				});
				r.backupMs = Date.now() - t0;

				// Everything gone; the passkey is not. The bridge is gone too: the
				// account's address alone finds the backup.
				await forgetThisDevice(page);
				await stopBridge();
				await page.goto('/');
				await acceptConsent(page);
				await page.getByTestId('passkey-restore').click();
				await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
				expect(await count(page)).toBe(0);
				await openIntegration(page, 'backup');
				const card = page.getByTestId('restore-card');
				await card.getByTestId('restore-owner').fill(alephAccountOf(KEY).toLowerCase());
				await card.getByTestId('restore-owner-list').click();
				await expect(card.getByTestId('restore-row').first()).toBeVisible();
				await card.getByTestId('restore-pick').first().click();
				await expect(card.getByTestId('restore-confirm')).toBeVisible();
				t0 = Date.now();
				await card.getByTestId('restore-yes').click();
				await expect(card.getByTestId('restore-done')).toContainText('Wiederhergestellt', {
					timeout: 10 * 60 * 1000
				});
				r.restoreMs = Date.now() - t0;

				// The page reloads by itself; the passkey opens the books, every booking back.
				await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 60_000 });
				t0 = Date.now();
				await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
				await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
				r.unlockMs = Date.now() - t0;
				r.recoveredMs = await untilCount(page, size);
				r.lost = size - (await count(page));
				keep(r);
			});
		}
	});
}

test.afterAll(async () => {
	if (!results.length) return;
	const machine = {
		cpus: cpus()[0]?.model ?? '?',
		cores: cpus().length,
		memGB: Math.round(totalmem() / 2 ** 30)
	};
	const date = new Date().toISOString().slice(0, 10);
	const label = (process.env.BENCH_LABEL ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
	await mkdir(new URL('./results/', import.meta.url), { recursive: true });
	for (const r of results) {
		await writeFile(
			new URL(
				`./results/${date}-resilience-${r.scenario}-${r.size}${label ? `-${label}` : ''}.json`,
				import.meta.url
			),
			JSON.stringify({ date, ...(label ? { label } : {}), machine, ...r }, null, '\t') + '\n'
		);
	}
	console.table(
		results.map((r) => ({
			scenario: r.scenario,
			size: r.size,
			pairMs: r.pairMs,
			initialSyncMs: r.initialSyncMs,
			m2pMedian: r.macToPhone?.median,
			p2mMedian: r.phoneToMac?.median,
			burstSyncMs: r.burst?.syncMs,
			convergeMs: r.convergeMs,
			backupMs: r.backupMs,
			restoreMs: r.restoreMs,
			recoveredMs: r.recoveredMs
		}))
	);
});
