// A heads exchange that failed or ended empty is asked again (#909).
//
// OrbitDB 4.0.0 exchanges a database's heads with a device once, when the
// device subscribes, and then counts it as synced. Two ways it can end with
// nothing and stay that way:
//
// - The exchange itself breaks (the stream is reset, the connection it was
//   opened on is gone). Sync reports an error and forgets the peer, and asks
//   again only when the peer subscribes anew – which it has no reason to do.
// - The head arrives, and the entries behind it do not: they are fetched as
//   blocks, and a fetch that runs into a dead connection waits out its 30 s
//   and gives up. The database swallows that (it logs to the console), so the
//   exchange is reported as done, with nothing joined. This is how a late
//   joiner kept its small collections – one entry, no fetch – and none of its
//   bookings.
//
// Both are seen here: the error on the database's events, and the failed join
// where it happens. The answer to either is the same and small: restart this
// database's sync, which subscribes anew and makes the other device exchange
// heads again – a fresh exchange, a fresh fetch. A few times, further apart
// each time; a clean exchange starts the count over.
//
// Nothing is dialled here and no connection is touched: with nobody
// connected, a restart subscribes to a topic nobody hears.

/** How long after a loss the heads are asked for again: the first, second, … time in a row. */
export const HEADS_RETRY_MS = Object.freeze([2000, 10_000, 35_000, 120_000]);

/**
 * A verdict on the entry rather than a loss on the way: asking again brings
 * the same answer. (A member whose grant has not come over yet is refused
 * like this; node.js exchanges heads again when the access list changes.)
 *
 * @param {any} error
 */
export const isVerdict = (error) =>
	/doesn't match the log's id|is not allowed to write to the log|Could not validate signature/.test(
		String(error?.message ?? '')
	);

/**
 * An exchange that could not have worked and will not until something else
 * changes: OrbitDB's dial is refused on a relay's limited connection (the
 * direct connection that follows brings its own exchange, sync/device-sync.js),
 * and a peer without this database has nothing to exchange.
 *
 * @param {any} error
 */
const isPointless = (error) =>
	error?.name === 'LimitedConnectionError' || error?.name === 'UnsupportedProtocolError';

/**
 * Watch one database and ask for its heads again when an exchange was lost.
 *
 * @param {any} db an open OrbitDB database
 * @param {object} [options]
 * @param {readonly number[]} [options.delays]
 * @param {(attempt: number) => void} [options.onRetry] after a restart, with its number in the row (1, 2, …)
 * @returns {() => void} stop watching (the database's own close does not need it)
 */
export function retryLostHeads(db, { delays = HEADS_RETRY_MS, onRetry } = {}) {
	let attempt = 0;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let lostSince = false;
	let restarting = false;
	let stopped = false;

	const again = async () => {
		timer = undefined;
		if (stopped) return;
		lostSince = false;
		restarting = true;
		try {
			await db.sync.stop();
			await db.sync.start();
			onRetry?.(attempt);
		} catch {
			// A database that is closing: nothing left to ask for.
		} finally {
			restarting = false;
		}
	};

	const lost = () => {
		lostSince = true;
		if (stopped || timer !== undefined || attempt >= delays.length) return;
		timer = setTimeout(() => void again(), delays[attempt++]);
	};

	// The failed join, where it happens: the database catches it and says nothing.
	const log = db.log;
	const joinEntry = log.joinEntry;
	log.joinEntry = async (/** @type {any} */ entry) => {
		try {
			return await joinEntry(entry);
		} catch (error) {
			if (!isVerdict(error)) lost();
			throw error;
		}
	};

	const onError = (/** @type {any} */ error) => {
		if (!isVerdict(error) && !isPointless(error)) lost();
	};
	// An exchange that ran through with nothing lost since the last asking: the row is over.
	const onJoin = () => {
		if (!lostSince && !restarting && timer === undefined) attempt = 0;
	};
	db.events.on('error', onError);
	db.events.on('join', onJoin);

	return () => {
		stopped = true;
		clearTimeout(timer);
		timer = undefined;
		log.joinEntry = joinEntry;
		db.events.off('error', onError);
		db.events.off('join', onJoin);
	};
}
