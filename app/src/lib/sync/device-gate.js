// Only the person's own devices get the books (security audit, 2026-09).
//
// The node that syncs the books is reachable by anyone who knows its peer id:
// the relay, or whoever saw the QR code. The entries are sealed, but OrbitDB
// hands its heads and Bitswap its blocks to every peer that asks, and a peer
// id typed into "Gerät hinzufügen" counted as an own device. So a device now
// proves that it holds the passkey before it gets anything:
//
//   proof = HMAC-SHA-256(deviceAuthKey, "belege/device-proof/v1\n" prover "\n" verifier)
//
// with the key derived from the passkey's PRF answer (database-keys.js
// deriveDeviceAuthKey), the same on every device of it and never sent. Both
// peer ids are the ones Noise authenticated, so a proof is worth nothing on
// any other connection. The one that dialled proves first; the other checks,
// then proves back.
//
// Until a peer has proved it, every protocol except identify, the relay's and
// the proof itself refuses it: its streams are aborted, and libp2p's topologies
// (gossipsub, Bitswap) do not learn of it. A relay therefore never takes part
// in gossipsub, never sees which databases are subscribed and fetches no
// block; a peer id added by mistake is dialled, and gets nothing.

import { lpStream } from '@libp2p/utils';

export const PROOF_PROTOCOL = '/belege/device-proof/1.0.0';

/** What any peer may use: identify, the circuit relay, and the proof. */
const OPEN = ['/ipfs/id/', '/libp2p/circuit/relay/', PROOF_PROTOCOL];

/** @param {string} protocol */
export const isOpenProtocol = (protocol) => OPEN.some((p) => protocol.startsWith(p));

/** How long a stream of a peer that has not proved yet waits for its proof. */
export const PROOF_WAIT_MS = 10_000;
const PROOF_BYTES = 32;

/** @param {Uint8Array} authKey @param {KeyUsage} usage */
const hmacKey = (authKey, usage) =>
	crypto.subtle.importKey(
		'raw',
		Uint8Array.from(authKey),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[usage]
	);

/** @param {string} prover @param {string} verifier */
const transcript = (prover, verifier) =>
	new TextEncoder().encode(`belege/device-proof/v1\n${prover}\n${verifier}`);

/**
 * @param {Uint8Array} authKey
 * @param {string} prover the peer id that proves
 * @param {string} verifier the peer id it proves to
 */
export async function deviceProof(authKey, prover, verifier) {
	const key = await hmacKey(authKey, 'sign');
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, transcript(prover, verifier)));
}

/**
 * @param {Uint8Array} authKey
 * @param {Uint8Array} proof
 * @param {string} prover
 * @param {string} verifier
 */
export async function checkDeviceProof(authKey, proof, prover, verifier) {
	if (!(proof instanceof Uint8Array) || proof.length !== PROOF_BYTES) return false;
	const key = await hmacKey(authKey, 'verify');
	return crypto.subtle.verify('HMAC', key, Uint8Array.from(proof), transcript(prover, verifier));
}

/**
 * The gate: a libp2p service, listed first so that it wraps the registrar
 * before any other service or OrbitDB registers there.
 *
 * @param {{ authKey: Uint8Array, waitMs?: number }} p
 */
