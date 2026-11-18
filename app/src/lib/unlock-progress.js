// Where an unlock is, for the unlock screen and the console. startSession
// (node.js) reports each step as it starts; opening large books, or moving
// them into the sealed databases once after an update (store/migrate.js),
// can take minutes – shown, an unlock that works no longer looks like one
// that hangs.
//
// The screen gets every new step at once and a move's count at most every
// `every` ms (a move reports each entry). The console gets one line per step
// when it ends, with how long it took, and the total – no counts, no names
// of anything in the books. A step that is still not done after `stallAfter`
// gets a warning there, once, naming it (#803): the next report can say where
// an unlock waited.

/** @typedef {import('./node.js').UnlockStatus | { step: 'books' }} Status */

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** @param {Status} s */
const keyOf = (s) =>
	'collection' in s
		? `${s.step} ${s.collection}`
		: 'part' in s && s.part
			? `${s.step} ${s.part}`
			: s.step;

/**
 * After how long a step counts as waiting, in ms; never for a move, which
 * takes as long as the books are big. Opening a collection or loading the
 * books can take minutes on large books; the other steps take seconds.
 *
 * @param {{ step: string }} status
 */
export function stallAfterOf(status) {
	if (status.step === 'move') return Infinity;
	return status.step === 'open' || status.step === 'books' ? 300_000 : 60_000;
}

/**
 * @param {object} options
 * @param {(status: Status & { since: number, stepSince: number }) => void} options.onChange the screen;
 *   `since`: when the unlock began, `stepSince`: when this step did (ms, `now`)
 * @param {(status: { step: string }) => number} [options.stallAfter] ms until a step counts as waiting
 * @param {(f: () => void, ms: number) => any} [options.setTimer]
 * @param {(id: any) => void} [options.clearTimer]
 * @param {(line: string) => void} [options.log]
 * @param {() => number} [options.now] ms
 * @param {number} [options.every] ms between two counts of a move on the screen
 */
export function createUnlockProgress({
	onChange,
	log = (line) => console.info(line),
	now = () => Date.now(),
	every = 100,
	stallAfter = stallAfterOf,
	setTimer = (f, ms) => setTimeout(f, ms),
	clearTimer = (id) => clearTimeout(id)
}) {
	const since = now();
	let current = '';
	let stepStart = since;
	let shown = -Infinity;
	/** @type {any} */
	let stallTimer = null;

	const close = () => {
		if (stallTimer !== null) clearTimer(stallTimer);
		stallTimer = null;
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
				const wait = stallAfter(status);
				if (Number.isFinite(wait)) {
					stallTimer = setTimer(() => {
						stallTimer = null;
						log(`unlock: ${key} still waiting after ${seconds(now() - stepStart)}`);
					}, wait);
				}
			} else if (
				status.step === 'move' &&
				'done' in status &&
				status.done < status.total &&
				t - shown < every
			) {
				return;
			}
			shown = t;
			onChange({ ...status, since, stepSince: stepStart });
		},
		/** The unlock is done (or failed): the last step and the total to the console. */
		finish(/** @type {'ready' | 'failed'} */ how = 'ready') {
			close();
			current = '';
			log(`unlock: ${how} after ${seconds(now() - since)}`);
		}
	};
}
