import { describe, expect, it } from 'vitest';
import {
	STATIONS,
	fetchPercent,
	flowNow,
	journey,
	stationOfBuildStep,
	substeps,
	withFacts
} from './build-journey.js';

const HASH = 'a'.repeat(64);

describe('stationOfBuildStep', () => {
	it('maps every step the build reports onto a station, in order', () => {
		const steps = ['start', 'attest', 'build', 'fetch', 'sign', 'upload', 'confirm'];
		const stations = steps.map(stationOfBuildStep);
		expect(stations).toEqual(['wake', 'check', 'seal', 'fetch', 'store', 'store', 'store']);
		expect(stationOfBuildStep('something else')).toBeNull();
	});
});

describe('withFacts', () => {
	it('keeps only values that look like what they claim', () => {
		const f = withFacts({}, 'attest', {
			relay: 'wss://relay.example.com/attest',
			measurement: 'b'.repeat(96),
			vprogram: '<script>'
		});
		expect(f).toEqual({ relay: 'wss://relay.example.com/attest', measurement: 'b'.repeat(96) });
		expect(withFacts({}, 'sign', { storeHash: 'not a hash', cid: 'x' })).toEqual({});
	});

	it('remembers when the fetch began, once', () => {
		const a = withFacts({}, 'fetch', { got: 0, size: 100 }, 1000);
		const b = withFacts(a, 'fetch', { got: 50, size: 100 }, 5000);
		expect(b).toMatchObject({ fetchSince: 1000, got: 50, size: 100 });
		expect(fetchPercent(b)).toBe(50);
	});
});

describe('journey', () => {
	const total = STATIONS.reduce((a, s) => a + s.typical, 0);

	it('starts at the first station with the whole time ahead', () => {
		const j = journey({ station: 'wake', since: 0, now: 0 });
		expect(j.index).toBe(0);
		expect(j.share).toBe(0);
		expect(j.left).toBe(total);
	});

	it('counts the fetch by its bytes, and never says nothing is left before the end', () => {
		const half = journey({ station: 'fetch', since: 0, now: 0, facts: { got: 50, size: 100 } });
		const before = journey({ station: 'fetch', since: 0, now: 0, facts: { got: 0, size: 100 } });
		expect(half.share).toBeGreaterThan(before.share);
		const late = journey({ station: 'store', since: 0, now: 3_600_000 });
		expect(late.left).toBeGreaterThanOrEqual(60);
		expect(late.share).toBeLessThan(1);
	});

	it('done is all of it', () => {
		expect(journey({ station: 'store', since: 0, now: 5, done: true })).toMatchObject({
			share: 1,
			left: 0,
			index: STATIONS.length
		});
	});
});

describe('substeps and flowNow', () => {
	it('the first step not reported is the one that blinks', () => {
		expect(substeps('check', { relay: 'wss://r.example.com' })).toEqual([
			{ key: 'relay', state: 'done' },
			{ key: 'report', state: 'active' },
			{ key: 'match', state: 'next' }
		]);
		expect(
			substeps('store', { storeHash: HASH, processed: true }).every((s) => s.state === 'done')
		).toBe(true);
	});

	it('the passphrase goes from the browser to the builder; the pieces come back', () => {
		expect(flowNow('seal', {})).toMatchObject({
			path: ['browser', 'relay', 'builder'],
			what: 'passphrase'
		});
		expect(flowNow('fetch', { got: 25, size: 100 })).toMatchObject({
			path: ['builder', 'relay', 'browser'],
			share: 0.25
		});
	});
});
