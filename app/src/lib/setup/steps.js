// The setup checklist (issue #200): the steps from a first visit to a first
// month exported, each done or not by what the books and the bridge say –
// never by a flag the person ticks. Only "later" is kept (settings key
// `setup`). Pure: the page gathers the facts, this decides what they mean.

import { ledgerOf } from '../booking/settings.js';

/**
 * @typedef {object} SetupFacts
 * @property {{ paired: boolean, online: boolean, viaDevice: boolean, llm: boolean }} bridge
 * @property {number} devices own devices the books know
 * @property {boolean} deviceSync device sync switched on
 * @property {boolean} invoiceApp paired
 * @property {Record<string, any>[]} accounts
 * @property {Record<string, any>[]} transactions
 * @property {Record<string, any>[]} receipts
 * @property {Record<string, any>[]} events the Verlauf
 * @property {Record<string, any> | null} datev the stored DATEV values, null when never saved
 * @property {string[]} later steps put off
 */

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {boolean} optional
 * @property {('bridge' | 'terminal')[]} needs
 * @property {string} href where it is done
 * @property {'done' | 'open' | 'later'} state
 */

/** In the order a person goes through them. */
export const STEP_IDS = /** @type {const} */ ([
	'passkey',
	'bridge',
	'payments',
	'receipts',
	'ai',
	'books',
	'export',
	'more'
]);

/** @type {Record<string, { optional: boolean, needs: ('bridge' | 'terminal')[], href: string }>} */
const STEP = {
	passkey: { optional: true, needs: [], href: '/integrationen/geraete' },
	bridge: { optional: false, needs: ['terminal'], href: '/integrationen/bridge' },
	payments: { optional: false, needs: [], href: '/integrationen/bank' },
	receipts: { optional: false, needs: [], href: '/belege' },
	ai: { optional: true, needs: ['bridge', 'terminal'], href: '/integrationen/ki' },
	books: { optional: false, needs: [], href: '/einstellungen#buchhaltung' },
	export: { optional: false, needs: [], href: '/export' },
	more: { optional: true, needs: [], href: '/integrationen' }
};

/** @param {Record<string, any>[]} list */
const live = (list) => list.filter((r) => !r.deleted);

/**
 * The bookkeeping is told: the DATEV values were saved once, the legal form
 * is chosen, and every account that has bookings has its ledger account.
 *
 * @param {SetupFacts} f
 */
function booksDone(f) {
	if (!f.datev || !f.datev.legalForm) return false;
	const used = new Set(
		live(f.transactions)
			.map((t) => t.accountId)
			.filter(Boolean)
	);
	return live(f.accounts)
		.filter((a) => used.has(a.id))
		.every((a) => ledgerOf(a) !== null);
}

/** @param {SetupFacts} f @returns {Record<string, boolean>} */
function doneOf(f) {
	return {
		passkey: f.devices > 0,
		bridge: f.bridge.viaDevice || (f.bridge.paired && f.bridge.online),
		payments: live(f.transactions).length > 0,
		receipts: live(f.receipts).length > 0,
		ai: f.bridge.llm,
		books: booksDone(f),
		export: f.events.some((e) => e.kind === 'export'),
		more: f.deviceSync || f.invoiceApp
	};
}

/**
 * @param {SetupFacts} f
 * @returns {{ steps: Step[], done: number, total: number, next: Step | null, finished: boolean }}
 */
export function setupSteps(f) {
	const done = doneOf(f);
	const later = new Set(f.later);
	/** @type {Step[]} */
	const steps = STEP_IDS.map((id) => ({
		id,
		...STEP[id],
		state: done[id] ? 'done' : later.has(id) ? 'later' : 'open'
	}));
	const required = steps.filter((s) => !s.optional);
	return {
		steps,
		done: required.filter((s) => s.state === 'done').length,
		total: required.length,
		next: steps.find((s) => s.state === 'open') ?? null,
		// Nothing left to do now: every step is done or put off.
		finished: steps.every((s) => s.state !== 'open')
	};
}

/**
 * The stored `setup` setting, cleaned.
 *
 * @param {any} value
 * @returns {{ later: string[] }}
 */
export function cleanSetup(value) {
	const later = Array.isArray(value?.later) ? value.later : [];
	return {
		later: STEP_IDS.filter((id) => later.includes(id))
	};
}
