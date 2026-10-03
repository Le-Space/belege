// What a person decides: link a receipt, undo a link, "Kein Beleg nötig", and
// the answers to a question. Every decision is a record the engine respects
// (engine.js): a confirmed match is never taken back by it, a rejected pair
// never offered again.

// Each decision is also an event in the Verlauf (activity/events.js); an
// answer to a question is one event, not one per step it takes.

import { recordEvent } from '../activity/events.js';
import { getSetting, setSetting } from '../store/settings.js';
import { cleanMatchingSettings, feeKey, transferPairKey } from './classify.js';
import { isActive, syncLinks } from './engine.js';
import { refundPairKey } from './refunds.js';
import { learnFromLink } from './partners.js';
import { compactIban } from './normalize.js';

/** @typedef {import('./engine.js').MatchingStore} MatchingStore */
/** @typedef {{ log?: boolean }} ActionOptions `log: false` when a caller logs the decision itself */

/**
 * @param {MatchingStore} store
 * @param {string} action
 * @param {Record<string, any>} fields
 */
const decided = (store, action, fields) =>
	recordEvent(store.events, 'decision', { action, ...fields });

/**
 * Link a receipt to a transaction for good. The receipt's other active match
 * (an automatic one elsewhere) is rejected: one receipt, one booking.
 *
 * With `alongside`, the receipt's other links stay: this booking is one more
 * instalment of the same invoice (issue #258, instalments.js).
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string, score?: number | null, reasons?: string[], alongside?: boolean }} pair
 * @param {ActionOptions} [options]
 */
export async function confirmMatch(
	store,
	{ receiptId, transactionId, score = null, reasons, alongside = false },
	{ log = true } = {}
) {
	const matches = await store.matches.list();
	for (const m of matches) {
		if (alongside) break;
		if (m.receiptId === receiptId && m.transactionId !== transactionId && isActive(m)) {
			await store.matches.put({ ...m, state: 'rejected' });
		}
	}
	const found = matches.find((m) => m.receiptId === receiptId && m.transactionId === transactionId);
	// A link made by hand stays one, also where the pair was suggested or undone
	// before: its reasons carry 'manual' (receipts/origin.js "Von Hand").
	const byHand = reasons?.includes('manual') === true;
	const record = found
		? await store.matches.put({
				...found,
				state: 'confirmed',
				...(byHand ? { reasons, score } : {})
			})
		: await store.matches.put({
				transactionId,
				receiptId,
				score,
				reasons: reasons ?? ['manual'],
				state: 'confirmed'
			});
	const tx = await store.transactions.get(transactionId);
	if (tx?.noReceipt) await store.transactions.put({ ...tx, noReceipt: null });
	// A person's link teaches: this counterparty is this vendor (partners.js).
	const receipt = await store.receipts.get(receiptId);
	if (store.partners && receipt && tx) {
		const { companyNames } = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
		await learnFromLink(store.partners, receipt, tx, { companyNames });
	}
	await syncLinks(store);
	if (log) {
		await decided(store, found && !byHand ? 'confirm' : 'link', {
			receiptId,
			transactionId,
			matchId: record.id,
			score: record.score ?? null
		});
	}
	return record;
}

/**
 * "Zuordnung lösen": the pair is rejected, so no run links it again.
 *
 * @param {MatchingStore} store
 * @param {string} matchId
 */
export async function unlinkMatch(store, matchId) {
	const m = await store.matches.get(matchId);
	if (!m) throw new Error(`No match ${matchId}`);
	await store.matches.put({ ...m, state: 'rejected' });
	await syncLinks(store);
	await decided(store, 'unlink', {
		receiptId: m.receiptId,
		transactionId: m.transactionId,
		matchId
	});
}

/**
 * Reject pairs without confirming anything ("keiner davon").
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string }[]} pairs
 * @param {ActionOptions} [options]
 */
export async function rejectPairs(store, pairs, { log = true } = {}) {
	const matches = await store.matches.list();
	for (const { receiptId, transactionId } of pairs) {
		const found = matches.find(
			(m) => m.receiptId === receiptId && m.transactionId === transactionId
		);
		if (found?.state === 'rejected') continue;
		if (found) await store.matches.put({ ...found, state: 'rejected' });
		else {
			await store.matches.put({
				transactionId,
				receiptId,
				score: null,
				reasons: [],
				state: 'rejected'
			});
		}
	}
	await syncLinks(store);
	if (log && pairs.length) {
		await decided(store, 'reject', {
			receiptId: pairs[0].receiptId,
			transactionId: pairs[0].transactionId,
			pairs: pairs.length
		});
	}
}

