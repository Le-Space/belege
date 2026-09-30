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
 * @property {Start | null} [start] the way in chosen on the first run
 */

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {boolean} optional
 * @property {('bridge' | 'terminal')[]} needs
 * @property {string} href where it is done
 * @property {'done' | 'open' | 'later'} state
 */

/**
 * The way in, chosen on the first run (and changeable later):
 *   look    look around first – the list in its own order
 *   file    start with a bank statement file (CAMT.053), which needs no
 *           bridge: payments first, the bridge put off until it is wanted
 *   bridge  the full path: the bridge first
 *
 * @typedef {'look' | 'file' | 'bridge'} Start
 */
export const STARTS = /** @type {const} */ (['look', 'file', 'bridge']);

/** Which steps come first for a way in; the rest follow in the list's order. */
const FIRST = {
	look: [],
	file: ['payments', 'receipts', 'books', 'export'],
	bridge: ['bridge', 'payments', 'receipts']
};

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
	const start = f.start ?? null;
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
		next:
			[...(start ? FIRST[start] : []), ...STEP_IDS]
				.map((id) => steps.find((s) => s.id === id))
				.find((s) => s?.state === 'open') ?? null,
		// Nothing left to do now: every step is done or put off.
		finished: steps.every((s) => s.state !== 'open')
	};
}

/**
 * The stored `setup` setting, cleaned.
 *
 * @param {any} value
 * @returns {{ later: string[], start: Start | null }}
 */
export function cleanSetup(value) {
	const later = Array.isArray(value?.later) ? value.later : [];
	return {
		later: STEP_IDS.filter((id) => later.includes(id)),
		start: STARTS.includes(value?.start) ? value.start : null
	};
}

/**
 * Whether to ask how to start: nothing chosen yet, and the books are new –
 * no booking, no receipt, no paired bridge. Books already in use are never
 * asked.
 *
 * @param {SetupFacts} f
 */
export function asksForStart(f) {
	return (
		!f.start &&
		live(f.transactions).length === 0 &&
		live(f.receipts).length === 0 &&
		!f.bridge.paired &&
		!f.bridge.viaDevice
	);
}

/**
 * What choosing a way in stores: with a bank statement file the bridge waits
 * until it is asked for; with the bridge it is asked for now.
 *
 * @param {{ later: string[] }} setup
 * @param {Start | null} start
 * @returns {{ later: string[], start: Start | null }}
 */
export function withStart(setup, start) {
	const rest = setup.later.filter((id) => id !== 'bridge');
	const later = start === 'file' ? [...rest, 'bridge'] : start === 'bridge' ? rest : setup.later;
	return cleanSetup({ later, start });
}
