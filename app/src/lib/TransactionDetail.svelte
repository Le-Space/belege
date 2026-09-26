<script>
	// One booking in full: counterparty, date, the whole purpose, the amount;
	// its receipt(s) with a preview; the other payments to the same
	// counterparty; and what a person can do: link a receipt, undo a link,
	// "Kein Beleg nötig", confirm its account ("Konto", BookingBlock.svelte),
	// and – only on a click – search the private mailbox for the missing
	// receipt (only the hits are read), or fetch it from the vendor's customer
	// portal ("Beim Anbieter holen": a portal whose name fits
	// the counterparty, else "Neues Portal aufzeichnen" for it). A fetched
	// invoice that fits this booking is offered for it, as the person's decision.
	import { onMount } from 'svelte';
	import ReceiptPreview from './ReceiptPreview.svelte';
	import BookingBlock from './BookingBlock.svelte';
	import TechnicalNote from './TechnicalNote.svelte';
	import AiMark from './AiMark.svelte';
	import { recordEvent } from './activity/events.js';
	import NewPortal from './portals/NewPortal.svelte';
	import { createPortalClient } from './portals/client.js';
	import {
		fetchPortal,
		fittingReceipt,
		portalForCounterparty,
		sinceFor
	} from './portals/actions.js';
	import {
		app,
		checkFolderNow,
		currentBlobs,
		currentStore,
		refreshNow,
		runMatchingNow
	} from './session.svelte.js';
	import { portalLink } from './matching/portal.js';
	import { learnedVendors } from './matching/partners.js';
	import { attachUpload } from './receipts/attach.js';
	import { folderSupported, savedFolder } from './receipts/folder.js';
	import { createBridgeClient } from './bridge/client.js';
	import { getSetting } from './store/settings.js';
	import { accountLabel, formatDate, formatMoney } from './bank/format.js';
	import { quantityText, valuationText } from './assets/valuation.js';
	import { receiptDate, receiptVendor } from './receipts/view.js';
	import { importMailMessages, needsConfirmation } from './receipts/import.js';
	import { extractReceipt } from './receipts/extract.js';
	import {
		addCompanyName,
		confirmMatch,
		markBankFee,
		rejectTransfer,
		setNoReceipt,
		unlinkMatch
	} from './matching/actions.js';
	import {
		coverageBadge,
		hitCriteria,
		isTxCovered,
		matchesOfTx,
		otherPayments,
		privateSearchQuery,
		rankHits,
		likelyHit,
		assistCandidates,
		matchOfReceipt,
		ownNameCandidate,
		receiptChoices
	} from './matching/view.js';
	import {
		candidateLine,
		classificationLine,
		matchLine,
		pointsBreakdown,
		thresholdsText
	} from './matching/explain.js';
	import { cleanMatchingSettings } from './matching/classify.js';
	import { graceWait, localDay } from './matching/grace.js';
	import { list, t } from './i18n/index.js';

	/** @type {{ txId: string, onclose: () => void, onopen: (id: string) => void }} */
	let { txId, onclose, onopen } = $props();

	let tx = $derived(app.transactions.find((x) => x.id === txId) ?? null);
	/** @param {string} id */
	const receiptById = (id) => app.receipts.find((r) => r.id === id) ?? null;
	let account = $derived(tx ? (app.accounts.find((a) => a.id === tx.accountId) ?? null) : null);
	let classification = $derived(tx ? (app.classifications[tx.id] ?? null) : null);
	let links = $derived(tx ? matchesOfTx(tx.id, app.matches) : []);
	let linked = $derived(
		links.flatMap((m) => {
			const receipt = app.receipts.find((r) => r.id === m.receiptId);
			return receipt ? [{ match: m, receipt }] : [];
		})
	);
	let choices = $derived(
		tx
			? receiptChoices(tx, app.receipts, app.matches, {
					companyNames: app.matchingSettings?.companyNames ?? [],
					learnedVendors: learnedVendors(app.partners ?? [])
				})
			: []
	);
	let suggestions = $derived(choices.filter((c) => c.suggested));
	let rest = $derived(choices.filter((c) => !c.suggested));
	let others = $derived(tx ? otherPayments(tx, app.transactions) : []);
	let ruleLine = $derived(
		tx
			? classificationLine(classification, { accounts: app.accounts, noReceipt: tx.noReceipt })
			: null
	);
	// The open questions about this booking: its missing receipt (with the
	// receipts that come close), or a receipt that might be this booking's.
	let openQuestions = $derived(
		tx
			? app.questions
					.filter((q) => q.state === 'open' && !q.deleted)
					.map((q) => {
						const candidates = Array.isArray(q.candidates) ? q.candidates : [];
						const items =
							q.transactionId === tx.id
								? candidates.map((/** @type {any} */ c) => ({
										receipt: receiptById(c.receiptId),
										candidate: c
									}))
								: candidates
										.filter((/** @type {any} */ c) => c.transactionId === tx.id)
										.map((/** @type {any} */ c) => ({
											receipt: receiptById(q.receiptId),
											candidate: c
										}));
						return { q, items, mine: q.transactionId === tx.id };
					})
					.filter((x) => x.mine || x.items.length > 0)
			: []
	);
	let waitDays = $derived(
		tx && !isTxCovered(tx, app.classifications)
			? graceWait(tx, cleanMatchingSettings(app.matchingSettings).graceDays, localDay())
			: null
	);

	let assigning = $state(false);
	let showAll = $state(false);
	let askingReason = $state(false);
	let reason = $state('');
	/** @type {string | null} */
	let error = $state(null);
	let busy = $state(false);

	/** @type {ReturnType<typeof createBridgeClient> | null} */
	let client = $state(null);
	/** @type {any[] | null} */
	let hits = $state(null);
	/** @type {any | null} the hit that is clearly the receipt (likelyHit) */
	let likely = $state(null);
	/** Without a clear hit every hit shows; with one, the rest on request. */
	let allHits = $state(true);
	let searching = $state(false);
	// "✦ KI-Vorschlag" under "Beleg zuordnen" (bridge POST /match/assist).
	let aiPicking = $state(false);
	/** @type {{ pick: { id: string, confidence: string, reason: string } | null, sent: string[] } | null} */
	let aiChoice = $state(null);
	let aiChoiceRow = $derived.by(() => {
		const id = /** @type {string | undefined} */ (
			aiChoice ? /** @type {any} */ (aiChoice).pick?.id : undefined
		);
		return id ? (choices.find((c) => c.receipt.id === id) ?? null) : null;
	});
	let assisting = $state(false);
	/** @type {Awaited<ReturnType<ReturnType<typeof createBridgeClient>['mailAssist']>> | null} */
	let assist = $state(null);
	/** @type {string | null} */
	let importingId = $state(null);
	/** @type {string | null} */
	let importNote = $state(null);
	/** @type {string | null} the mail last taken over: its receipts are offered for this booking */
	let hitMailId = $state(null);
	let hitReceipts = $derived(
		hitMailId
			? app.receipts
					.filter((r) => !r.deleted && r.mailId === hitMailId)
					.map((r) => ({ receipt: r, match: matchOfReceipt(r.id, app.matches) }))
			: []
	);

	/** @type {HTMLElement | undefined} */
	let panel = $state();

	let portal = $derived(tx ? portalLink(tx, app.partners) : null);
	let uploading = $state(false);
	/** @type {{ text: string, warnings: string[] } | null} */
	let uploadResult = $state(null);
	let dropping = $state(false);
	let hasFolder = $state(false);
	let folderChecking = $state(false);
	/** @type {string | null} */
	let folderNote = $state(null);

	// "Beim Anbieter holen"
	/** @type {{ url: string, token: string } | null} */
	let bridgeAt = $state(null);
	/** @type {import('./portals/client.js').PortalInfo[]} */
	let vendorPortals = $state([]);
	let vendorBusy = $state(false);
	/** @type {string | null} */
	let vendorNote = $state(null);
	/** @type {{ receipt: import('$lib/store/repository.js').StoredRecord, score: number, reasons: string[] } | null} */
	let vendorFit = $state(null);
	let recordingVendor = $state(false);
	let portalClient = $derived(bridgeAt ? createPortalClient(bridgeAt) : null);
	let vendorPortal = $derived(tx ? portalForCounterparty(vendorPortals, tx.counterparty) : null);

	onMount(() => {
		panel?.focus();
		const store = currentStore();
		if (!store) return;
		if (folderSupported()) savedFolder().then((h) => (hasFolder = Boolean(h)));
		getSetting(store.settings, 'bridge').then((saved) => {
			if (!saved?.token) return;
			client = createBridgeClient({ url: saved.url, token: saved.token });
			bridgeAt = { url: saved.url, token: saved.token };
			void loadPortals();
		});
	});

	// Another booking opened in the same panel starts afresh.
	$effect(() => {
		void txId;
		assigning = false;
		showAll = false;
		askingReason = false;
		reason = '';
		error = null;
		hits = null;
		importNote = null;
		uploadResult = null;
		folderNote = null;
		vendorNote = null;
		vendorFit = null;
		recordingVendor = false;
	});

	async function loadPortals() {
		if (!portalClient) return;
		vendorPortals = await portalClient.list().catch(() => []);
	}

	/**
	 * After new receipts came from a portal: linked to this booking already by
	 * the matching, or the one that fits offered for it.
	 *
	 * @param {string[]} ids the new receipts
	 * @param {string} [counts] what the fetch said
	 */
	function offerFrom(ids, counts = '') {
		vendorFit = null;
		if (!tx) return;
		const linkedHere = new Set(matchesOfTx(tx.id, app.matches).map((m) => m.receiptId));
		if (ids.some((id) => linkedHere.has(id))) {
			vendorNote = counts + t('zahlungen.detail.vendor.linked');
			return;
		}
		const fresh = app.receipts.filter((r) => ids.includes(r.id));
		vendorFit = fittingReceipt(tx, fresh, app.matches, {
			companyNames: app.matchingSettings?.companyNames ?? []
		});
		vendorNote =
			counts + (ids.length && !vendorFit ? t('zahlungen.detail.vendor.nothingFits') : '');
	}

	async function vendorLogin() {
		if (!portalClient || !vendorPortal) return;
		vendorBusy = true;
		error = null;
		try {
			await portalClient.login(vendorPortal.id);
			await loadPortals();
		} catch (e) {
			error = message(e);
		} finally {
			vendorBusy = false;
		}
	}

	async function vendorFetch() {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!portalClient || !bridgeAt || !vendorPortal || !store || !blobs || !tx) return;
		vendorBusy = true;
		error = null;
		vendorNote = null;
		vendorFit = null;
		try {
			const r = await fetchPortal({
				...bridgeAt,
				client: portalClient,
				portal: vendorPortal.id,
				name: vendorPortal.name,
				since: sinceFor(tx.bookedOn),
				store,
				blobs
			});
			await refreshNow();
			if (r.created.length) await runMatchingNow();
			offerFrom(
				r.created.map((x) => x.id),
				t('zahlungen.detail.vendor.result', {
					listed: r.answer.listed,
					new: r.counts.new,
					known: r.counts.known + r.answer.skipped
				})
			);
		} catch (e) {
			error = message(e);
		} finally {
			vendorBusy = false;
			void loadPortals();
		}
	}

	/** @param {File | undefined} file */
	async function uploadHere(file) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!file || !store || !blobs || !tx) return;
		uploading = true;
		error = null;
		uploadResult = null;
		const booking = tx;
		try {
			const r = await attachUpload({
				store,
				blobs,
				client,
				tx: booking,
				file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				ctx: { companyNames: app.matchingSettings?.companyNames ?? [] }
			});
			if (r.outcome !== 'linked' || !r.receipt) {
				uploadResult = {
					text: t(
						r.outcome === 'too-large'
							? 'zahlungen.detail.uploadTooLarge'
							: 'zahlungen.detail.uploadUnsupported'
					),
					warnings: []
				};
				return;
			}
			const receipt = r.receipt;
			const line = matchLine(
				{ state: 'confirmed', score: r.score, reasons: [...r.reasons, 'manual'] },
				{ tx: booking, receipt }
			);
			uploadResult = {
				text:
					t('zahlungen.detail.uploaded', { vendor: receiptVendor(receipt) }) +
					(r.duplicate ? t('zahlungen.detail.uploadedDuplicate') : '') +
					t('zahlungen.detail.uploadedPoints', { line }),
				warnings: [
					...r.warnings.map((w) =>
						t(`zahlungen.detail.warn.${w}`, {
							receipt: receiptAmount(receipt),
							tx: formatMoney(booking.amountCents ?? 0, booking.currency),
							number: receipt.invoiceNumber ?? ''
						})
					),
					...(r.extractError
						? [t('zahlungen.detail.uploadReadFailed', { error: r.extractError })]
						: [])
				]
			};
			await refreshNow();
			await runMatchingNow();
		} catch (e) {
			error = message(e);
		} finally {
			uploading = false;
		}
	}

	/** @param {Event} event */
	async function onUploadHere(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		await uploadHere(input.files?.[0]);
		input.value = '';
	}

	/** @param {DragEvent} event */
	async function onDropHere(event) {
		event.preventDefault();
		dropping = false;
		await uploadHere(event.dataTransfer?.files?.[0]);
	}

	async function checkFolder() {
		folderChecking = true;
		folderNote = null;
		error = null;
		try {
			const r = await checkFolderNow({ prompt: true });
			folderNote = !r?.permitted
				? t('zahlungen.detail.folderDenied')
				: r.created
					? t('zahlungen.detail.folderResult', { count: r.created })
					: t('zahlungen.detail.folderNothing');
		} catch (e) {
			error = message(e);
		} finally {
			folderChecking = false;
		}
	}

	/** @param {unknown} e */
	const message = (e) => (e instanceof Error ? e.message : String(e));

	/** @param {() => Promise<unknown>} fn */
	async function act(fn) {
		const store = currentStore();
		if (!store) return;
		busy = true;
		error = null;
		try {
			await fn();
			await refreshNow();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}

	/** @param {string} receiptId @param {number} score @param {string[]} reasons */
	const assign = (receiptId, score, reasons) =>
		act(async () => {
			const store = /** @type {any} */ (currentStore());
			await confirmMatch(store, {
				receiptId,
				transactionId: txId,
				score,
				reasons: [...reasons, 'manual']
			});
			assigning = false;
			if (vendorFit?.receipt.id === receiptId) {
				vendorFit = null;
				vendorNote = t('zahlungen.detail.vendor.assigned');
			}
		});

	async function suggestByAi() {
		if (!client || !tx) return;
		aiPicking = true;
		error = null;
		aiChoice = null;
		try {
			const candidates = assistCandidates(tx, choices);
			if (!candidates.length) {
				aiChoice = { pick: null, sent: [] };
				return;
			}
			const r = await client.matchAssist({
				booking: {
					counterparty: String(tx.counterparty ?? '').slice(0, 200),
					purpose: String(tx.purpose ?? '').slice(0, 1000),
					amount: formatMoney(tx.amountCents ?? 0, tx.currency).replace(/\s*EUR$/, ''),
					day: String(tx.bookedOn ?? '')
				},
				candidates
			});
			aiChoice = { pick: r.pick, sent: r.llm.sent };
			await recordEvent(currentStore()?.events, 'match-assist', {
				transactionId: tx.id,
				candidates: candidates.length,
				pick: r.pick?.confidence ?? null,
				model: r.llm.calls.at(-1)?.model ?? null,
				ms: r.llm.calls.reduce((n, c) => n + (c.ms ?? 0), 0),
				tokensTotal: r.llm.calls.reduce(
					(n, c) => n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
					0
				)
			});
		} catch (e) {
			error = message(e);
		} finally {
			aiPicking = false;
		}
	}

	/** @param {string} matchId */
	const unlink = (matchId) =>
		act(async () => unlinkMatch(/** @type {any} */ (currentStore()), matchId));

	const saveNoReceipt = () =>
		act(async () => {
			await setNoReceipt(/** @type {any} */ (currentStore()), txId, reason);
			askingReason = false;
			reason = '';
		});

	let ownName = $derived(
		tx && !classification && !tx.noReceipt
			? ownNameCandidate(tx, app.transactions, app.matchingSettings?.companyNames ?? [])
			: null
	);
	let ownNameDismissed = $state(false);
	const acceptOwnName = () =>
		act(async () => {
			if (!ownName) return;
			await addCompanyName(/** @type {any} */ (currentStore()), ownName.name);
			await runMatchingNow();
		});

	const notTransfer = () =>
		act(async () => {
			if (!classification?.counterBookingId) return;
			await rejectTransfer(
				/** @type {any} */ (currentStore()),
				txId,
				classification.counterBookingId
			);
			await runMatchingNow();
		});

	const bankFee = () =>
		act(async () => {
			await markBankFee(/** @type {any} */ (currentStore()), txId);
			await runMatchingNow();
		});

	const needsReceipt = () =>
		act(async () => setNoReceipt(/** @type {any} */ (currentStore()), txId, null));

	let query = $derived(tx ? privateSearchQuery(tx, app.partners ?? []) : null);
	/** @param {string} iso @param {number} days */
	const shift = (iso, days) =>
		formatDate(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10));
	let searchHint = $derived(
		query
			? t(query.text ? 'zahlungen.detail.privateHint' : 'zahlungen.detail.privateHintAmount', {
					text: query.text ?? '',
					amount: `${query.amount} €`,
					from: shift(query.around, -query.days),
					to: shift(query.around, query.days)
				})
			: ''
	);

	async function search() {
		if (!client || !query) return;
		searching = true;
		error = null;
		importNote = null;
		try {
			const { messages } = await client.mailSearch(query);
			const context = { word: query.text, around: query.around };
			hits = rankHits(messages, context);
			likely = likelyHit(hits, context);
			allHits = !likely;
			assist = null;
		} catch (e) {
			error = message(e);
		} finally {
			searching = false;
		}
	}

	/**
	 * "Mit KI weitersuchen" (bridge POST /mail/assist): new hits join the old
	 * ones; the model's pick, when there is one, goes first and is marked.
	 */
	async function assistSearch() {
		if (!client || !tx || !query) return;
		assisting = true;
		error = null;
		importNote = null;
		try {
			const r = await client.mailAssist({
				counterparty: String(tx.counterparty ?? '').trim() || query.text || '—',
				purpose: String(tx.purpose ?? ''),
				amount: query.amount,
				around: query.around,
				days: query.days,
				knownDomains: query.from
			});
			// Old and new hits by id, their matched criteria joined.
			/** @type {any[]} */
			const joined = [...(hits ?? [])];
			for (const m of r.messages) {
				const k = joined.findIndex((h) => h.id === m.id);
				if (k === -1) joined.push(m);
				else
					joined[k] = {
						...joined[k],
						matched: [...new Set([...(joined[k].matched ?? []), ...(m.matched ?? [])])]
					};
			}
			const context = { word: query.text, around: query.around };
			const ranked = rankHits(joined, context);
			const picked = r.pick ? (ranked.find((h) => h.id === r.pick?.id) ?? null) : null;
			hits = picked ? [picked, ...ranked.filter((h) => h !== picked)] : ranked;
			likely = picked ?? likelyHit(ranked, context);
			allHits = !likely;
			assist = r;
			await recordEvent(currentStore()?.events, 'mail-assist', {
				transactionId: tx.id,
				terms: r.terms.length,
				domains: r.domains.length,
				mails: r.messages.length,
				pick: r.pick?.confidence ?? null,
				model: r.llm.calls.at(-1)?.model ?? null,
				ms: r.llm.calls.reduce((n, c) => n + (c.ms ?? 0), 0),
				tokensTotal: r.llm.calls.reduce(
					(n, c) => n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
					0
				)
			});
		} catch (e) {
			error = message(e);
		} finally {
			assisting = false;
		}
	}

	/**
	 * After a mail was taken over from this booking's search: when the matching
	 * did not link one of its receipts here, the best one that is free is linked
	 * here as the person's decision (they searched for this booking), like an
	 * upload to it. Returns what happened, for the note.
	 *
	 * @param {any} store
	 * @param {string} mailId
	 * @returns {Promise<{ outcome: 'here' | 'linked' | 'elsewhere' | 'unverified' | 'none', score?: number }>}
	 */
	async function linkHitHere(store, mailId) {
		const mine = app.receipts.filter((r) => !r.deleted && r.mailId === mailId);
		const linked = mine.map((r) => ({ r, m: matchOfReceipt(r.id, app.matches) }));
		if (linked.some((x) => x.m?.transactionId === txId)) return { outcome: 'here' };
		const free = linked.filter(
			(x) => !x.m && !needsConfirmation(x.r) && x.r.status !== 'ignoriert'
		);
		const best = choices
			.filter((c) => free.some((x) => x.r.id === c.receipt.id))
			.sort((a, b) => b.score - a.score)[0];
		if (best) {
			await confirmMatch(store, {
				receiptId: best.receipt.id,
				transactionId: txId,
				score: best.score,
				reasons: [...best.reasons, 'manual']
			});
			await refreshNow();
			return { outcome: 'linked', score: best.score };
		}
		if (linked.some((x) => x.m)) return { outcome: 'elsewhere' };
		if (mine.some((r) => needsConfirmation(r))) return { outcome: 'unverified' };
		return { outcome: 'none' };
	}

	/** @param {any} hit */
	async function importHit(hit) {
		const store = currentStore();
		const blobs = currentBlobs();
		if (!store || !blobs || !client) return;
		importingId = hit.id;
		error = null;
		importNote = null;
		hitMailId = null;
		try {
			/** @type {any[]} */
			const created = [];
			// How it was found (receipts/origin.js): by the KI search, or the plain one.
			const found = assist;
			const byAi = found?.messages.some((m) => m.id === hit.id) ?? false;
			const pick = found?.pick && found.pick.id === hit.id ? found.pick : null;
			const model = found?.llm.calls.at(-1)?.model ?? null;
			await importMailMessages({
				receipts: store.receipts,
				blobs,
				client,
				messages: [hit],
				created,
				events: store.events,
				foundBy: byAi
					? {
							kind: 'mail-assist',
							...(pick ? { confidence: pick.confidence, reason: pick.reason } : {}),
							...(model ? { model: String(model) } : {})
						}
					: { kind: 'mail-search' }
			});
			if (created.length === 0) {
				// Already in the books (the accounting fetch, an earlier click): read what
				// is not read yet, match, and offer it for this booking below.
				for (const record of app.receipts.filter((r) => !r.deleted && r.mailId === hit.id)) {
					if (record.extraction || needsConfirmation(record)) continue;
					if (String(record.mime).startsWith('image/')) continue;
					await extractReceipt({
						client,
						receipts: store.receipts,
						blobs,
						record,
						events: store.events
					});
				}
				await runMatchingNow();
				hitMailId = hit.id;
				const r = await linkHitHere(store, hit.id);
				importNote =
					t('zahlungen.detail.privateDuplicate') +
					' ' +
					t(`zahlungen.detail.hitOutcome.${r.outcome}`, { score: r.score ?? 0 });
				return;
			}
			let unverified = false;
			for (const record of created) {
				if (needsConfirmation(record)) {
					unverified = true;
					continue;
				}
				if (String(record.mime).startsWith('image/')) continue;
				await extractReceipt({
					client,
					receipts: store.receipts,
					blobs,
					record,
					events: store.events
				});
			}
			await runMatchingNow();
			hitMailId = hit.id;
			const r = await linkHitHere(store, hit.id);
			importNote =
				unverified && r.outcome !== 'here' && r.outcome !== 'linked'
					? t('zahlungen.detail.privateImportedUnverified')
					: t('zahlungen.detail.privateImported') +
						' ' +
						t(`zahlungen.detail.hitOutcome.${r.outcome}`, { score: r.score ?? 0 });
		} catch (e) {
			error = message(e);
			await refreshNow();
		} finally {
			importingId = null;
		}
	}

	/** @param {any} hit @returns {{ name: string, kind: string }[]} */
	const hitFiles = (hit) =>
		(hit.attachments ?? []).filter(
			(/** @type {any} */ a) => a.kind === 'pdf' || a.kind === 'image'
		);

	/** @param {KeyboardEvent} e */
	function onKey(e) {
		if (e.key === 'Escape') onclose();
	}

	/** @param {import('$lib/store/repository.js').StoredRecord} r */
	const receiptAmount = (r) =>
		typeof r.amountCents === 'number' ? formatMoney(r.amountCents, r.currency ?? 'EUR') : '—';
	/** @param {import('$lib/store/repository.js').StoredRecord} r */
	const receiptDay = (r) => {
		const d = receiptDate(r);
		return d ? formatDate(d) : '';
	};
	/** @param {string[]} reasons */
	const reasonText = (reasons) => (reasons ?? []).map((x) => t(`matching.reason.${x}`)).join(' · ');

	/** @param {Record<string, any>} c */
	function coverageText(c) {
		if (!c) return '';
		return t(`matching.kind.${c.kind}`, { reason: c.reason ?? '' });
	}

	const button =
		'rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50';
	const primary =
		'rounded-md bg-coral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div class="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onclick={onclose}>
	<div
		bind:this={panel}
		class="h-full w-full max-w-xl overflow-y-auto bg-bg px-4 py-4 shadow-xl sm:px-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tx-detail-title"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={onKey}
		ondragover={(e) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault();
				dropping = true;
			}
		}}
		ondragleave={(e) => {
			if (e.currentTarget === e.target) dropping = false;
		}}
		ondrop={onDropHere}
		data-testid="tx-detail"
	>
		{#if dropping}
			<div
				class="pointer-events-none fixed inset-y-0 right-0 z-10 flex w-full max-w-xl items-center justify-center border-2 border-dashed border-cyan-800 bg-surface/90 text-lg font-semibold text-heading dark:border-cyan"
			>
				{t('zahlungen.detail.drop')}
			</div>
		{/if}
		{#if !tx}
			<p class="text-sm text-faint">{t('zahlungen.noneForSelection')}</p>
		{:else}
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<p class="text-xs font-semibold tracking-wide text-faint uppercase">
						{t('zahlungen.detail.title')}
					</p>
					<h2
						id="tx-detail-title"
						class="text-xl font-bold break-words text-heading"
						data-testid="tx-detail-counterparty"
					>
						{tx.counterparty || '—'}
					</h2>
				</div>
				<button type="button" class={button} onclick={onclose} data-testid="tx-detail-close"
					>{t('zahlungen.detail.close')}</button
				>
			</div>
			<p
				class="mt-2 font-mono text-2xl font-semibold tabular-nums {(tx.amountCents ?? 0) < 0
					? 'text-red-700 dark:text-red-400'
					: 'text-emerald-700 dark:text-emerald-400'}"
				data-testid="tx-detail-amount"
			>
				{formatMoney(tx.amountCents ?? 0, tx.currency)}
			</p>

			<dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
				<dt class="text-faint">{t('zahlungen.detail.date')}</dt>
				<dd class="text-heading" data-testid="tx-detail-date">{formatDate(tx.bookedOn)}</dd>
				{#if tx.valueDate && tx.valueDate !== tx.bookedOn}
					<dt class="text-faint">{t('zahlungen.detail.valueDate')}</dt>
					<dd class="text-heading">{formatDate(tx.valueDate)}</dd>
				{/if}
				{#if account}
					<dt class="text-faint">{t('zahlungen.detail.account')}</dt>
					<dd class="text-heading">{accountLabel(account)}</dd>
				{/if}
				{#if quantityText(tx)}
					<dt class="text-faint">{t('zahlungen.detail.quantity')}</dt>
					<dd class="font-mono text-heading tabular-nums" data-testid="tx-detail-quantity">
						{quantityText(tx)}
					</dd>
					{#if valuationText(tx)}
						<dt class="text-faint">{t('zahlungen.detail.valuation')}</dt>
						<dd class="text-heading" data-testid="tx-detail-valuation">{valuationText(tx)}</dd>
					{/if}
				{/if}
				{#if tx.bookingType}
					<dt class="text-faint">{t('zahlungen.detail.bookingType')}</dt>
					<dd class="text-heading">{tx.bookingType}</dd>
				{/if}
				{#if tx.counterpartyIban}
					<dt class="text-faint">{t('zahlungen.detail.iban')}</dt>
					<dd class="font-mono text-xs break-all text-heading">{tx.counterpartyIban}</dd>
				{/if}
			</dl>
			{#if tx.purpose}
				<h3 class="mt-3 text-xs font-semibold tracking-wide text-faint uppercase">
					{t('zahlungen.detail.purpose')}
				</h3>
				<p
					class="mt-1 rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-text"
					data-testid="tx-detail-purpose"
				>
					{tx.purpose}
				</p>
			{/if}
			{#if portal}
				<p class="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="tx-portal">
					<a
						href={portal.url}
						target="_blank"
						rel="noopener noreferrer"
						class={button}
						data-testid="tx-portal-link">{t('zahlungen.detail.portal')}</a
					>
					<span class="font-mono text-xs text-heading" data-testid="tx-portal-host"
						>{portal.host}</span
					>
					<span class="text-xs text-faint"
						>({portal.from === 'partner'
							? t('zahlungen.detail.portalFromPartner')
							: t('zahlungen.detail.portalFromPurpose')})</span
					>
				</p>
			{/if}

			<section class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
				<h3 class="text-sm font-semibold text-heading">{t('zahlungen.detail.receipts')}</h3>
				{#if classification && !tx.receiptId}
					<p class="mt-1 text-sm text-text" data-testid="tx-detail-classification">
						{coverageText(classification)}
					</p>
				{/if}
				{#if ruleLine && !tx.receiptId}
					<div
						class="mt-2 rounded-md border border-l-4 border-border border-l-cyan-800 bg-surface-2 px-3 py-2 dark:border-l-cyan"
						data-testid="tx-why-rule"
					>
						<p class="text-xs font-semibold text-heading">{t('explain.whyNone')}</p>
						<p class="mt-0.5 text-sm text-text" data-testid="tx-why-rule-line">{ruleLine}</p>
						{#if classification?.via === 'counter-booking' && classification.counterBookingId && !tx.noReceipt}
							<div class="mt-1.5 flex flex-wrap gap-3 text-sm">
								<button
									type="button"
									class="underline"
									onclick={() =>
										classification?.counterBookingId && onopen(classification.counterBookingId)}
									data-testid="tx-counter-open">{t('zahlungen.detail.counterOpen')}</button
								>
								<button
									type="button"
									class="text-faint underline hover:text-heading"
									onclick={notTransfer}
									disabled={busy}
									data-testid="tx-not-transfer">{t('zahlungen.detail.notTransfer')}</button
								>
							</div>
						{/if}
					</div>
				{/if}
				{#if ownName && !ownNameDismissed}
					{@const acc = app.accounts.find((a) => a.id === ownName.other.accountId)}
					<div
						class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
						data-testid="tx-own-name"
					>
						<p class="text-text">
							{t('zahlungen.detail.ownName', {
								name: ownName.name,
								date: formatDate(ownName.other.bookedOn),
								account: acc ? `${accountLabel(acc)}` : '—'
							})}
						</p>
						<div class="mt-1.5 flex flex-wrap gap-3">
							<button
								type="button"
								class={primary}
								onclick={acceptOwnName}
								disabled={busy}
								data-testid="tx-own-name-yes">{t('zahlungen.detail.ownNameYes')}</button
							>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								onclick={() => (ownNameDismissed = true)}
								data-testid="tx-own-name-no">{t('zahlungen.detail.ownNameNo')}</button
							>
						</div>
					</div>
				{/if}
				{#if waitDays !== null}
					<p class="mt-1 text-sm text-text" data-testid="tx-waiting">
						{waitDays === 1 ? t('explain.waitingOne') : t('explain.waiting', { days: waitDays })}
					</p>
				{/if}
				{#each openQuestions as { q, items } (q.id)}
					<div
						class="mt-2 rounded-md border border-l-4 border-border border-l-coral-700 bg-surface-2 px-3 py-2"
						data-testid="tx-why-question"
					>
						<p class="text-xs font-semibold text-heading">{t('explain.question')}</p>
						{#if items.length === 0}
							<p class="mt-0.5 text-sm text-text">{t('explain.noCandidates')}</p>
						{:else}
							<ul class="mt-0.5 text-sm text-text">
								{#each items as item, i (i)}
									<li data-testid="tx-why-candidate">
										<span class="font-medium text-heading"
											>{item.receipt ? receiptVendor(item.receipt) : '—'}</span
										>
										· {candidateLine(item.candidate, { tx, receipt: item.receipt })}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
				{#if tx.noReceipt}
					<p class="mt-1 text-sm text-text" data-testid="tx-detail-no-receipt">
						{t('matching.kind.no-receipt', { reason: tx.noReceipt.reason ?? '' })}
					</p>
					<button type="button" class="mt-2 {button}" onclick={needsReceipt} disabled={busy}
						>{t('zahlungen.detail.needsReceipt')}</button
					>
				{/if}
				{#each linked as l (l.match.id)}
					{@const r = l.receipt}
					<div class="mt-2 border-t border-border pt-2" data-testid="tx-linked-receipt">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="font-medium text-heading" data-testid="tx-linked-vendor"
								>{receiptVendor(r)}</span
							>
							<span class="font-mono text-sm text-heading tabular-nums">{receiptAmount(r)}</span>
						</div>
						<p class="text-xs text-faint">
							{[receiptDay(r), r.invoiceNumber, r.fileName].filter(Boolean).join(' · ')}
						</p>
						<p class="mt-0.5 text-xs text-faint" data-testid="tx-linked-state">
							{t(`matching.state.${l.match.state}`)}{l.match.score !== null &&
							l.match.score !== undefined
								? ` · ${t('matching.score', { score: l.match.score })}`
								: ''}{l.match.reasons?.length ? ` · ${reasonText(l.match.reasons)}` : ''}
						</p>
						<div
							class="mt-2 rounded-md border border-l-4 border-border border-l-cyan-800 bg-surface-2 px-3 py-2 dark:border-l-cyan"
							data-testid="tx-why"
						>
							<p class="text-xs font-semibold text-heading">{t('explain.why')}</p>
							<p class="mt-0.5 text-sm text-text" data-testid="tx-why-line">
								{matchLine(l.match, { tx, receipt: r })}
							</p>
							<p class="mt-0.5 text-xs text-faint">{t('explain.notAi')}</p>
							<TechnicalNote
								class="mt-2"
								testid="tx-why-technical"
								lines={[
									pointsBreakdown(l.match.reasons, l.match.score),
									thresholdsText(),
									...list('explain.technical')
								].filter(Boolean)}
							/>
						</div>
						<div class="mt-2"><ReceiptPreview receipt={r} /></div>
						<button
							type="button"
							class="mt-2 {button}"
							onclick={() => unlink(l.match.id)}
							disabled={busy}
							data-testid="tx-unlink">{t('zahlungen.detail.unlink')}</button
						>
					</div>
				{:else}
					{#if !classification && !tx.noReceipt}
						<p class="mt-1 text-sm text-text" data-testid="tx-detail-missing">
							{t('zahlungen.detail.noReceipt')}
						</p>
					{/if}
				{/each}

				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						class={primary}
						onclick={() => (assigning = !assigning)}
						disabled={busy}
						aria-expanded={assigning}
						data-testid="tx-assign">{t('zahlungen.detail.assign')}</button
					>
					{#if !tx.noReceipt}
						<button
							type="button"
							class={button}
							onclick={() => (askingReason = !askingReason)}
							disabled={busy}
							aria-expanded={askingReason}
							data-testid="tx-no-receipt">{t('zahlungen.detail.noReceiptNeeded')}</button
						>
					{/if}
					{#if !tx.noReceipt && !classification && (tx.amountCents ?? 0) < 0}
						<button
							type="button"
							class={button}
							onclick={bankFee}
							disabled={busy}
							title={t('zahlungen.detail.bankFeeTitle')}
							data-testid="tx-bank-fee">{t('zahlungen.detail.bankFee')}</button
						>
					{/if}
				</div>

				<div class="mt-3 border-t border-border pt-3" data-testid="tx-upload">
					<label
						class="{button} inline-flex cursor-pointer items-center gap-1.5"
						title={t('ai.upload')}
						data-testid="tx-upload-label"
					>
						<AiMark />
						{uploading ? t('zahlungen.detail.uploading') : t('zahlungen.detail.upload')}
						<input
							type="file"
							class="sr-only"
							accept=".pdf,application/pdf,image/png,image/jpeg,image/gif,image/webp"
							disabled={uploading || busy}
							onchange={onUploadHere}
							data-testid="tx-upload-input"
						/>
					</label>
					{#if hasFolder}
						<button
							type="button"
							class="ml-2 {button}"
							onclick={checkFolder}
							disabled={folderChecking}
							title={t('zahlungen.detail.folderHint')}
							data-testid="tx-folder-check"
							>{folderChecking
								? t('zahlungen.detail.folderChecking')
								: t('zahlungen.detail.folderCheck')}</button
						>
					{/if}
					<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.uploadHint')}</p>
					{#if uploadResult}
						<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-upload-result">
							{uploadResult.text}
						</p>
						{#each uploadResult.warnings as w (w)}
							<p class="mt-1 text-sm text-danger" data-testid="tx-upload-warning">⚠ {w}</p>
						{/each}
					{/if}
					{#if folderNote}
						<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-folder-result">
							{folderNote}
						</p>
					{/if}
				</div>

				{#if askingReason}
					<form
						class="mt-2 flex flex-wrap items-end gap-2"
						onsubmit={(e) => {
							e.preventDefault();
							saveNoReceipt();
						}}
					>
						<label class="flex min-w-48 flex-1 flex-col text-sm">
							<span class="text-faint">{t('zahlungen.detail.reason')}</span>
							<input
								class="mt-1 rounded-md border px-2 py-1.5 text-sm"
								bind:value={reason}
								placeholder={t('zahlungen.detail.reasonPlaceholder')}
								data-testid="tx-no-receipt-reason"
							/>
						</label>
						<button type="submit" class={primary} disabled={busy} data-testid="tx-no-receipt-save"
							>{t('zahlungen.detail.save')}</button
						>
					</form>
				{/if}

				{#if assigning}
					<div class="mt-3" data-testid="tx-choices">
						{#if client && choices.length}
							<div class="mb-2" data-testid="tx-ai-choice">
								<button
									type="button"
									class="inline-flex items-center gap-1.5 {button}"
									onclick={suggestByAi}
									disabled={aiPicking || busy}
									title={t('zahlungen.detail.aiChoiceTitle')}
									data-testid="tx-ai-choice-ask"
									><AiMark />{aiPicking
										? t('zahlungen.detail.aiChoiceBusy')
										: t('zahlungen.detail.aiChoice')}</button
								>
								{#if aiChoice && !aiChoice.pick}
									<p class="mt-1 text-sm text-faint" data-testid="tx-ai-choice-none">
										{t('zahlungen.detail.aiChoiceNone')}
									</p>
								{/if}
								{#if aiChoiceRow && aiChoice?.pick}
									<div
										class="mt-2 flex items-center gap-2 rounded-md border border-cyan-500 px-3 py-2"
										data-testid="tx-ai-choice-pick"
									>
										<span class="min-w-0 flex-1">
											<span
												class="flex items-center gap-1 text-xs font-medium text-cyan-800 dark:text-cyan-200"
												><AiMark />{t('zahlungen.detail.aiPick', {
													confidence: t(
														`zahlungen.detail.aiConfidence.${aiChoice.pick.confidence}`
													),
													reason: aiChoice.pick.reason
												})}</span
											>
											<span class="block truncate text-sm font-medium text-heading"
												>{receiptVendor(aiChoiceRow.receipt)}</span
											>
											<span class="block truncate text-xs text-faint"
												>{[
													receiptAmount(aiChoiceRow.receipt),
													receiptDay(aiChoiceRow.receipt),
													aiChoiceRow.receipt.invoiceNumber
												]
													.filter(Boolean)
													.join(' · ')}</span
											>
										</span>
										<button
											type="button"
											class={primary}
											onclick={() =>
												aiChoiceRow &&
												assign(aiChoiceRow.receipt.id, aiChoiceRow.score, aiChoiceRow.reasons)}
											disabled={busy}
											data-testid="tx-ai-choice-assign">{t('zahlungen.detail.choose')}</button
										>
									</div>
								{/if}
								{#if aiChoice?.sent.length}
									<details class="mt-1 text-xs text-faint">
										<summary class="cursor-pointer">{t('zahlungen.detail.aiSent')}</summary>
										{#each aiChoice.sent as sent, i (i)}
											<pre
												class="mt-1 max-h-40 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono break-words whitespace-pre-wrap">{sent}</pre>
										{/each}
									</details>
								{/if}
							</div>
						{/if}
						<h4 class="text-xs font-semibold tracking-wide text-faint uppercase">
							{t('zahlungen.detail.suggestions')}
						</h4>
						{#each showAll ? choices : suggestions as c (c.receipt.id)}
							<div
								class="mt-1 flex items-center gap-2 border-t border-border py-2"
								data-testid="tx-choice"
								data-suggested={c.suggested ? 'true' : 'false'}
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium text-heading"
										>{receiptVendor(c.receipt)}</span
									>
									<span class="block truncate text-xs text-faint"
										>{[receiptAmount(c.receipt), receiptDay(c.receipt), c.receipt.invoiceNumber]
											.filter(Boolean)
											.join(' · ')}{c.score > 0
											? ` · ${t('matching.score', { score: c.score })} (${reasonText(c.reasons)})`
											: ''}</span
									>
								</span>
								<button
									type="button"
									class={button}
									onclick={() => assign(c.receipt.id, c.score, c.reasons)}
									disabled={busy}
									data-testid="tx-choose">{t('zahlungen.detail.choose')}</button
								>
							</div>
						{:else}
							<p class="mt-1 text-sm text-faint">{t('zahlungen.detail.noChoices')}</p>
						{/each}
						{#if rest.length}
							<button
								type="button"
								class="mt-2 text-sm text-text underline"
								onclick={() => (showAll = !showAll)}
								aria-expanded={showAll}
								data-testid="tx-show-all"
								>{t('zahlungen.detail.allReceipts')} ({rest.length})</button
							>
						{/if}
					</div>
				{/if}
			</section>

			<BookingBlock {tx} />

			<section class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
				<h3 class="text-sm font-semibold text-heading">{t('zahlungen.detail.privateSearch')}</h3>
				{#if !client}
					<p class="mt-1 text-sm text-faint">{t('zahlungen.detail.noBridge')}</p>
				{:else}
					<p class="mt-1 text-xs text-faint" data-testid="tx-private-hint">{searchHint}</p>
					<button
						type="button"
						class="mt-2 {button}"
						onclick={search}
						disabled={searching || busy}
						data-testid="tx-private-search"
						>{searching
							? t('zahlungen.detail.privateSearching')
							: t('zahlungen.detail.privateSearch')}</button
					>
					{#if hits}
						{#if hits.length === 0}
							<p class="mt-2 text-sm text-faint" data-testid="tx-private-none">
								{t('zahlungen.detail.privateNone')}
							</p>
						{:else}
							<p class="mt-2 text-xs text-faint">
								{t('zahlungen.detail.privateHits', { count: hits.length })}
							</p>
							<ul class="mt-1 divide-y divide-border">
								{#each allHits ? hits : hits.slice(0, 1) as hit (hit.id)}
									{@const files = hitFiles(hit)}
									<li class="py-2" data-testid="tx-private-hit">
										{#if assist?.pick && hit.id === assist.pick.id}
											<p
												class="mb-1 inline-flex items-center gap-1 rounded border border-cyan-500 px-2 py-0.5 text-xs text-cyan-800 dark:text-cyan-200"
												data-testid="tx-private-ai-pick"
											>
												<AiMark />
												{t('zahlungen.detail.aiPick', {
													confidence: t(`zahlungen.detail.aiConfidence.${assist.pick.confidence}`),
													reason: assist.pick.reason
												})}
											</p>
										{:else if likely && hit.id === likely.id}
											<p
												class="mb-1 inline-block rounded border border-success px-2 py-0.5 text-xs text-success"
												data-testid="tx-private-likely"
											>
												{t('zahlungen.detail.privateLikely')}
											</p>
										{/if}
										<p class="text-sm font-medium break-words text-heading">{hit.subject}</p>
										<p class="text-xs break-all text-faint">
											{hit.from?.name ?? ''} &lt;{hit.from?.address ?? ''}&gt; · {hit.receivedAt
												? formatDate(String(hit.receivedAt).slice(0, 10))
												: ''}
										</p>
										<p class="text-xs text-text" data-testid="tx-private-criteria">
											{t('zahlungen.detail.privateMatched', {
												criteria: hitCriteria(hit)
													.map((c) => t(`zahlungen.detail.criteria.${c}`))
													.join(' + ')
											})} · {files.length
												? t('zahlungen.detail.privateAttachments', {
														names: files.map((a) => a.name).join(', ')
													})
												: t('zahlungen.detail.privateNoAttachment')}
											{#if hit.auth?.verdict !== 'pass' && !hit.outgoing}
												· <span class="text-danger">⚠ {t('belege.unverified')}</span>
											{/if}
										</p>
										<button
											type="button"
											class="mt-1 inline-flex items-center gap-1.5 {button}"
											onclick={() => importHit(hit)}
											disabled={importingId !== null}
											title={t('ai.import')}
											data-testid="tx-private-import"
											><AiMark />{importingId === hit.id
												? t('zahlungen.detail.privateImporting')
												: t('zahlungen.detail.privateImport')}</button
										>
									</li>
								{/each}
							</ul>
							{#if !allHits && hits.length > 1}
								<button
									type="button"
									class="mt-1 text-sm underline"
									onclick={() => (allHits = true)}
									data-testid="tx-private-more"
									>{t('zahlungen.detail.privateMore', { count: hits.length - 1 })}</button
								>
							{/if}
						{/if}
						{#if assist}
							<p class="mt-2 text-xs text-faint" data-testid="tx-private-ai-summary">
								<AiMark />
								{t('zahlungen.detail.aiSummary', {
									terms: assist.terms.map((x) => `„${x}“`).join(', ') || '—',
									domains: assist.domains.join(', ') || '—',
									count: assist.messages.length
								})}
							</p>
							<details class="mt-1 text-xs text-faint" data-testid="tx-private-ai-sent">
								<summary class="cursor-pointer">{t('zahlungen.detail.aiSent')}</summary>
								{#each assist.llm.sent as sent, i (i)}
									<pre
										class="mt-1 max-h-40 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono break-words whitespace-pre-wrap">{sent}</pre>
								{/each}
							</details>
						{:else if !likely}
							<button
								type="button"
								class="mt-2 inline-flex items-center gap-1.5 {button}"
								onclick={assistSearch}
								disabled={assisting || busy}
								title={t('zahlungen.detail.aiSearchTitle')}
								data-testid="tx-private-ai"
							>
								<AiMark />
								{assisting ? t('zahlungen.detail.aiSearching') : t('zahlungen.detail.aiSearch')}
							</button>
							<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.aiSearchHint')}</p>
						{/if}
					{/if}
					{#if importNote}
						<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-private-result">
							{importNote}
						</p>
					{/if}
					{#if hitReceipts.length}
						<ul class="mt-1 divide-y divide-border text-sm" data-testid="tx-private-receipts">
							{#each hitReceipts as { receipt, match } (receipt.id)}
								{@const other = match
									? app.transactions.find((x) => x.id === match.transactionId)
									: null}
								<li
									class="flex flex-wrap items-center gap-2 py-1.5"
									data-testid="tx-private-receipt"
								>
									<span class="flex-1 text-text"
										>{receiptVendor(receipt)} · {receiptAmount(receipt)} · {receipt.fileName ??
											t('belege.textMail')}</span
									>
									{#if match?.transactionId === txId}
										<span class="text-success" data-testid="tx-private-receipt-here"
											>{t('zahlungen.detail.receiptHere')}</span
										>
									{:else if match}
										<button
											type="button"
											class="underline"
											onclick={() => onopen(match.transactionId)}
											data-testid="tx-private-receipt-elsewhere"
											>{t('zahlungen.detail.receiptElsewhere', {
												name: other?.counterparty || '—',
												date: other?.bookedOn ? formatDate(other.bookedOn) : '?'
											})}</button
										>
									{:else if needsConfirmation(receipt)}
										<span class="text-danger">⚠ {t('zahlungen.detail.receiptConfirmFirst')}</span>
									{:else}
										{@const c = choices.find((x) => x.receipt.id === receipt.id)}
										<button
											type="button"
											class={primary}
											onclick={() => assign(receipt.id, c?.score ?? 0, c?.reasons ?? [])}
											disabled={busy}
											data-testid="tx-private-receipt-assign"
											>{t('zahlungen.detail.receiptAssign')}{c
												? t('zahlungen.detail.receiptPoints', { score: c.score })
												: ''}</button
										>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>

			<section
				class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
				data-testid="tx-vendor"
			>
				<h3 class="text-sm font-semibold text-heading">{t('zahlungen.detail.vendor.title')}</h3>
				{#if (tx.amountCents ?? 0) > 0}
					<p class="mt-1 text-sm text-faint" data-testid="tx-vendor-income">
						{t('zahlungen.detail.vendor.income')}
					</p>
				{:else if !portalClient}
					<p class="mt-1 text-sm text-faint">{t('zahlungen.detail.vendor.noBridge')}</p>
				{:else if vendorPortal}
					<p class="mt-1 text-xs text-faint" data-testid="tx-vendor-portal">
						{t('zahlungen.detail.vendor.found', {
							name: vendorPortal.name,
							since: sinceFor(tx.bookedOn)
						})}
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#if vendorPortal.state !== 'logged-in'}
							<button
								type="button"
								class={button}
								onclick={vendorLogin}
								disabled={vendorBusy || busy}
								data-testid="tx-vendor-login"
								>{t('zahlungen.detail.vendor.login', { name: vendorPortal.name })}</button
							>
						{/if}
						{#if vendorPortal.state !== 'never'}
							<button
								type="button"
								class="inline-flex items-center gap-1.5 {button}"
								onclick={vendorFetch}
								disabled={vendorBusy || busy}
								title={t('ai.portal')}
								data-testid="tx-vendor-fetch"
								><AiMark />{vendorBusy
									? t('zahlungen.detail.vendor.fetching')
									: t('zahlungen.detail.vendor.fetch', { name: vendorPortal.name })}</button
							>
						{/if}
					</div>
				{:else if recordingVendor && bridgeAt}
					<div class="mt-2">
						<NewPortal
							url={bridgeAt.url}
							token={bridgeAt.token}
							name={tx.counterparty ?? ''}
							startUrl={portal ? `https://${portal.host}` : ''}
							testid="tx-vendor-new"
							onimported={(ids) => {
								offerFrom(ids);
								void loadPortals();
							}}
						/>
					</div>
				{:else}
					<p class="mt-1 text-xs text-faint">
						{t('zahlungen.detail.vendor.none', { name: tx.counterparty || '—' })}
					</p>
					<button
						type="button"
						class="mt-2 {button}"
						onclick={() => (recordingVendor = true)}
						disabled={busy}
						data-testid="tx-vendor-record">{t('portals.new.button')}</button
					>
				{/if}
				{#if vendorNote}
					<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-vendor-result">
						{vendorNote}
					</p>
				{/if}
				{#if vendorFit}
					{@const fit = vendorFit}
					<div
						class="mt-2 rounded-md border border-l-4 border-border border-l-cyan-800 bg-surface-2 px-3 py-2 dark:border-l-cyan"
						data-testid="tx-vendor-fit"
					>
						<p class="text-sm text-heading">
							{t('zahlungen.detail.vendor.fits', {
								vendor: receiptVendor(fit.receipt),
								amount: receiptAmount(fit.receipt),
								date: receiptDay(fit.receipt) || '—'
							})}
						</p>
						<p class="mt-0.5 text-xs text-faint">
							{t('matching.score', { score: fit.score })} · {reasonText(fit.reasons)}
						</p>
						<button
							type="button"
							class="mt-2 {primary}"
							onclick={() => assign(fit.receipt.id, fit.score, fit.reasons)}
							disabled={busy}
							data-testid="tx-vendor-assign">{t('zahlungen.detail.vendor.assign')}</button
						>
					</div>
				{/if}
				<TechnicalNote
					class="mt-2"
					testid="tx-vendor-technical"
					lines={list('zahlungen.detail.vendor.technical')}
				/>
			</section>

			{#if error}
				<p class="mt-3 text-sm text-danger" role="alert" data-testid="tx-detail-error">{error}</p>
			{/if}

			<section class="mt-4">
				<h3 class="text-sm font-semibold text-heading">
					{t(
						(tx.amountCents ?? 0) > 0 ? 'zahlungen.detail.othersIn' : 'zahlungen.detail.othersOut',
						{
							name: tx.counterparty || '—'
						}
					)}
				</h3>
				{#if others.length === 0}
					<p class="mt-1 text-sm text-faint">{t('zahlungen.detail.othersNone')}</p>
				{:else}
					<ul
						class="mt-1 divide-y divide-border rounded-lg border border-border bg-surface shadow-sm"
					>
						{#each others as o (o.id)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
									onclick={() => onopen(o.id)}
									data-testid="tx-other"
								>
									<span class="flex-1 text-text">{formatDate(o.bookedOn)}</span>
									<span
										class="rounded border px-1.5 py-0.5 text-xs {isTxCovered(o, app.classifications)
											? 'border-success/30 bg-success/10 text-success'
											: 'border-border bg-surface-2 text-faint'}"
										>{coverageBadge(o, app.classifications)
											? t(`matching.badge.${coverageBadge(o, app.classifications)}`)
											: t('zahlungen.detail.withoutReceipt')}</span
									>
									<span class="font-mono text-heading tabular-nums"
										>{formatMoney(o.amountCents ?? 0, o.currency)}</span
									>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</div>
