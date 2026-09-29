// What the header says about the network (the badge next to the DID): which
// parts of Belege are online right now. Belege is local-only until the person
// switches something on – device sync (#123) or the invoicing app (UCEP, #8) –
// and from then on its libp2p nodes dial a relay over a TLS WebSocket and may
// meet other peers. The badge must say so, not stay at "Nur dieses Gerät".
// Pure: the page passes the session's state.

/**
 * @typedef {object} NetworkPart one thing that is online, or trying to be
 * @property {'devices' | 'invoice-app'} id
 * @property {'connecting' | 'online' | 'connected' | 'failed'} state
 *   online: on the network (a relay), nobody of ours connected yet;
 *   connected: an own device or the paired app is connected
 * @property {number} [devices] own devices connected
 * @property {string} [error]
 */

/**
 * @typedef {object} NetworkStatus
 * @property {'off' | 'paused' | 'connecting' | 'online' | 'connected' | 'failed'} state the most telling of the parts; paused: switched off in the header menu
 * @property {NetworkPart[]} parts
 */

/**
 * @param {{ network?: { paused: boolean }, sync: { online: boolean, error: string | null, removed?: boolean, state: { reachable?: boolean, devices?: { connected: boolean }[] } | null }, ucep: { status: 'off' | 'starting' | 'running' | 'failed', error?: string | null, app?: unknown } }} app
 * @returns {NetworkStatus}
 */
export function networkStatus(app) {
	if (app.network?.paused) return { state: 'paused', parts: [] };
	/** @type {NetworkPart[]} */
	const parts = [];
	if (app.sync.online || app.sync.error) {
		const connected = (app.sync.state?.devices ?? []).filter((d) => d.connected).length;
		parts.push({
			id: 'devices',
			state: app.sync.error
				? 'failed'
				: connected
					? 'connected'
					: app.sync.state
						? 'online'
						: 'connecting',
			devices: connected,
			...(app.sync.error ? { error: app.sync.error } : {})
		});
	}
	if (app.ucep.status !== 'off') {
		parts.push({
			id: 'invoice-app',
			state:
				app.ucep.status === 'failed'
					? 'failed'
					: app.ucep.status === 'starting'
						? 'connecting'
						: app.ucep.app
							? 'connected'
							: 'online',
			...(app.ucep.error ? { error: app.ucep.error } : {})
		});
	}
	const rank = { failed: 4, connecting: 3, connected: 2, online: 1 };
	const state = parts.length
		? parts.reduce(
				(a, p) => (rank[p.state] > rank[a] ? p.state : a),
				/** @type {NetworkPart['state']} */ ('online')
			)
		: 'off';
	return { state, parts };
}