/**
 * "Kein Beleg nötig" (with a reason), or back (reason null). Active matches of
 * the booking are undone first.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string | null} reason
 * @param {ActionOptions} [options]
 */
export async function setNoReceipt(store, transactionId, reason, { log = true } = {}) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	if (reason !== null) {
		for (const m of await store.matches.list({ where: (m) => m.transactionId === transactionId })) {
			if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
		}
	}
	await store.transactions.put({
		...tx,
		noReceipt:
			reason === null
				? null
				: // eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
					{ reason: reason.trim() || 'Kein Beleg nötig', at: new Date().toISOString() }
	});
	await syncLinks(store);
	if (log)
		await decided(store, reason === null ? 'needs-receipt' : 'no-receipt', { transactionId });
}

/**
 * "Bankgebühr": this booking is a bank fee, and so is the next one on the same
 * account with the same purpose words (classify.js `feeKey`). A purpose
 * without words to learn from makes it "Kein Beleg nötig: Bankgebühr".
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 */
export async function markBankFee(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	const key = feeKey(tx);
	// eslint-disable-next-line belege/no-german -- stored in the books, see the follow-up on #192
	if (!key) return setNoReceipt(store, transactionId, 'Bankgebühr');
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	await setSetting(store.settings, 'matching', {
		...current,
		feeKeys: [...current.feeKeys, key]
	});
	await syncLinks(store);
	await decided(store, 'bank-fee', { transactionId });
}

/**
 * "Ja, das ist meine Firma": the name joins the company names (Eigene
 * Anweisungen); payments to or from it are own transfers from now on.
 *
 * @param {MatchingStore} store
 * @param {string} name
 */
export async function addCompanyName(store, name) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const clean = String(name ?? '').trim();
	if (!clean || current.companyNames.includes(clean)) return;
	await setSetting(store.settings, 'matching', {
		...current,
		companyNames: [...current.companyNames, clean]
	});
	await decided(store, 'company-name', {});
}

/**
 * "Ja, eigenes Konto" (issue #256): the IBAN joins the own IBANs (Eigene
 * Anweisungen); every payment to or from it is an own transfer from now on.
 *
 * @param {MatchingStore} store
 * @param {string} iban
 */
export async function addOwnIban(store, iban) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const clean = compactIban(iban);
	if (!clean || current.ownIbans.includes(clean)) return;
	await setSetting(store.settings, 'matching', {
		...current,
		ownIbans: [...current.ownIbans, clean],
		notOwnIbans: current.notOwnIbans.filter((i) => i !== clean)
	});
	await decided(store, 'own-iban', {});
}

/**
 * "Nein, nicht unseres" (issue #256): the IBAN is not offered as an own account again.
 *
 * @param {MatchingStore} store
 * @param {string} iban
 */
export async function rejectOwnIban(store, iban) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const clean = compactIban(iban);
	if (!clean || current.notOwnIbans.includes(clean)) return;
	await setSetting(store.settings, 'matching', {
		...current,
		notOwnIbans: [...current.notOwnIbans, clean]
	});
	await decided(store, 'not-own-iban', {});
}

/**
 * "Keine Umbuchung": the two bookings are not each other's other side; both
 * need a receipt again (or another rule).
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} counterBookingId
 */
export async function rejectTransfer(store, transactionId, counterBookingId) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(transactionId, counterBookingId);
	await setSetting(store.settings, 'matching', {
		...current,
		notTransfers: [...current.notTransfers, key],
		// A pair linked by hand is unlinked too.
		ownTransfers: current.ownTransfers.filter((k) => k !== key)
	});
	await decided(store, 'not-transfer', { transactionId, counterBookingId });
}

/**
 * "Als Gegenbuchung verknüpfen": the two bookings are the two sides of one own
 * transfer (1360), whatever the rules find – across chains, a bridge the
 * rules miss, an account not synced. Neither needs a receipt; each shows the
 * other under "Gehört zusammen mit". A link replaces a "Keine Umbuchung" of
 * the same pair.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} counterBookingId
 */
