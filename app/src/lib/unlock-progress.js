// Where an unlock is, for the unlock screen and the console. startSession
// (node.js) reports each step as it starts; opening large books, or moving
// them into the sealed databases once after an update (store/migrate.js),
// can take minutes – shown, an unlock that works no longer looks like one
// that hangs.
//
// The screen gets every new step at once and a move's count at most every
// `every` ms (a move reports each entry). The console gets one line per step
// when it ends, with how long it took, and the total – no counts, no names
// of anything in the books.

/** @typedef {import('./node.js').UnlockStatus | { step: 'books' }} Status */

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** @param {Status} s */
const keyOf = (s) => ('collection' in s ? `${s.step} ${s.collection}` : s.step);

/**
 * @param {object} options
 * @param {(status: Status & { since: number }) => void} options.onChange the screen; `since`: when the unlock began (ms, `now`)
 * @param {(line: string) => void} [options.log]
 * @param {() => number} [options.now] ms
 * @param {number} [options.every] ms between two counts of a move on the screen
 */
export function createUnlockProgress({
	onChange,
	log = (line) => console.info(line),
	now = () => Date.now(),
	every = 100
}) {
	const since = now();
	let current = '';
	let stepStart = since;
	let shown = -Infinity;

	const close = () => {
		if (current) log(`unlock: ${current} took ${seconds(now() - stepStart)}`);
	};

	return {
		/** @param {Status} status */
		status(status) {
			const key = keyOf(status);
			const t = now();
			if (key !== current) {
				close();
				current = key;
				stepStart = t;
			} else if (
				status.step === 'move' &&
				'done' in status &&
				status.done < status.total &&
				t - shown < every
			) {
				return;
			}
			shown = t;
			onChange({ ...status, since });
		},
		/** The unlock is done (or failed): the last step and the total to the console. */
		finish(/** @type {'ready' | 'failed'} */ how = 'ready') {
			close();
			current = '';
			log(`unlock: ${how} after ${seconds(now() - since)}`);
		}
	};
}
