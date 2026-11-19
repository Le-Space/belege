// Which bridge the books expect to answer, read from the sealed settings
// alone (no network, nothing a card has to have loaded first): for a page
// anywhere in the app that has to say why none does (#844).

import { expectedBridge } from '$lib/integrations/bridge-status.js';
import {
	readBridgeRecord,
	readHostedRecord,
	readHostedVmRecord,
	readNearHostedRecord
} from './record.js';

/**
 * A hosted one when it is the books' bridge, or when the books started a VM
 * on Aleph and no other bridge is paired; else the one on a computer, if one
 * is paired; else none (integrations/bridge-status.js `expectedBridge`).
 *
 * @param {import('./record.js').Settings} settings
 * @returns {Promise<'aleph' | 'near' | 'local' | null>}
 */
export async function expectedBridgeOf(settings) {
	const [pairing, hosted, near, vm] = await Promise.all([
		readBridgeRecord(settings),
		readHostedRecord(settings),
		readNearHostedRecord(settings),
		readHostedVmRecord(settings)
	]);
	return expectedBridge({
		peerId: pairing?.peerId ?? null,
		paired: Boolean(pairing?.token || pairing?.peerId),
		peers: { aleph: hosted?.peerId ?? null, near: near?.peerId ?? null },
		alephVm: vm
	});
}