export async function linkTransfer(store, transactionId, counterBookingId) {
	if (transactionId === counterBookingId) return;
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(transactionId, counterBookingId);
	// A booking has one other side: an earlier link of either goes.
	const mine = (/** @type {string} */ k) =>
		k.split('|').some((id) => id === transactionId || id === counterBookingId);
	await setSetting(store.settings, 'matching', {
		...current,
		notTransfers: current.notTransfers.filter((k) => k !== key),
		ownTransfers: [...current.ownTransfers.filter((k) => !mine(k)), key],
		ownSwaps: current.ownSwaps.filter((k) => !mine(k))
	});
	await decided(store, 'own-transfer-link', { transactionId, counterBookingId });
}

/**
 * "Als Tausch verknüpfen" (issue #170): the two sides of a swap a rule does
 * not see, e.g. across chains without a memo or over an exchange. A booking
 * has one other side: an earlier transfer or swap link of either goes.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} otherId
 */
export async function linkSwap(store, transactionId, otherId) {
	if (transactionId === otherId) return;
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(transactionId, otherId);
	const mine = (/** @type {string} */ k) =>
		k.split('|').some((id) => id === transactionId || id === otherId);
	await setSetting(store.settings, 'matching', {
		...current,
		ownTransfers: current.ownTransfers.filter((k) => !mine(k)),
		ownSwaps: [...current.ownSwaps.filter((k) => !mine(k)), key]
	});
	await decided(store, 'swap-link', { transactionId, counterBookingId: otherId });
}

/**
 * "Als Migration verknüpfen" (issue #162): a token burned by its project and
 * the replacement it handed out. A booking has one other side.
 *
 * @param {MatchingStore} store
 * @param {string} burnId
 * @param {string} replacementId
 */
export async function linkMigration(store, burnId, replacementId) {
	if (burnId === replacementId) return;
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(burnId, replacementId);
	const mine = (/** @type {string} */ k) =>
		k.split('|').some((id) => id === burnId || id === replacementId);
	await setSetting(store.settings, 'matching', {
		...current,
		migrations: [...current.migrations.filter((k) => !mine(k)), key]
	});
	await decided(store, 'migration-link', {
		transactionId: burnId,
		counterBookingId: replacementId
	});
}

/**
 * "Verknüpfung lösen" of a migration.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} otherId
 */
export async function unlinkMigration(store, transactionId, otherId) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(transactionId, otherId);
	await setSetting(store.settings, 'matching', {
		...current,
		migrations: current.migrations.filter((k) => k !== key)
	});
	await decided(store, 'migration-unlink', { transactionId, counterBookingId: otherId });
}

/**
 * "Verknüpfung lösen" of a swap linked by hand.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} otherId
 */
export async function unlinkSwap(store, transactionId, otherId) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = transferPairKey(transactionId, otherId);
	await setSetting(store.settings, 'matching', {
		...current,
		ownSwaps: current.ownSwaps.filter((k) => k !== key)
	});
	await decided(store, 'swap-unlink', { transactionId, counterBookingId: otherId });
}

/**
 * "Beleg ist richtig" (Home, "Umbuchung mit Beleg"): this own transfer keeps
 * its receipt; the check no longer shows it.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} receiptId
 */
export async function keepTransferReceipt(store, transactionId, receiptId) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = `${transactionId}|${receiptId}`;
	if (current.keptTransferReceipts.includes(key)) return;
	await setSetting(store.settings, 'matching', {
		...current,
		keptTransferReceipts: [...current.keptTransferReceipts, key]
	});
	await decided(store, 'transfer-receipt-kept', { transactionId, receiptId });
}

/**
 * "Als Erstattung verknüpfen": a charge and its refund (refunds.js). A link
 * replaces a "Keine Erstattung" of the pair and an earlier link of either.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} otherId
 */
export async function linkRefund(store, transactionId, otherId) {
	if (transactionId === otherId) return;
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = refundPairKey(transactionId, otherId);
	const mine = (/** @type {string} */ k) =>
		k.split('|').some((id) => id === transactionId || id === otherId);
	await setSetting(store.settings, 'matching', {
		...current,
		notRefunds: current.notRefunds.filter((k) => k !== key),
		refundPairs: [...current.refundPairs.filter((k) => !mine(k)), key]
	});
	await decided(store, 'refund-link', { transactionId, counterBookingId: otherId });
}

