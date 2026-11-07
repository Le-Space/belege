// What must hold before the owner's secrets go to a hosted bridge VM (#584).
//
// The launch measurement covers Aleph's SEV-SNP runtime (firmware, kernel,
// initrd) and the owner's address, not the rootfs: which image the VM boots
// is named by the INSTANCE message's rootfs STORE. So the unlock checks both:
//
//   1. the INSTANCE is the owner's and boots the published image (its STORE),
//   2. it pins the measurement computed by the unlocking side, from Aleph's
//      published runtime and the owner's address – never read from the node,
//   3. the guest proves that measurement in the RA-TLS handshake
//      (@le-space/attest-wasm's unlockInstance, with the pins from 2).
//
// 1 and 2 are checked here, before anything is dialled; 3 ends the handshake
// before the injection. Whatever fails, no secret goes out.
import { pinsOf, unlockInstance } from '@le-space/attest-wasm/instance';

const HASH = /^[0-9a-f]{64}$/;

/**
 * Throws, naming what differs, unless the INSTANCE boots `image` for `owner`
 * and pins exactly the measurements of `published`.
 *
 * @param {{
 *   instance: any,
 *   published: any,
 *   image: string,
 *   owner: string
 * }} options `instance` is the INSTANCE message's content
 * @returns {{ expectedMeasurements: string[], expectedPolicy: number | undefined }} the pins to attest with
 */
export function releaseCheck({ instance, published, image, owner }) {
	if (!HASH.test(image ?? '')) throw new Error('the published image is not a STORE hash');
	const refuse = (/** @type {string} */ why) => {
		throw new Error(`${why}: no secret goes out`);
	};
	if (String(instance?.address ?? '').toLowerCase() !== String(owner ?? '').toLowerCase()) {
		refuse('the INSTANCE is not the owner’s');
	}
	if (instance?.rootfs?.parent?.ref !== image) {
		refuse('the INSTANCE boots another image than the published one');
	}
	const ours = pinsOf(published);
	let theirs;
	try {
		theirs = pinsOf(instance?.environment?.trusted_execution);
	} catch {
		refuse('the INSTANCE pins no SEV-SNP measurement');
	}
	const same =
		ours.expectedPolicy === theirs?.expectedPolicy &&
		ours.expectedMeasurements.length === theirs.expectedMeasurements.length &&
		ours.expectedMeasurements.every((m) => theirs?.expectedMeasurements.includes(m));
	if (!same) refuse('the INSTANCE pins a measurement other than the published one');
	return ours;
}

/**
 * The unlock as the owner's side runs it: `releaseCheck`, then relay-button's
 * `unlockInstance` with the pins computed here (`published`), so the guest's
 * report is held against them and not against what the message says.
 *
 * @param {{ instance: any, published: any, image: string, owner: string } & Record<string, any>} options
 *   the rest goes to `unlockInstance` (wasm, relayUrl, crnHash, instanceItemHash, passphrase, secrets, sign, …)
 */
export async function unlockHosted({ instance, published, image, owner, ...rest }) {
	releaseCheck({ instance, published, image, owner });
	return unlockInstance(/** @type {any} */ ({ ...rest, trustedExecution: published }));
}
