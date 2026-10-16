// Between two passkey prompts, a word on what the next one is for (#429).
//
// Creating a passkey asks the authenticator three times in a row, restoring
// one four times. Without a word in between that looks like a loop. So before
// each further prompt the page says what it is for and waits for "Weiter":
// the prompt then starts from that click, which browsers that want a user
// gesture for every WebAuthn call (Safari) need anyway. "Abbrechen" stops the
// unlock before the prompt; nothing has been opened yet.

import { t } from './i18n/index.js';

/** @typedef {'prf' | 'proof'} PasskeyPurpose */

/**
 * The step on screen, or null. `resolve` continues, `reject` cancels.
 *
 * @type {{ step: { n: number, of: number, purpose: PasskeyPurpose } | null, resolve: (() => void) | null, reject: ((error: Error) => void) | null }}
 */
export const passkeyStep = $state({ step: null, resolve: null, reject: null });

/** Thrown when someone cancels between two prompts; the message is for people. */
export class PasskeyStepCancelled extends Error {
	constructor() {
		super(t('messages.passkey.stepCancelled'));
		this.name = 'PasskeyStepCancelled';
	}
}

/**
 * Show the step and wait for "Weiter".
 *
 * @param {{ n: number, of: number, purpose: PasskeyPurpose }} step
 * @returns {Promise<void>} rejects with PasskeyStepCancelled on "Abbrechen"
 */
export function confirmPasskeyStep(step) {
	// E2E builds only: the virtual authenticator needs no explanation, and
	// every spec that creates a passkey would otherwise click through. The
	// spec for this dialog switches it off (e2e/passkey-steps.spec.js).
	// Written inline so every other build drops it.
	if (
		import.meta.env.VITE_E2E === 'true' &&
		/** @type {any} */ (globalThis).__belegeSkipPasskeySteps
	) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const done = () => {
			passkeyStep.step = null;
			passkeyStep.resolve = null;
			passkeyStep.reject = null;
		};
		passkeyStep.step = step;
		passkeyStep.resolve = () => {
			done();
			resolve();
		};
		passkeyStep.reject = (error) => {
			done();
			reject(error);
		};
	});
}

/**
 * The steps of a flow after its first prompt, which its own button starts.
 *
 * @param {'create' | 'restore' | 'unlock'} flow
 * @returns {((purpose: PasskeyPurpose) => Promise<void>) | undefined}
 */
export function passkeyStepsFor(flow) {
	// create: the passkey (1), the PRF read (2), the identity proof (3).
	// restore: two touches to find the passkey (1, 2), then the same two.
	// unlock: the PRF read only, straight from its button; the proof is kept.
	const plan =
		flow === 'create'
			? { of: 3, prf: 2, proof: 3 }
			: flow === 'restore'
				? { of: 4, prf: 3, proof: 4 }
				: null;
	if (!plan) return undefined;
	return (purpose) => confirmPasskeyStep({ n: plan[purpose], of: plan.of, purpose });
}
