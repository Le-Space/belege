// Runs the spike for #148 step 2c end to end, with Playwright's Chromium:
//
//   1. the relay (relay.mjs) listens with WebRTC-Direct on one address;
//   2. two browser pages reserve on it and meet through it, then connect
//      directly over WebRTC (as belege's devices do through a public relay);
//   3. the same from an https page (WebRTC-Direct is no mixed content);
//   4. the relay restarts: same peer id and certhash, and a page that dials
//      the old address still reserves.
//
//   node run.mjs [--host <IPv4 of this machine in the LAN>] [--lifespan-days 365]
//
// Results go to stdout and out/result.json (out/ is not committed: it holds
// the addresses of this network).

import { spawn, execFileSync } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { once } from 'node:events';

import { build } from 'esbuild';
import { chromium, firefox, webkit } from '@playwright/test';

const { values } = parseArgs({
	options: {
		host: { type: 'string', default: '127.0.0.1' },
		'lifespan-days': { type: 'string', default: '' },
		'own-cert-days': { type: 'string', default: '' },
		browser: { type: 'string', default: 'chromium' },
		port: { type: 'string', default: '4991' }
	}
});
const host = String(values.host);
const stateDir = `out/state-${host.replace(/\./g, '-')}-${values['lifespan-days'] || 'default'}-${values['own-cert-days'] || 'libcert'}`;

const step = (/** @type {string} */ what) => console.error(`· ${what}`);
await mkdir('out', { recursive: true });
await build({
	entryPoints: ['client.js'],
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	outfile: 'out/client.js',
	logLevel: 'error'
});
step('bundled');
const page =
	'<!doctype html><meta charset="utf-8"><title>spike</title><script type="module" src="/client.js"></script>';
const client = await readFile('out/client.js');
/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
const serve = (req, res) => {
	if (req.url === '/client.js') {
		res.writeHead(200, { 'content-type': 'text/javascript' }).end(client);
	} else res.writeHead(200, { 'content-type': 'text/html' }).end(page);
};
if (!existsSync('out/tls.key')) {
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'ec',
			'-pkeyopt',
			'ec_paramgen_curve:P-256',
			'-nodes',
			'-keyout',
			'out/tls.key',
			'-out',
			'out/tls.crt',
			'-days',
			'2',
			'-subj',
			'/CN=localhost'
		],
		{ stdio: 'ignore' }
	);
}
const tls = {
	key: await readFile('out/tls.key'),
	cert: await readFile('out/tls.crt')
};
const http = createHttp(serve).listen(0, '127.0.0.1');
const https = createHttps(tls, serve).listen(0, '127.0.0.1');
await Promise.all([once(http, 'listening'), once(https, 'listening')]);
const origins = {
	http: `http://localhost:${/** @type {any} */ (http.address()).port}`,
	https: `https://localhost:${/** @type {any} */ (https.address()).port}`
};

step('serving');

/** Start the relay and wait for its address. */
async function startRelay() {
	const args = ['relay.mjs', '--host', host, '--port', String(values.port), '--dir', stateDir];
	if (values['lifespan-days']) args.push('--lifespan-days', String(values['lifespan-days']));
	if (values['own-cert-days']) args.push('--own-cert-days', String(values['own-cert-days']));
	const child = spawn(process.execPath, args, {
		stdio: ['ignore', 'pipe', 'inherit']
	});
	/** @type {any} */
	const ready = await new Promise((resolve, reject) => {
		child.stdout.setEncoding('utf8');
		let buffered = '';
		child.stdout.on('data', (chunk) => {
			buffered += chunk;
			for (const line of buffered.split('\n')) {
				try {
					const msg = JSON.parse(line);
					if (msg.ready) resolve(msg.ready);
				} catch {
					// Not a whole line yet.
				}
			}
		});
		child.on('exit', (code) => reject(new Error(`relay exited ${code}`)));
		setTimeout(() => reject(new Error('relay did not start')), 20_000);
	});
	step('relay up');
	return { child, ...ready, addr: ready.addrs[0] };
}

/** @param {import('node:child_process').ChildProcess} child */
async function stopRelay(child) {
	child.kill('SIGTERM');
	await once(child, 'exit');
}

const engines = { chromium, firefox, webkit };
const engine = String(values.browser);
if (!Object.hasOwn(engines, engine)) throw new Error('--browser: chromium, firefox or webkit');
const browser = await engines[/** @type {keyof typeof engines} */ (engine)].launch();
/** @param {string} origin */
async function openPage(origin) {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const p = await context.newPage();
	await p.goto(origin);
	await p.waitForFunction(() => Boolean(/** @type {any} */ (window).spike));
	return { context, p };
}

/** @param {string} origin @param {string} relay */
async function meetCase(origin, relay) {
	const a = await openPage(origin);
	const b = await openPage(origin);
	step(`pages open (${origin.split(':')[0]})`);
	try {
		const startA = await a.p.evaluate((r) => /** @type {any} */ (window).spike.start(r), relay);
		const startB = await b.p.evaluate((r) => /** @type {any} */ (window).spike.start(r), relay);
		const reserved = [startA, startB].every((s) =>
			s.addrs.some((/** @type {string} */ x) => x.includes('/p2p-circuit'))
		);
		const met = await a.p
			.evaluate(([r, id]) => /** @type {any} */ (window).spike.meet(r, id), [relay, startB.peerId])
			.catch((/** @type {any} */ e) => ({ error: String(e?.message ?? e) }));
		return {
			secureContext: startA.secure,
			reserved,
			reservedMs: [startA.reservedMs, startB.reservedMs],
			direct: !('error' in met) && !met.limited && met.remoteAddr.includes('/webrtc'),
			rtt: /** @type {any} */ (met).rtt,
			error: /** @type {any} */ (met).error
		};
	} finally {
		await a.context.close();
		await b.context.close();
	}
}

/** @type {Record<string, any>} */
const result = {
	host: host === '127.0.0.1' ? 'loopback' : 'lan',
	lifespanDays: values['lifespan-days'] || 'default (14)',
	ownCertDays: values['own-cert-days'] || 'none',
	browser: engine
};
let relay = await startRelay();
try {
	result.firstStart = { certhash: relay.certhash };
	result.http = await meetCase(origins.http, relay.addr);
	result.https = await meetCase(origins.https, relay.addr);
	const before = relay;
	await stopRelay(relay.child);
	relay = await startRelay();
	result.restart = {
		samePeerId: relay.peerId === before.peerId,
		sameCerthash: relay.certhash === before.certhash,
		oldAddrStillWorks: (await meetCase(origins.https, before.addr)).reserved
	};
} finally {
	await stopRelay(relay.child).catch(() => {});
	await browser.close();
	http.close();
	https.close();
}
await writeFile('out/result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--clean')) await rm(stateDir, { recursive: true, force: true });