/**
 * "Keine Erstattung" / "Verknüpfung lösen": the two are not a charge and its
 * refund; both need a receipt again.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} otherId
 */
export async function rejectRefund(store, transactionId, otherId) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const key = refundPairKey(transactionId, otherId);
	await setSetting(store.settings, 'matching', {
		...current,
		refundPairs: current.refundPairs.filter((k) => k !== key),
		notRefunds: [...current.notRefunds.filter((k) => k !== key), key]
	});
	await decided(store, 'not-refund', { transactionId, counterBookingId: otherId });
}

/**
 * "Als Guthabenkonto führen" / "Nicht mehr als Guthabenkonto": a vendor whose
 * top-ups are documented by its statements (vendor-account.js).
 *
 * @param {MatchingStore} store
 * @param {string} name
 * @param {boolean} on
 */
export async function setPrepaidVendor(store, name, on) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	const rest = current.prepaidVendors.filter((v) => v.name !== name);
	const kept = current.prepaidVendors.find((v) => v.name === name);
	await setSetting(store.settings, 'matching', {
		...current,
		prepaidVendors: on ? [...rest, kept ?? { name, openings: {} }] : rest
	});
	await decided(store, on ? 'prepaid-on' : 'prepaid-off', {});
}

/**
 * The balance a prepaid account had at the start of a year, as the person
 * knows it (the vendor's customer account); null forgets it.
 *
 * @param {MatchingStore} store
 * @param {string} name
 * @param {string} year YYYY
 * @param {number | null} cents
 */
export async function setPrepaidOpening(store, name, year, cents) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	await setSetting(store.settings, 'matching', {
		...current,
		prepaidVendors: current.prepaidVendors.map((v) => {
			if (v.name !== name) return v;
			const openings = { ...v.openings };
			if (cents === null) delete openings[year];
			else openings[year] = cents;
			return { ...v, openings };
		})
	});
}

/**
 * "Vergessen" for a learned bank fee: its bookings need a receipt again.
 *
 * @param {MatchingStore} store
 * @param {string} key as stored (classify.js `feeKey`)
 */
export async function forgetBankFee(store, key) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	await setSetting(store.settings, 'matching', {
		...current,
		feeKeys: current.feeKeys.filter((k) => k !== key)
	});
	await decided(store, 'bank-fee-forget', {});
}

/**
 * "Aussortieren": the receipt is no receipt of ours – a copy of another
 * (`duplicateOf`) or not needed. Out of the matching; its links are undone.
 * "Wieder aufnehmen" (`restoreReceipt`) takes it back.
 *
 * @param {MatchingStore} store
 * @param {string} receiptId
 * @param {{ duplicateOf?: string | null }} [options]
 */
export async function setAsideReceipt(store, receiptId, { duplicateOf = null } = {}) {
	const r = await store.receipts.get(receiptId);
	if (!r) throw new Error(`No receipt ${receiptId}`);
	for (const m of await store.matches.list({ where: (m) => m.receiptId === receiptId })) {
		if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
	}
	await store.receipts.put({
		...r,
		status: 'ignoriert',
		setAside: {
			reason: duplicateOf ? 'duplicate' : 'not-needed',
			of: duplicateOf,
			at: new Date().toISOString()
		}
	});
	await syncLinks(store);
	await decided(store, duplicateOf ? 'receipt-duplicate' : 'receipt-set-aside', { receiptId });
}

/**
 * @param {MatchingStore} store
 * @param {string} receiptId
 */
export async function restoreReceipt(store, receiptId) {
	const r = await store.receipts.get(receiptId);
	if (!r) throw new Error(`No receipt ${receiptId}`);
	await store.receipts.put({ ...r, status: r.extraction ? 'ausgelesen' : 'neu', setAside: null });
	await decided(store, 'receipt-restore', { receiptId });
}

/**
 * "Absender geprüft – freigeben": the receipt may be opened and read.
 *
 * @param {MatchingStore} store
 * @param {string} receiptId
 * @param {ActionOptions} [options]
 */
export async function confirmSender(store, receiptId, { log = true } = {}) {
	const r = await store.receipts.get(receiptId);
	if (!r) throw new Error('No receipt to confirm.');
	const record = await store.receipts.put({
		...r,
		confirmedByUser: true,
		status: r.status === 'rückfrage' ? 'neu' : r.status
	});
	if (log) await decided(store, 'confirm-sender', { receiptId });
	return record;
}

