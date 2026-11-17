// The build of the books' own bridge image (#777) as one journey in five
// stations (BuildJourney.svelte), as Paperless anywhere shows its first
// start: the steps `@le-space/sealed-image` reports mapped onto stations,
// with typical durations (builder about 4 min, fetch of about 950 MiB about
// 9 min over Le Space's relay) and the time left from what is known. Only the
// fetch reports real progress; the rest is an estimate and said so. Pure.

/** The stations, in order, with their typical seconds. */
export const STATIONS = Object.freeze([
	{ key: 'wake', typical: 240 },
	{ key: 'check', typical: 20 },
	{ key: 'seal', typical: 100 },
	{ key: 'fetch', typical: 540 },
	{ key: 'store', typical: 90 }
]);

/** A build step (`onProgress({ step })`) as a station, or null. @param {string} step */
export function stationOfBuildStep(step) {
	if (step === 'start') return 'wake';
	if (step === 'attest') return 'check';
	if (step === 'build') return 'seal';
	if (step === 'fetch') return 'fetch';
	if (step === 'sign' || step === 'upload' || step === 'confirm') return 'store';
	return null;
}

/**
 * What the build reported so far, merged: only values that look like what they
 * claim are kept (they are shown, never interpreted).
 *
 * @typedef {{ vprogram?: string, relay?: string, measurement?: string, plainSha256?: string, cid?: string, size?: number, got?: number, attested?: number, fetchSince?: number, storeHash?: string, host?: string, processed?: boolean }} Facts
 *
 * @param {Facts} facts @param {string} step @param {Record<string, any>} [data] @param {number} [now]
 * @returns {Facts}
 */
export function withFacts(facts, step, data = {}, now = Date.now()) {
	const out = { ...facts };
	const text = (/** @type {unknown} */ v, /** @type {RegExp} */ re) =>
		typeof v === 'string' && re.test(v) ? v : undefined;
	const count = (/** @type {unknown} */ v) =>
		typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
	const set = (/** @type {keyof Facts} */ k, /** @type {any} */ v) => {
		if (v !== undefined) /** @type {any} */ (out)[k] = v;
	};
	set('vprogram', text(data.vprogram, /^[0-9a-f]{64}$/));
	set('relay', text(data.relay, /^wss:\/\/[a-z0-9.-]{1,253}(\/[\w/-]*)?$/i));
	set('measurement', text(data.measurement, /^[0-9a-f]{32,128}$/i));
	set('plainSha256', text(data.plainSha256, /^[0-9a-f]{64}$/));
	set('cid', text(data.cid, /^[A-Za-z0-9]{40,64}$/));
	set('storeHash', text(data.storeHash, /^[0-9a-f]{64}$/));
	set('host', text(data.host, /^(https?:\/\/)?[a-z0-9.-]{1,253}(:\d{1,5})?\/?$/i));
	set('size', count(data.size));
	set('got', count(data.got));
	set('attested', count(data.attested));
	if (data.processed === true) out.processed = true;
	if (step === 'fetch' && !out.fetchSince) out.fetchSince = now;
	return out;
}

/** The share of the fetch done, 0–100, or null. @param {Facts} f */
export function fetchPercent(f) {
	return f.size && f.got != null ? Math.min(100, Math.round((f.got / f.size) * 100)) : null;
}

/** MiB/s since the fetch began, or null. @param {Facts} f @param {number} now */
export function fetchRate(f, now) {
	if (!f.fetchSince || !f.got) return null;
	const s = (now - f.fetchSince) / 1000;
	return s > 2 ? f.got / 1048576 / s : null;
}

/**
 * Where the journey stands: the station's index, the share done, the seconds
 * left and when it is expected to end. The fetch counts by its bytes and, once
 * measured, its speed; the others count their typical time down, and an
 * overrun keeps a minute in hand instead of saying "0".
 *
 * @param {{ station: string, since: number, now: number, facts?: Facts, done?: boolean }} a
 */
export function journey({ station, since, now, facts = {}, done = false }) {
	const total = STATIONS.reduce((a, s) => a + s.typical, 0);
	if (done) return { index: STATIONS.length, share: 1, left: 0, ends: now, total };
	const index = Math.max(
		0,
		STATIONS.findIndex((s) => s.key === station)
	);
	const here = STATIONS[index];
	const inStation = Math.max(0, (now - since) / 1000);
	const pct = station === 'fetch' ? fetchPercent(facts) : null;
	const doneHere =
		pct != null ? (here.typical * pct) / 100 : Math.min(inStation, here.typical * 0.95);
	const rate = station === 'fetch' ? fetchRate(facts, now) : null;
	const measured =
		rate && facts.size && facts.got != null ? (facts.size - facts.got) / 1048576 / rate : null;
	const before = STATIONS.slice(0, index).reduce((a, s) => a + s.typical, 0);
	const after = STATIONS.slice(index + 1).reduce((a, s) => a + s.typical, 0);
	const left = Math.max(60, (measured ?? here.typical - doneHere) + after);
	return {
		index,
		share: Math.min(0.99, (before + doneHere) / total),
		left,
		ends: now + left * 1000,
		total
	};
}

/**
 * The small steps of the current station, each 'done', 'active' (blinking) or
 * 'next': done when a report says so or the journey is past it.
 *
 * @param {string} station @param {Facts} f @param {boolean} [done]
 * @returns {{ key: string, state: 'done' | 'active' | 'next' }[]}
 */
export function substeps(station, f, done = false) {
	/** @type {[string, boolean][]} */
	const rows =
		station === 'wake'
			? [
					['ask', Boolean(f.vprogram)],
					['boot', false],
					['answer', false]
				]
			: station === 'check'
				? [
						['relay', Boolean(f.relay)],
						['report', Boolean(f.measurement)],
						['match', Boolean(f.measurement)]
					]
				: station === 'seal'
					? [
							['send', Boolean(f.cid)],
							['luks', Boolean(f.cid)]
						]
					: station === 'fetch'
						? [
								['lanes', Boolean(f.attested)],
								['bytes', Boolean(f.size && f.got != null && f.got >= f.size)]
							]
						: [
								['sign', Boolean(f.storeHash)],
								['upload', Boolean(f.processed)],
								['confirm', Boolean(f.processed)]
							];
	let active = false;
	return rows.map(([key, ok]) => {
		if (done || ok) return { key, state: /** @type {const} */ ('done') };
		if (!active) {
			active = true;
			return { key, state: /** @type {const} */ ('active') };
		}
		return { key, state: /** @type {const} */ ('next') };
	});
}

/**
 * What flows where right now, for the picture: the path (place keys in order),
 * what it carries, and how far it is (0–1) when that is known.
 *
 * @param {string} station @param {Facts} f
 * @returns {{ path: string[], what: string, share: number | null }}
 */
export function flowNow(station, f) {
	if (station === 'wake')
		return { path: ['browser', 'aleph', 'builder'], what: 'program', share: null };
	if (station === 'check')
		return { path: ['builder', 'relay', 'browser'], what: 'report', share: null };
	if (station === 'seal')
		return { path: ['browser', 'relay', 'builder'], what: 'passphrase', share: null };
	if (station === 'fetch') {
		const pct = fetchPercent(f);
		return {
			path: ['builder', 'relay', 'browser'],
			what: 'pieces',
			share: pct == null ? null : pct / 100
		};
	}
	return { path: ['browser', 'aleph'], what: 'image', share: f.processed ? 1 : null };
}
