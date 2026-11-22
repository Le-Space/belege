// A restore that finds no books for its passkey (#555): before a new vault is
// made for it, the page asks. A passkey that made books opens them this way
// on a new device – empty until an own device syncs them or a backup comes
// back –, but a passkey added to books elsewhere would get new, empty books
// of its own, and keep them: the vault with its slot was never published, or
// nothing was looked up: the network is paused, or this device meets its
// devices only in the own network (#957).

import { t } from './i18n/index.js';

/** @typedef {'looked' | 'paused' | 'own'} NewBooksWhy */

/**
 * The question on screen, or null. `why`: Aleph's index was asked
 * (`looked`), or not, because the network is paused (`paused`) or this device
 * meets its devices only by QR or at the own bridge's relay (`own`).
 *
 * @type {{ question: { why: NewBooksWhy } | null, resolve: (() => void) | null, reject: ((error: Error) => void) | null }}
 */
export const newBooksQuestion = $state({ question: null, resolve: null, reject: null });

/** Thrown when the person makes no new books; the message is for people. */
export class NewBooksDeclined extends Error {
	constructor() {
		super(t('onboarding.newBooks.declined'));
		this.name = 'NewBooksDeclined';
	}
}

/**
 * Ask, and wait for the answer.
 *
 * @param {{ why: NewBooksWhy }} question
 * @returns {Promise<void>} rejects with NewBooksDeclined on "Abbrechen"
 */
export function askNewBooks(question) {
	return new Promise((resolve, reject) => {
		const done = () => {
			newBooksQuestion.question = null;
			newBooksQuestion.resolve = null;
			newBooksQuestion.reject = null;
		};
		newBooksQuestion.question = question;
		newBooksQuestion.resolve = () => {
			done();
			resolve();
		};
		newBooksQuestion.reject = (error) => {
			done();
			reject(error);
		};
	});
}
