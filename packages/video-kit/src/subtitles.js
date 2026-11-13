// SPDX-License-Identifier: AGPL-3.0-or-later
// SubRip times. Runs in a browser as well as in Node.

/** @param {number} ms */
export const ms2srt = (ms) => {
	const h = Math.floor(ms / 3600000),
		m = Math.floor((ms % 3600000) / 60000),
		s = Math.floor((ms % 60000) / 1000),
		x = Math.round(ms % 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};

/** @param {string} t */
export const srt2ms = (t) => {
	const m = /(\d+):(\d+):(\d+),(\d+)/.exec(t);
	return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : 0;
};

/**
 * The subtitles of a scene: a cue lasts its voice, or until the next one.
 * @param {{ t: number, text: string, durationMs: number }[]} cues
 */
export function cuesToSrt(cues) {
	return cues
		.map((c, i) => {
			const end = Math.min(c.t + Math.max(c.durationMs, 1200), cues[i + 1]?.t ?? Infinity);
			return `${i + 1}\n${ms2srt(c.t)} --> ${ms2srt(end)}\n${c.text}\n`;
		})
		.join('\n');
}
