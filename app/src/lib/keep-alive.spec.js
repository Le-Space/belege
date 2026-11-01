// The page keeps playing while a long run holds it (#525): one tone for every
// holder, stopped with the last; nothing on a desktop, nothing when this
// browser said off; a track a browser would call audible.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	KEEP_ALIVE_KEY,
	aliveHolders,
	holdAlive,
	keepAliveWanted,
	setKeepAlive
} from './keep-alive.js';
import {
	LOOP_SECONDS,
	NOTE_SECONDS,
	NOTE_STARTS,
	SAMPLE_RATE,
	keepAliveSamples,
	keepAliveWav
} from './keep-alive-track.js';

const memory = () => {
	/** @type {Map<string, string>} */
	const m = new Map();
	return {
		getItem: (/** @type {string} */ k) => m.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, v),
		removeItem: (/** @type {string} */ k) => void m.delete(k),
		size: () => m.size
	};
};

/** An AudioContext that records what the keep-alive does with it. */
function fakeAudio() {
	const made = /** @type {any[]} */ ([]);
	class AudioContext {
		state = 'suspended';
		sampleRate = 48_000;
		destination = {};
		started = 0;
		decoded = 0;
		closed = false;
		constructor() {
			made.push(this);
		}
		async resume() {
			this.state = 'running';
		}
		async decodeAudioData() {
			this.decoded += 1;
			return { duration: LOOP_SECONDS };
		}
		createBuffer() {
			return { getChannelData: () => new Float32Array(1) };
		}
		createBufferSource() {
			const context = this;
			return {
				buffer: null,
				loop: false,
				connect() {},
				disconnect() {},
				start() {
					context.started += 1;
				},
				stop() {}
			};
		}
		createGain() {
			return { gain: { value: 1 }, connect() {} };
		}
		async close() {
			this.closed = true;
		}
	}
	vi.stubGlobal('AudioContext', AudioContext);
	const session = { metadata: /** @type {any} */ (null) };
	vi.stubGlobal('navigator', { mediaSession: session });
	vi.stubGlobal(
		'MediaMetadata',
		class {
			/** @param {any} m */
			constructor(m) {
				Object.assign(this, m);
			}
		}
	);
	return { made, session };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the choice', () => {
	it('is on unless this browser said off; the default leaves nothing behind', () => {
		const s = memory();
		expect(keepAliveWanted(s)).toBe(true);
		expect(keepAliveWanted(null)).toBe(true);
		setKeepAlive(s, false);
		expect(s.getItem(KEEP_ALIVE_KEY)).toBe('off');
		expect(keepAliveWanted(s)).toBe(false);
		setKeepAlive(s, true);
		expect(s.size()).toBe(0);
	});
});

describe('holdAlive', () => {
	it('plays the track once for several holders, labelled, and stops with the last', async () => {
		const { made, session } = fakeAudio();
		const release1 = holdAlive({
			title: 'Belege stellt wieder her …',
			storage: null,
			offered: true
		});
		const release2 = holdAlive({ title: 'other', storage: null, offered: true });
		expect(aliveHolders()).toBe(2);
		expect(made).toHaveLength(1);
		await settle();
		expect(made[0].decoded).toBe(1);
		expect(made[0].started).toBe(1);
		expect(session.metadata.title).toBe('Belege stellt wieder her …');
		release1();
		release1();
		expect(aliveHolders()).toBe(1);
		expect(made[0].closed).toBe(false);
		release2();
		await settle();
		expect(aliveHolders()).toBe(0);
		expect(made[0].closed).toBe(true);
		expect(session.metadata).toBeNull();
	});

	it('is nothing on a desktop, and nothing when this browser said off', async () => {
		const { made } = fakeAudio();
		holdAlive({ title: 'x', storage: null, offered: false })();
		const s = memory();
		setKeepAlive(s, false);
		holdAlive({ title: 'x', storage: s, offered: true })();
		await settle();
		expect(made).toHaveLength(0);
		expect(aliveHolders()).toBe(0);
	});

	it('is nothing without matchMedia or userAgentData (a test runner, a server)', () => {
		vi.stubGlobal('navigator', {});
		const { made } = fakeAudio();
		holdAlive({ title: 'x', storage: null })();
		expect(made).toHaveLength(0);
	});
});

describe('the track', () => {
	const samples = keepAliveSamples();

	it('is the loop at the sample rate, with a note where it says', () => {
		expect(samples.length).toBe(SAMPLE_RATE * LOOP_SECONDS);
		const peak = Math.max(...Array.from(samples.subarray(0, SAMPLE_RATE)).map(Math.abs));
		expect(peak).toBeGreaterThan(32767 * 0.3);
		// Quiet between the notes.
		const gapStart = Math.floor((NOTE_STARTS[0] + NOTE_SECONDS) * SAMPLE_RATE) + 1;
		const gapEnd = Math.floor(NOTE_STARTS[1] * SAMPLE_RATE) - 1;
		expect(Math.max(...Array.from(samples.subarray(gapStart, gapEnd)).map(Math.abs))).toBe(0);
		// No click: the first and last sample of a note are at rest.
		expect(samples[0]).toBe(0);
		expect(Math.abs(samples[Math.floor(NOTE_SECONDS * SAMPLE_RATE) - 1])).toBeLessThan(400);
	});

	it('never leaves two seconds without sound, which is when Chromium stops calling it audible', () => {
		/** Every window of 2 s, with the loop wrapped round. */
		const window = 2 * SAMPLE_RATE;
		const wrapped = new Int16Array([...samples, ...samples]);
		for (let from = 0; from < samples.length; from += SAMPLE_RATE / 10) {
			let loud = false;
			for (let i = from; i < from + window && !loud; i++) loud = Math.abs(wrapped[i]) > 1000;
			expect(loud, `quiet from ${from / SAMPLE_RATE} s`).toBe(true);
		}
	});

	it('is a WAV file: RIFF header, PCM, one channel, the samples', () => {
		const wav = keepAliveWav(samples);
		const text = (/** @type {number} */ at) => String.fromCharCode(...wav.subarray(at, at + 4));
		const view = new DataView(wav.buffer);
		expect(text(0)).toBe('RIFF');
		expect(text(8)).toBe('WAVE');
		expect(text(12)).toBe('fmt ');
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
		expect(view.getUint16(34, true)).toBe(16);
		expect(text(36)).toBe('data');
		expect(view.getUint32(40, true)).toBe(samples.length * 2);
		expect(wav.length).toBe(44 + samples.length * 2);
		expect(view.getInt16(44 + 1000, true)).toBe(samples[500]);
	});
});