/**
 * "Mail in den Papierkorb verschieben": after the bridge moved the mail, every
 * receipt from it (one per attachment) records that. The receipts stay in the
 * books; setting one aside is a separate decision.
 *
 * @param {MatchingStore} store
 * @param {string} mailId
 * @param {{ now?: () => Date }} [options]
 */
export async function markMailTrashed(store, mailId, { now = () => new Date() } = {}) {
	const at = now().toISOString();
	const receipts = await store.receipts.list({ where: (r) => r.mailId === mailId });
	for (const r of receipts) await store.receipts.put({ ...r, mailTrashedAt: at });
	await decided(store, 'mail-trash', { receiptIds: receipts.map((r) => r.id) });
	return receipts.length;
}

/**
 * "Ist in Ordnung": a person looked at a receipt the scam check flagged
 * (receipts/scam.js) and says it is genuine; the hint goes for this receipt.
 *
 * @param {MatchingStore} store
 * @param {string} receiptId
 * @param {{ log?: boolean }} [options]
 */
export async function clearScam(store, receiptId, { log = true } = {}) {
	const r = await store.receipts.get(receiptId);
	if (!r) throw new Error('No receipt to clear.');
	const record = await store.receipts.put({ ...r, scamCleared: true });
	if (log) await decided(store, 'scam-cleared', { receiptId });
	return record;
}

/**
 * @typedef {{ choice: 'candidate', receiptId?: string, transactionId?: string }
 *   | { choice: 'none' }
 *   | { choice: 'no-receipt', reason?: string }
 *   | { choice: 'ignore' }
 *   | { choice: 'confirm-sender' }} Answer
 */

/**
 * Answer a question, and do what the answer says.
 *
 * @param {MatchingStore} store
 * @param {string} questionId
 * @param {Answer} answer
 */
export async function answerQuestion(store, questionId, answer) {
	const q = await store.questions.get(questionId);
	if (!q) throw new Error(`No question ${questionId}`);
	const candidates = Array.isArray(q.candidates) ? q.candidates : [];

	if (answer.choice === 'candidate') {
		const receiptId = q.receiptId ?? answer.receiptId;
		const transactionId = q.transactionId ?? answer.transactionId;
		if (!receiptId || !transactionId) throw new Error('A candidate needs a receipt and a booking.');
		const c = candidates.find(
			(/** @type {any} */ c) =>
				(c.receiptId ?? receiptId) === receiptId &&
				(c.transactionId ?? transactionId) === transactionId
		);
		await confirmMatch(
			store,
			{
				receiptId,
				transactionId,
				score: c?.score ?? null,
				reasons: c?.reasons
			},
			{ log: false }
		);
	} else if (answer.choice === 'none') {
		await rejectPairs(
			store,
			candidates.map((/** @type {any} */ c) => ({
				receiptId: q.receiptId ?? c.receiptId,
				transactionId: q.transactionId ?? c.transactionId
			})),
			{ log: false }
		);
	} else if (answer.choice === 'no-receipt') {
		if (!q.transactionId) throw new Error('Only a booking can need no receipt.');
		await setNoReceipt(store, q.transactionId, answer.reason ?? '', { log: false });
	} else if (answer.choice === 'confirm-sender') {
		if (!q.receiptId) throw new Error('No receipt to confirm.');
		await confirmSender(store, q.receiptId, { log: false });
	} else if (answer.choice === 'ignore' && q.kind === 'unknown-sender' && q.receiptId) {
		const r = await store.receipts.get(q.receiptId);
		if (r) await store.receipts.put({ ...r, status: 'ignoriert' });
	}
	// Only what was given: the store encodes with dag-cbor, which has no `undefined`.
	const stored = Object.fromEntries(Object.entries(answer).filter(([, v]) => v !== undefined));
	const record = await store.questions.put({
		...q,
		state: 'answered',
		answer: { ...stored, at: new Date().toISOString() }
	});
	await decided(store, 'answer', {
		questionId,
		questionKind: q.kind,
		choice: answer.choice,
		receiptId: q.receiptId ?? ('receiptId' in answer ? answer.receiptId : undefined) ?? null,
		transactionId:
			q.transactionId ?? ('transactionId' in answer ? answer.transactionId : undefined) ?? null
	});
	return record;
}
