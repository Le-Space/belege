// The facts the connection state is decided from (state.js), gathered from
// what the app keeps today (#844, B6): the bridge as Integrationen reads it,
// the route of the last call, and the hosted bridges' status. Pure, so a spec
// can hold it against the selectors it replaces.
//
// "Reachable" still has the source it had: the last `/health` answered, over
// the route the last call took. The stream's own proof and HTTP's own status
// replace these one at a time, each in a change of its own.

/**
 * @typedef {object} KeptState
 * @property {{ state: 'unknown' | 'checking' | 'online' | 'offline', token: string | null, peerId: string | null }} bridge
 *   integrations/bridge-state.svelte.js
 * @property {'stream' | 'local' | 'device'} route how the bridge answered last (`app.sync.bridgeRoute`)
 * @property {{ aleph: { vm: any, kept: any }, near: { running: boolean, pending?: string | null } | null,
 *   peers: { aleph: string | null, near: string | null } }} hosted integrations/hosted-status.svelte.js
 * @property {number} now
 */

/**
 * @param {KeptState} kept
 * @returns {import('./state.js').ConnectionFacts}
 */
export function factsFrom({ bridge, route, hosted, now }) {
	const online = bridge.state === 'online';
	return {
		record: { token: Boolean(bridge.token), peerId: bridge.peerId },
		peers: hosted.peers,
		aleph: { vm: hosted.aleph.vm, kept: hosted.aleph.kept },
		near: hosted.near ?? undefined,
		// The last status came over the stream: the bridge's node is connected and proved.
		streamUp: online && route === 'stream',
		// It came through an own device's bridge.
		deviceUp: online && route === 'device',
		usesDevice: route === 'device',
		// What HTTP on this machine said: only known when the status came that way.
		health: route === 'local' ? bridge.state : online ? 'unknown' : bridge.state,
		now
	};
}
