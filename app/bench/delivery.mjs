// How the app arrives, measured: the released build fetched as a browser would
// on first visit — the page, then every script and stylesheet it loads — from
// the domain (DNSLink → Aleph) and straight from a public IPFS gateway by
// CID, with nothing but the address. Run by hand:
//
//   node bench/delivery.mjs            # the live release
//   node bench/delivery.mjs <cid>      # one release by its CID
//
// Results go to bench/results/<date>-delivery.json (docs/resilience-report.md).
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const RUNS = Number(process.env.DELIVERY_RUNS || 3);
const DOMAIN = 'https://belege.le-space.de/';

/** The CID the domain points at right now, from its DNSLink record. */
function liveCid() {
	const txt = execFileSync('dig', ['+short', 'TXT', '_dnslink.belege.le-space.de'], {
		encoding: 'utf8'
	});
	return /dnslink=\/ipfs\/([a-z0-9]+)/.exec(txt)?.[1] ?? null;
}

/** @param {string} url */
async function timedGet(url) {
	const t0 = performance.now();
	const res = await fetch(url, { redirect: 'follow' });
	const ttfb = performance.now() - t0;
	const body = new Uint8Array(await res.arrayBuffer());
	return {
		url,
		status: res.status,
		bytes: body.length,
		ttfbMs: ttfb,
		totalMs: performance.now() - t0,
		body
	};
}

/** The assets the page loads before it can run: entry scripts, modulepreloads, stylesheets. */
function assetsOf(/** @type {string} */ html) {
	const urls = new Set();
	for (const m of html.matchAll(
		/<link[^>]+(?:rel="modulepreload"|rel="stylesheet")[^>]+href="([^"]+)"/g
	))
		urls.add(m[1]);
	for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.add(m[1]);
	for (const m of html.matchAll(/import\("([^"]+\.js)"\)/g)) urls.add(m[1]);
	return [...urls];
}

/** One first visit: the page, then its assets, in parallel as a browser does. */
async function firstVisit(/** @type {string} */ base) {
	const t0 = performance.now();
	const page = await timedGet(base);
	const html = new TextDecoder().decode(page.body);
	// The build references its assets by absolute path (/_app/…). On a path
	// gateway (…/ipfs/<cid>/) that would leave the CID; a subdomain gateway
	// (<cid>.ipfs.…) would not. Resolve them under the base, as the latter does.
	const assets = assetsOf(html).map((u) =>
		u.startsWith('/') ? new URL(u.slice(1), base).toString() : new URL(u, base).toString()
	);
	const fetched = await Promise.all(assets.map(timedGet));
	const failed = fetched.filter((f) => f.status !== 200).map((f) => `${f.status} ${f.url}`);
	return {
		pageTtfbMs: Math.round(page.ttfbMs),
		pageBytes: page.bytes,
		assets: assets.length,
		assetBytes: fetched.reduce((s, f) => s + f.bytes, 0),
		totalMs: Math.round(performance.now() - t0),
		failed
	};
}

const cid = process.argv[2] || liveCid();
if (!cid) throw new Error('no CID: DNSLink not readable and none given');
const targets = {
	domain: DOMAIN,
	gatewayByCid: `https://ipfs.aleph.sh/ipfs/${cid}/`
};

/** @type {Record<string, any>} */
const out = { date: new Date().toISOString().slice(0, 10), cid, runs: RUNS, targets: {} };
for (const [name, base] of Object.entries(targets)) {
	/** @type {Awaited<ReturnType<typeof firstVisit>>[]} */
	const visits = [];
	for (let i = 0; i < RUNS; i++) visits.push(await firstVisit(base));
	const med = (/** @type {(v: any) => number} */ pick) => {
		const xs = visits.map(pick).sort((a, b) => a - b);
		return xs[Math.floor(xs.length / 2)];
	};
	out.targets[name] = {
		url: base,
		assets: visits[0].assets,
		pageBytes: visits[0].pageBytes,
		assetBytes: visits[0].assetBytes,
		totalKB: Math.round((visits[0].pageBytes + visits[0].assetBytes) / 1024),
		pageTtfbMsMedian: med((v) => v.pageTtfbMs),
		totalMsMedian: med((v) => v.totalMs),
		totalMsAll: visits.map((v) => v.totalMs),
		failed: visits.flatMap((v) => v.failed)
	};
	console.log(name, JSON.stringify(out.targets[name]));
}
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(
	new URL(`./results/${out.date}-delivery.json`, import.meta.url),
	JSON.stringify(out, null, '\t') + '\n'
);
