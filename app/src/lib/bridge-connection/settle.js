// Run something once changes have settled, but not later than a bound.
//
// A plain debounce waits for a quiet moment. When changes keep coming without
// one – a record two devices write back and forth, or a long sync – it never
// runs. The books' device list then never reached the bridge's node, and a
// device added meanwhile was refused there.

/**
 * @param {() => void} run
 * @param {{ quiet?: number, most?: number }} [o] ms without a change; ms at most after the first
 * @returns {{ poke: () => void, stop: () => void }}
 */
export function settleThen(run, { quiet = 1500, most = 5000 } = {}) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let since = 0;
	const fire = () => {
		timer = undefined;
		since = 0;
		run();
	};
	return {
		poke() {
			const now = Date.now();
			if (!since) since = now;
			clearTimeout(timer);
			timer = setTimeout(fire, Math.max(0, Math.min(quiet, since + most - now)));
		},
		stop() {
			clearTimeout(timer);
			timer = undefined;
			since = 0;
		}
	};
}
