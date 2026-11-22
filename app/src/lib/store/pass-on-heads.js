// What came by a heads exchange is passed on to the other devices (#979).
//
// OrbitDB 4.0.0 tells the devices of a database about an entry in two ways: a
// write is published on the database's topic, and when two devices meet they
// exchange their heads directly. Only the device's own writes are published;
// what one device receives in an exchange stays with it. So when the devices
// are connected in a row – the phone and the office laptop each to the laptop
// only, as after joining by QR – what the office laptop wrote before it was
// connected reaches the laptop and never the phone, until the phone happens to
// meet the office laptop itself. That is how a passkey added on one device
// stayed missing from the vault on another (keys/vault-share.js).
//
// After an exchange, this device publishes its heads on the topic once, when
// they are not the ones it published last: the others take what they lack and
// ignore what they have. Nothing is dialled and no connection is touched; the
// topic is the one the database publishes its writes on anyway.

/**
 * @param {any} db an open OrbitDB database
 * @returns {() => void} stop passing on (the database's own close does not need it)
 */
export function passOnHeads(db) {
	let passed = '';
	const onJoin = async (/** @type {unknown} */ _peer, /** @type {any[]} */ heads) => {
		const hashes = (heads ?? [])
			.map((h) => String(h?.hash ?? ''))
			.filter(Boolean)
			.sort()
			.join(' ');
		if (!hashes || hashes === passed) return;
		passed = hashes;
		for (const head of heads) {
			try {
				await db.sync.add(head);
			} catch {
				// A database that is closing, or nobody on the topic: nothing to pass on.
			}
		}
	};
	db.events.on('join', onJoin);
	return () => db.events.off('join', onJoin);
}
