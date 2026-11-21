// A restore that finds no books for its passkey (#555): before a new vault is
// made for it, the page asks. A passkey that made books opens them this way
// on a new device – empty until an own device syncs them or a backup comes
// back –, but a passkey added to books elsewhere would get new, empty books
// of its own, and keep them: the vault with its slot was never published, or
// the network is paused and nothing was looked up.

import { t } from './i18n/index.js';

/**
 * The question on screen, or null. `looked`: Aleph's index was asked.
 *
 * @type {{ question: { looked: boolean } | null, resolve: (() => void) | null, reject: ((error: Error) => void) | null }}
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
 * @param {{ looked: boolean }} question
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
