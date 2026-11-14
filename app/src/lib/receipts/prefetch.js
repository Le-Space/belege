// Receipt files to every own device, in the background.
//
// A receipt record replicates to all devices by device sync; its file – sealed
// blocks in Helia's blockstore (blob-store.js) – stays on the device that added
// it until another device asks for it. Asked only when the file is opened, it
// is nowhere else once that device goes offline. So each device brings the
// files its receipts name and it lacks, as soon as they are named (a record
// came by sync) and at unlock (what came while it was locked).
//
// Bounded: a few files at once, a file larger than `maxBytes` is left for when
// it is opened, and one that does not come is tried again later, each time
// after a longer wait. Only while an own device is connected – never the
// books' bridge, which holds no books and does not speak the books' Bitswap –
// and never while the network is paused or device sync is off: the caller
// says so through `canFetch`. What comes is sealed, and stays sealed.
//
// The books' Bitswap does not run over relayed (limited) connections, as
// OrbitDB's head exchange does not: files, like records, move between devices
// connected directly. A public relay would carry every file otherwise, and may
// cut a circuit long before a 1 MiB block is through. The caller tries every
// missing file again when a device turns direct (`retryAll`).

/** The files a receipt names: the document, an e-invoice's XML, a mail. */
const FILE_FIELDS = /** @type {const} */ (['fileCid', 'xmlCid', 'emlCid']);

/** @param {Record<string, any>} receipt @returns {string[]} */
export function filesOf(receipt) {
	if (!receipt || receipt.deleted) return [];
	return FILE_FIELDS.map((f) => receipt[f]).filter(
		(cid) => typeof cid === 'string' && cid.length > 0
	);
}

/**
 * The wait before try `n` (1 for the first retry): doubling from `baseMs`,
 * at most `maxMs`.
 *
 * @param {number} n
 * @param {number} baseMs
 * @param {number} maxMs
 */
export const backoff = (n, baseMs, maxMs) => Math.min(maxMs, baseMs * 2 ** Math.max(0, n - 1));

/**
 * @typedef {object} PrefetchState
 * @property {string[]} missing files a receipt names that are not on this device (yet)
 * @property {string[]} fetching files on their way now
 */

/**
 * @param {object} p
 * @param {{ has: (cid: string) => Promise<boolean>, fetch: (cid: string, options?: { signal?: AbortSignal, maxBytes?: number }) => Promise<'here' | 'fetched' | 'too-large'> }} p.blobs
 * @param {() => Promise<Record<string, any>[]>} p.receipts every receipt record, deleted ones included or not
 * @param {() => boolean} p.canFetch an own device is connected, the network not paused, device sync on
 * @param {(state: PrefetchState) => void} [p.onState]
 * @param {number} [p.concurrency]
 * @param {number} [p.maxBytes] larger files wait until they are opened
 * @param {number} [p.retryMs] the first wait after a file did not come
 * @param {number} [p.retryMaxMs]
 * @param {number} [p.debounceMs] records come in bursts: one look after the burst
 * @param {() => number} [p.now]
 */
export function createFilePrefetcher({
	blobs,
	receipts,
	canFetch,
	onState = () => {},
	concurrency = 2,
	maxBytes = 32 * 1024 * 1024,
	retryMs = 30_000,
	retryMaxMs = 30 * 60_000,
	debounceMs = 1_000,
	now = () => Date.now()
}) {
	/** @type {Set<string>} */
	const missing = new Set();
	/** @type {Set<string>} */
	const fetching = new Set();
	/** @type {Set<string>} known to be whole here: not looked at again */
	const present = new Set();
	/** @type {Set<string>} too large to bring unasked */
	const skipped = new Set();
	/** @type {Map<string, { tries: number, next: number }>} */
	const failed = new Map();
	const controller = new AbortController();
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let soon;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let retryTimer;
	/** @type {Promise<void> | null} */
	let running = null;
	let again = false;
	let stopped = false;

	const report = () => onState({ missing: [...missing], fetching: [...fetching] });

	/** Look again after `ms`; an earlier look wins. @param {number} ms */
	function schedule(ms) {
		if (stopped) return;
		clearTimeout(soon);
		soon = setTimeout(() => void run(), ms);
	}

	/** The next retry, when the earliest failed file is due. */
	function scheduleRetry() {
		clearTimeout(retryTimer);
		if (stopped || failed.size === 0) return;
		const next = Math.min(...[...failed.values()].map((f) => f.next));
		retryTimer = setTimeout(() => void run(), Math.max(0, next - now()));
	}

	/** @param {string} cid */
	async function bring(cid) {
		fetching.add(cid);
		report();
		try {
			const got = await blobs.fetch(cid, { signal: controller.signal, maxBytes });
			if (got === 'too-large') skipped.add(cid);
			else {
				missing.delete(cid);
				present.add(cid);
				failed.delete(cid);
			}
		} catch {
			if (stopped) return;
			const tries = (failed.get(cid)?.tries ?? 0) + 1;
			failed.set(cid, { tries, next: now() + backoff(tries, retryMs, retryMaxMs) });
		} finally {
			fetching.delete(cid);
			report();
		}
	}

	async function pass() {
		/** @type {Set<string>} */
		const named = new Set();
		for (const r of await receipts()) for (const cid of filesOf(r)) named.add(cid);
		for (const cid of [...missing]) if (!named.has(cid)) missing.delete(cid);
		for (const cid of named) {
			if (stopped) return;
			if (present.has(cid) || missing.has(cid)) continue;
			if (await blobs.has(cid)) present.add(cid);
			else missing.add(cid);
		}
		report();
		const due = [...missing].filter(
			(cid) => !skipped.has(cid) && (failed.get(cid)?.next ?? 0) <= now()
		);
		let at = 0;
		const worker = async () => {
			while (at < due.length && !stopped && canFetch()) await bring(due[at++]);
		};
		await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
	}

	/** One look at a time; a look asked for while one runs follows it. */
	async function run() {
		if (stopped) return;
		if (running) {
			again = true;
			return running;
		}
		running = (async () => {
			do {
				again = false;
				try {
					// What is missing is told even while nothing may be fetched.
					await pass();
				} catch (error) {
					console.warn('file prefetch:', error);
				}
			} while (again && !stopped);
			scheduleRetry();
		})().finally(() => {
			running = null;
		});
		return running;
	}

	return {
		/** Something changed – a record came, a device connected: look soon. */
		kick() {
			schedule(debounceMs);
		},
		/** Look now (at unlock, and for tests). */
		run,
		/** Whether a file a receipt names is known not to be on this device. @param {string} cid */
		isMissing: (cid) => missing.has(cid),
		/** Forget the waits: a device just connected, try every missing file again. */
		retryAll() {
			failed.clear();
			schedule(debounceMs);
		},
		stop() {
			stopped = true;
			clearTimeout(soon);
			clearTimeout(retryTimer);
			controller.abort();
		}
	};
}