export function createDeviceGate({ authKey, waitMs = PROOF_WAIT_MS }) {
	/** Peers that proved the passkey on this run. */
	const proved = new Set();
	/** @type {Map<string, Set<() => void>>} */
	const waiting = new Map();
	/** Topology notifications held back until the peer proves: peer → calls. */
	/** @type {Map<string, Set<() => void>>} */
	const held = new Map();
	/** @type {Set<(peerId: string) => void>} */
	const listeners = new Set();
	/** @type {string} */
	let self = '';
	/** Peers a proof is running with. */
	const proving = new Set();
	/** @type {any} */
	let components = null;

	/** @param {string} peer */
	function markProved(peer) {
		if (proved.has(peer)) return;
		proved.add(peer);
		for (const wake of waiting.get(peer) ?? []) wake();
		waiting.delete(peer);
		const calls = held.get(peer);
		held.delete(peer);
		for (const call of calls ?? []) call();
		for (const listener of listeners) listener(peer);
	}

	/** @param {string} peer @returns {Promise<boolean>} */
	function waitProved(peer) {
		if (proved.has(peer)) return Promise.resolve(true);
		return new Promise((resolve) => {
			const wake = () => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				waiting.get(peer)?.delete(wake);
				resolve(proved.has(peer));
			}, waitMs);
			if (!waiting.has(peer)) waiting.set(peer, new Set());
			/** @type {Set<() => void>} */ (waiting.get(peer)).add(wake);
		});
	}

	/**
	 * @param {any} handler
	 * @returns {any}
	 */
	const gatedHandler =
		(handler) => async (/** @type {any} */ stream, /** @type {any} */ connection) => {
			if (!(await waitProved(connection.remotePeer.toString()))) {
				stream.abort(new Error('not an own device'));
				return;
			}
			return handler(stream, connection);
		};

	/** @param {any} topology */
	function gatedTopology(topology) {
		/** Peers this topology was told about. */
		const told = new Set();
		return {
			...topology,
			onConnect: (/** @type {any} */ peerId, /** @type {any} */ connection) => {
				const peer = peerId.toString();
				const tell = () => {
					if (connection.status !== 'open') return;
					told.add(peer);
					return topology.onConnect?.(peerId, connection);
				};
				if (proved.has(peer)) return tell();
				if (!held.has(peer)) held.set(peer, new Set());
				/** @type {Set<() => void>} */ (held.get(peer)).add(() => {
					Promise.resolve(tell()).catch(() => {});
				});
			},
			onDisconnect: (/** @type {any} */ peerId) => {
				const peer = peerId.toString();
				if (!told.delete(peer)) return;
				return topology.onDisconnect?.(peerId);
			}
		};
	}

	/**
	 * The one that dialled proves first; the other checks, then proves back.
	 *
	 * @param {any} connection
	 */
	async function prove(connection) {
		const peer = connection.remotePeer.toString();
		if (proved.has(peer) || proving.has(peer)) return;
		proving.add(peer);
		try {
			await exchange(connection, peer);
		} finally {
			proving.delete(peer);
		}
	}

	/** @param {any} connection @param {string} peer */
	async function exchange(connection, peer) {
		const signal = AbortSignal.timeout(waitMs);
		const stream = await connection.newStream(PROOF_PROTOCOL, {
			runOnLimitedConnection: true,
			signal
		});
		const lp = lpStream(stream, { maxDataLength: PROOF_BYTES });
		await lp.write(await deviceProof(authKey, self, peer), { signal });
		const back = (await lp.read({ signal })).subarray();
		if (await checkDeviceProof(authKey, back, peer, self)) markProved(peer);
		await stream.close().catch(() => {});
	}

	/** @param {any} stream @param {any} connection */
	async function answer(stream, connection) {
		const peer = connection.remotePeer.toString();
		const signal = AbortSignal.timeout(waitMs);
		try {
			const lp = lpStream(stream, { maxDataLength: PROOF_BYTES });
			const proof = (await lp.read({ signal })).subarray();
			if (!(await checkDeviceProof(authKey, proof, peer, self))) {
				stream.abort(new Error('not an own device'));
				return;
			}
			markProved(peer);
			await lp.write(await deviceProof(authKey, self, peer), { signal });
			await stream.close().catch(() => {});
		} catch (error) {
			stream.abort(error instanceof Error ? error : new Error(String(error)));
		}
	}

	function service(/** @type {any} */ c) {
		components = c;
		const registrar = components.registrar;
		const handle = registrar.handle.bind(registrar);
		const register = registrar.register.bind(registrar);
		registrar.handle = (
			/** @type {string} */ protocol,
			/** @type {any} */ handler,
			/** @type {any} */ opts
		) => handle(protocol, isOpenProtocol(protocol) ? handler : gatedHandler(handler), opts);
		registrar.register = (/** @type {string} */ protocol, /** @type {any} */ topology) =>
			register(protocol, isOpenProtocol(protocol) ? topology : gatedTopology(topology));

		/** @param {any} e */
		const onOpen = (e) => {
			const connection = e.detail;
			const peer = connection.remotePeer.toString();
			if (connection.direction !== 'outbound' || proved.has(peer)) return;
			// A relay or a stranger does not speak the protocol: nothing to do.
			prove(connection).catch(() => {});
		};
		return {
			[Symbol.toStringTag]: '@belege/device-gate',
			async start() {
				self = components.peerId.toString();
				await handle(PROOF_PROTOCOL, answer, { runOnLimitedConnection: true });
				components.events.addEventListener('connection:open', onOpen);
			},
			async stop() {
				components.events.removeEventListener('connection:open', onOpen);
				await registrar.unhandle(PROOF_PROTOCOL).catch(() => {});
			}
		};
	}

	return {
		service,
		/** Whether the peer proved on this run that it holds the passkey. @param {string} peerId */
		isProved: (peerId) => proved.has(String(peerId)),
		/** @param {(peerId: string) => void} listener @returns {() => void} */
		onProved(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/**
		 * Prove again to a device that is connected and has not proved: the
		 * first exchange may have failed (a relay that hung up, a timeout).
		 *
		 * @param {string} peerId
		 */
		async proveTo(peerId) {
			if (!components || proved.has(peerId)) return;
			const connection = components.connectionManager
				.getConnections()
				.find((/** @type {any} */ c) => c.remotePeer.toString() === peerId && c.status === 'open');
			if (connection) await prove(connection).catch(() => {});
		},
		/** A removed device: from now on it proves again, and is refused (the gater). @param {string} peerId */
		forget(peerId) {
			proved.delete(String(peerId));
			held.delete(String(peerId));
		}
	};
}
