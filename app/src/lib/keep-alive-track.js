// The sound the keep-alive plays (keep-alive.js, #525): a soft note every two
// seconds, made here rather than shipped as a file.
//
// Why a note at all: Chromium counts a page as playing only while its audio
// is audible, and lets "audible" lapse about two seconds after the last sound
// it could measure (AudioStreamMonitor's hold time). A truly silent track is
// frozen like any other page; the near-silent fallback the package has is a
// level meter's audible, not a person's, and does not earn a media
// notification. So: two short notes in a four-second loop, each half a second
// with a soft rise and fall, never more than 1.5 s of quiet between them. A
// heartbeat, not music.
//
// Why made and not shipped: four seconds of mono 16-bit WAV are 350 KB, a
// twentieth of the app, for something a dozen lines of arithmetic produce in
// a millisecond. A `blob:` URL is what `createKeepAlive({ track })` fetches.

/** Samples per second; plenty for a note, small enough to make and decode in no time. */
export const SAMPLE_RATE = 22_050;
/** The loop, in seconds. */
export const LOOP_SECONDS = 4;
/** Each note, in seconds. */
export const NOTE_SECONDS = 0.5;
/** When each note begins, in seconds: two beats to the loop. */
export const NOTE_STARTS = [0, 2];
/** The notes' pitches, in Hz: a fifth, low enough not to pierce. */
const PITCHES = [392, 523.25];
/** Of full scale; the keep-alive's volume (keep-alive.js) comes on top. */
const AMPLITUDE = 0.6;

/**
 * The loop as 16-bit samples, one channel.
 *
 * @returns {Int16Array}
 */
export function keepAliveSamples() {
	const samples = new Int16Array(SAMPLE_RATE * LOOP_SECONDS);
	const noteFrames = Math.floor(NOTE_SECONDS * SAMPLE_RATE);
	NOTE_STARTS.forEach((startSeconds, n) => {
		const start = Math.floor(startSeconds * SAMPLE_RATE);
		const pitch = PITCHES[n % PITCHES.length];
		for (let i = 0; i < noteFrames; i++) {
			const t = i / SAMPLE_RATE;
			// A raised-cosine envelope: no click at either end.
			const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / noteFrames);
			// The fundamental and a quieter octave: rounder than a bare sine.
			const wave = Math.sin(2 * Math.PI * pitch * t) + 0.3 * Math.sin(4 * Math.PI * pitch * t);
			samples[start + i] = Math.round((AMPLITUDE * envelope * wave * 32767) / 1.3);
		}
	});
	return samples;
}

/**
 * The loop as a WAV file: a 44-byte RIFF header and the samples.
 *
 * @param {Int16Array} [samples]
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function keepAliveWav(samples = keepAliveSamples()) {
	const dataBytes = samples.length * 2;
	const bytes = new Uint8Array(new ArrayBuffer(44 + dataBytes));
	const view = new DataView(bytes.buffer);
	/** @param {number} at @param {string} s */
	const ascii = (at, s) => {
		for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // the fmt chunk's length
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // one channel
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
	view.setUint16(32, 2, true); // bytes per frame
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);
	for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
	return bytes;
}

/** @type {string | null} */
let url = null;

/**
 * A `blob:` URL of the loop, made once per page.
 *
 * @returns {string}
 */
export function keepAliveTrackUrl() {
	url ??= URL.createObjectURL(new Blob([keepAliveWav()], { type: 'audio/wav' }));
	return url;
}
