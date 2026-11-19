// What the books keep about their bridge (#844): three records in the sealed
// `settings` collection, read and written here and nowhere else, so their
// shape is said once. They sync with the books; nothing of them goes into
// localStorage.

import { getSetting, setSetting } from '$lib/store/settings.js';
import { VM_SETTING } from '$lib/integrations/hosted-vm.js';

/** The pairing with the books' bridge. */
export const BRIDGE_SETTING = 'bridge';
/** The hosted bridge on Aleph this browser unlocked last (integrations/hosted-bridge.js, #585). */
export const HOSTED_SETTING = 'bridge/hosted';
/** The bridge on Phala, started through NEAR (#696). */
export const NEAR_HOSTED_SETTING = 'bridge/hosted-near';

/**
 * @typedef {object} BridgeRecord the pairing (settings `bridge`)
 * @property {string} [url] where the bridge on a computer answers over HTTP
 * @property {string | null} [token] HTTP's token, from a pairing by code; null without one
 * @property {string} [pairedAt] when it was paired by code
 * @property {string} [peerId] the bridge's own node, a device of the books (#575): on a
 *   computer, or a hosted bridge's
 * @property {number} [keyGeneration] the generation of the bridge's key, from 1 (#575)
 * @property {string} [nodePairedAt] when these books paired its node: one unarmed after
 *   that was unpaired on purpose (#580)
 */

/**
 * @typedef {object} HostedRecord the VM on Aleph unlocked last (settings `bridge/hosted`)
 * @property {string} instance the INSTANCE's item hash
 * @property {string} host the VM's name
 * @property {string} peerId its bridge's node
 * @property {string} peerKey that node's key, kept for the next unlock of the same VM
 * @property {string} measurement
 * @property {string} attestedAt
 */

/**
 * @typedef {object} NearHostedRecord the bridge on Phala (settings `bridge/hosted-near`)
 * @property {string} books the books' account on NEAR
 * @property {string} peerId its bridge's node
 * @property {string} peerKey that node's key, kept for the next start by the same books
 * @property {string} composeHash
 * @property {string} atMs
 * @property {string} attestedAt
 */

/** @typedef {import('$lib/store/repository.js').Collection} Settings */

/**
 * The VM on Aleph the books started (settings `bridge/hosted-vm`, integrations/hosted-vm.js):
 * which instance, on which node, since when – and `stoppedAt` once it was stopped.
 *
 * @param {Settings} settings
 * @returns {Promise<{ instance: string, stoppedAt?: string } | null>}
 */
export async function readHostedVmRecord(settings) {
	const kept = await getSetting(settings, VM_SETTING);
	return typeof kept?.instance === 'string' ? kept : null;
}

/**
 * @param {Settings} settings
 * @returns {Promise<BridgeRecord | null>} null: never paired
 */
export const readBridgeRecord = (settings) => getSetting(settings, BRIDGE_SETTING);

/**
 * @param {Settings} settings
 * @param {BridgeRecord} record the whole record: what it leaves out is gone
 */
export const writeBridgeRecord = (settings, record) => setSetting(settings, BRIDGE_SETTING, record);

/**
 * @param {Settings} settings
 * @returns {Promise<HostedRecord | null>}
 */
export const readHostedRecord = (settings) => getSetting(settings, HOSTED_SETTING);

/**
 * @param {Settings} settings
 * @param {HostedRecord} record
 */
export const writeHostedRecord = (settings, record) => setSetting(settings, HOSTED_SETTING, record);

/**
 * @param {Settings} settings
 * @returns {Promise<NearHostedRecord | null>}
 */
export const readNearHostedRecord = (settings) => getSetting(settings, NEAR_HOSTED_SETTING);

/**
 * @param {Settings} settings
 * @param {NearHostedRecord} record
 */
export const writeNearHostedRecord = (settings, record) =>
	setSetting(settings, NEAR_HOSTED_SETTING, record);
