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
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ReceiptPreview from './ReceiptPreview.svelte';
	import ReceiptPeek from './ReceiptPeek.svelte';
	import { canPeek, createPeek } from './receipts/peek.js';
	import BookingBlock from './BookingBlock.svelte';
	import TechnicalNote from './TechnicalNote.svelte';
	import CopyButton from './CopyButton.svelte';
	import { transferFields } from './matching/transfer-fields.js';
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
	import { learnedVendors, nameAddress } from './matching/partners.js';
	import { groupIban, ownIbanSuggestionFor, ownIbanSuggestions } from './matching/own-iban.js';
	import { instalmentOf, settlement as invoiceSettlement } from './matching/instalments.js';
	import { attachUpload, moveReceipt } from './receipts/attach.js';
	import EigenbelegForm from './receipts/EigenbelegForm.svelte';
	import { folderSupported, savedFolder } from './receipts/folder.js';
	import { createBridgeClient } from './bridge/client.js';
	import { getSetting } from './store/settings.js';
	import {
		accountLabel,
		displayPurpose,
		formatBookingTime,
		formatDate,
		formatMoney,
		formatTxAmount,
		txDirection
	} from './bank/format.js';
	import { tradeArrow, tradeSides, tradeSideWhat } from './exchanges/trades.js';
	import { acknowledgeImportChange, setManualRate } from './booking/actions.js';
	import { isBookingConfirmed } from './booking/suggest.js';
	import { quantityText, rateInputPlaceholder, valuationText } from './assets/valuation.js';
	import { addressExplorerUrl, safeExplorerUrl, walletChain } from './wallets/chains.js';
	import { chainOfHash, hashUrl } from './assets/hash-chain.js';
	import { normalizeTxRef } from './matching/context.js';
	import { renderSVG } from 'uqr';
	import {
		addressBook,
		payeeName,
		shortAddress,
		walletParties,
		walletPurposeExtra
	} from './bank/payee.js';
	import { eventCalls } from './stats/usage.js';
	import { relatedIndex } from './matching/related.js';
	import { scamContext, scamSigns } from './receipts/scam.js';
	import { receiptDate, receiptVendor } from './receipts/view.js';
	import { importMailMessages, needsConfirmation } from './receipts/import.js';
	import { extractReceipt } from './receipts/extract.js';
	import {
		addCompanyName,
		addOwnIban,
		rejectOwnIban,
		confirmMatch,
		markBankFee,
		linkRefund,
		linkTransfer,
		linkSwap,
		unlinkSwap,
		linkMigration,
		unlinkMigration,
		rejectRefund,
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
		memoOf,
		privateSearchQuery,
		searchAmount,
		rankHits,
		likelyHit,
		assistCandidates,
		assistEmptyReason,
		matchOfReceipt,
		ownNameCandidate,
		receiptChoices,
		transferCandidates,
		migrationCandidates
	} from './matching/view.js';
	import {
		candidateLine,
		classificationLine,
		matchLine,
		pointsBreakdown,
		thresholdsText
	} from './matching/explain.js';
	import { cleanMatchingSettings } from './matching/classify.js';
	import {
		linkRepayment,
		markPrivate,
		privateKind,
		privateNote,
		privateSettlement,
		unlinkRepayment,
		unmarkPrivate
	} from './matching/private.js';
	import { cleanDatevSettings, privateAccounts } from './booking/settings.js';
	import { graceWait, localDay } from './matching/grace.js';
	import { list, t } from './i18n/index.js';

	/** @type {{ txId: string, onclose: () => void, onopen: (id: string) => void }} */
	let { txId, onclose, onopen } = $props();

	let tx = $derived(app.transactions.find((x) => x.id === txId) ?? null);
	/** @param {string} id */
	const receiptById = (id) => app.receipts.find((r) => r.id === id) ?? null;
	let account = $derived(tx ? (app.accounts.find((a) => a.id === tx.accountId) ?? null) : null);
	let classification = $derived(tx ? (app.classifications[tx.id] ?? null) : null);
	// The payment's two tasks, as chips in the header: a receipt (or none needed), an account.
	let receiptState = $derived(
		!tx
			? 'missing'
			: matchesOfTx(tx.id, app.matches).length
				? 'done'
				: classification || tx.noReceipt || privateKind(tx)
					? 'none-needed'
					: 'missing'
	);
	let showDetails = $state(false);
	/** "Kein fremder Beleg …": no receipt needed, bank fee, Eigenbeleg. */
	let altOpen = $state(false);

	// "Privat (Irrläufer)" (issue #172): one private payment from the business account.
	let privateAsking = $state(false);
	let privateText = $state('');
	let repayOpen = $state(false);
	let privateRules = $derived(privateAccounts(cleanDatevSettings(app.datevSettings)));
	let legalForm = $derived(cleanDatevSettings(app.datevSettings).legalForm);
	let settlement = $derived(tx && privateKind(tx) ? privateSettlement(tx, app.transactions) : null);
	// The other way round: private money that came in on the business account by
	// mistake and is passed on to the private account. The same mechanics, its
	// own words: `…In` for the incoming payment, `…Out` for its pass-on.
	let privateIn = $derived(Boolean(tx?.privateMistake) && (tx?.amountCents ?? 0) > 0);
	let passOn = $derived(Boolean(tx?.privateRepaymentOf?.length) && (tx?.amountCents ?? 0) < 0);
	/** @param {string} key */
	const pk = (key) => `zahlungen.detail.private.${key}${privateIn ? 'In' : ''}`;
	let repayChoices = $derived(
		repayOpen && tx?.privateMistake
			? transferCandidates(tx, app.transactions, { days: 180, anyAccount: true }).filter(
					(o) => !privateKind(o) || o.privateRepaymentOf
				)
			: []
	);
	const startPrivate = () => {
		privateAsking = !privateAsking;
		if (privateAsking && tx) privateText = privateNote(tx);
	};
	const savePrivate = () =>
		act(async () => {
			await markPrivate(/** @type {any} */ (currentStore()), txId, privateText);
			privateAsking = false;
			altOpen = false;
			await runMatchingNow();
		});
	const notPrivate = () =>
		act(async () => {
			await unmarkPrivate(/** @type {any} */ (currentStore()), txId);
			await runMatchingNow();
		});
	/** @param {string} otherId */
	const repayWith = (otherId) =>
		act(async () => {
			await linkRepayment(/** @type {any} */ (currentStore()), txId, otherId);
			repayOpen = false;
		});
	/** @param {string} paymentId @param {string} repaymentId */
	const repayUndo = (paymentId, repaymentId) =>
		act(async () => {
			await unlinkRepayment(/** @type {any} */ (currentStore()), paymentId, repaymentId);
		});
	// The transaction in the block explorer as a QR code, to open it on a phone.
	let explorerQrOpen = $state(false);
	// The payment's name and, for a crypto booking, who sent and who received (bank/payee.js).
	let book = $derived(addressBook(app));
	let payee = $derived(tx ? payeeName(tx, book) : null);
	let parties = $derived(
		tx
			? walletParties(
					tx,
					app.accounts.find((a) => a.id === tx?.accountId),
					book
				)
			: null
	);
	// An own transfer names the account it went to, not an address (issue #254).
	let counterAccount = $derived.by(() => {
		const otherId =
			classification?.kind === 'own-transfer' ? classification.counterBookingId : null;
		const other = otherId ? app.transactions.find((o) => o.id === otherId) : null;
		return other ? (app.accounts.find((a) => a.id === other.accountId) ?? null) : null;
	});
	let heading = $derived.by(() => {
		if (parties && counterAccount) return accountLabel(counterAccount);
		// A bare address is no name: say which way it went.
		const other = parties && tx ? (txDirection(tx) < 0 ? parties.to : parties.from) : null;
		if (tx && other && !other.own && other.address && other.label === shortAddress(other.address)) {
			return t(
				txDirection(tx) < 0 ? 'zahlungen.detail.toAddress' : 'zahlungen.detail.fromAddress',
				{
					address: other.label
				}
			);
		}
		return payee?.name;
	});
	// "Wohin ging das Geld?" (issue #254): for a wallet transfer nothing explains yet.
	let whereOpen = $derived(
		Boolean(
			tx &&
				parties &&
				!parties.fee &&
				!classification &&
				!tx.receiptId &&
				!tx.noReceipt &&
				tx.counterpartyAddress
		)
	);
	// An own account that got (or sent) about the same quantity of the same asset that day.
	let whereCandidate = $derived.by(() => {
		if (!whereOpen || !tx || !/^-?\d+$/.test(String(tx.quantity ?? ''))) return null;
		const abs = (/** @type {bigint} */ v) => (v < 0n ? -v : v);
		const mine = abs(BigInt(tx.quantity));
		return (
			transferCandidates(tx, app.transactions, { days: 1, limit: 5 }).find((o) => {
				if (o.asset !== tx?.asset || !/^-?\d+$/.test(String(o.quantity ?? ''))) return false;
				const theirs = abs(BigInt(o.quantity));
				// Within 3 %: an exchange may keep a fee of its own.
				return mine > 0n && abs(mine - theirs) * 100n <= mine * 3n;
			}) ?? null
		);
	});
	// The other bookings with the same address, newest first.
	let sameAddress = $derived(
		whereOpen && tx
			? app.transactions
					.filter(
						(o) =>
							!o.deleted && o.id !== tx?.id && o.counterpartyAddress === tx?.counterpartyAddress
					)
					.sort((a, b) => String(b.bookedOn).localeCompare(String(a.bookedOn)))
			: []
	);
	// The other side is a bare address: offer to name it.
	let whereUnnamed = $derived.by(() => {
		if (!whereOpen || !tx || !parties) return false;
		const other = txDirection(tx) < 0 ? parties.to : parties.from;
		return !other.own && Boolean(other.address) && other.label === shortAddress(other.address);
	});
	let addressName = $state('');
	const saveAddressName = () =>
		act(async () => {
			const store = currentStore();
			if (!store || !tx) return;
			await nameAddress(store.partners, tx, addressName);
			addressName = '';
			await refreshNow();
		});
	/** @param {string} otherId */
	const linkCandidate = (otherId) =>
		act(async () => {
			await linkTransfer(/** @type {any} */ (currentStore()), txId, otherId);
			await runMatchingNow();
		});

	// "Als Gegenbuchung verknüpfen …" (issue #98): the other side of an own transfer, by hand.
	let linkOpen = $state(false);
	// What the other side is: an own transfer, or a charge's refund (issue #119).
	let linkMode = $state(/** @type {'transfer' | 'refund' | 'swap'} */ ('transfer'));
	let linkQuery = $state('');
	/** @type {{ pick: { id: string, confidence: string, reason: string } | null } | null} */
	let linkAi = $state(null);
	let linkAsking = $state(false);
	let othersOpen = $state(false);
	/** @param {string} id */
	const scrollToPart = (id) =>
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	// A wallet's incoming transfer with a memo, not yet explained: usually one's own
	// withdrawal from an exchange, with the memo typed there.
	let memoIn = $derived(
		tx &&
			!classification &&
			!tx.receiptId &&
			walletChain(tx.source) &&
			tx.movement === 'transfer' &&
			Number(tx.amountCents ?? 0) > 0
			? memoOf(tx)
			: null
	);
	// An exchange trade's other leg, when this booking is one.
	// Bookings that belong with this one (matching/related.js), and its receipts: one click away.
	let related = $derived(
		tx ? (relatedIndex(app.transactions, app.classifications).get(tx.id) ?? []) : []
	);
	/** @param {string} id */
	const receiptHref = (id) => `${resolve('/belege')}?receipt=${encodeURIComponent(id)}`;
	/** @param {Record<string, any>} other */
	const relatedAccount = (other) => {
		const a = app.accounts.find((x) => x.id === other.accountId);
		return a ? accountLabel(a) : payeeName(other, book).name;
	};
	let tradeOther = $derived(
		tx && tx.movement === 'trade' ? (tradeSides(app.transactions).get(tx.id) ?? null) : null
	);
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
					learnedVendors: learnedVendors(app.partners ?? []),
					// An invoice paid in part elsewhere is offered as one more instalment (#258).
					transactions: app.transactions
				})
			: []
	);
	let suggestions = $derived(choices.filter((c) => c.suggested));
	let others = $derived(tx ? otherPayments(tx, app.transactions) : []);
	let othersWithout = $derived(others.filter((o) => !isTxCovered(o, app.classifications)).length);
	// "Ist das ein eigenes Konto?" (#256): this booking came from, or went to, an
	// IBAN that sends under the company's name.
	let ownIbanOffer = $derived.by(() => {
		if (!tx?.counterpartyIban) return null;
		const settings = cleanMatchingSettings(app.matchingSettings);
		return ownIbanSuggestionFor(
			ownIbanSuggestions({
				transactions: app.transactions,
				classifications: app.classifications,
				ownIbans: settings.ownIbans,
				notOwnIbans: settings.notOwnIbans
			}),
			tx
		);
	});
	const answerOwnIban = (/** @type {boolean} */ yes) =>
		act(async () => {
			if (!ownIbanOffer) return;
			await (yes ? addOwnIban : rejectOwnIban)(
				/** @type {any} */ (currentStore()),
				ownIbanOffer.iban
			);
			await runMatchingNow();
		});
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
	/** Whether a receipt is being looked for here: the search, the tabs and the choices show. */
	let finding = $derived(
		Boolean(tx) && ((!linked.length && !classification && !tx?.noReceipt) || assigning)
	);
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
	/**
	 * What the model answered, and what it was given (issue #167).
	 * @type {{ pick: { id: string, confidence: string, reason: string } | null, reason: string, model: string, seconds: number, sent: string[], checked: { id: string, vendor?: string, amount?: string, currency?: string, date?: string, number?: string }[] } | null}
	 */
	let aiChoice = $state(null);
	let aiCandidates = $derived(tx ? assistCandidates(tx, choices) : []);
	let aiEmpty = $derived(tx ? assistEmptyReason(tx, choices) : null);
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
	/** @type {{ text: string, warnings: string[], move?: { receiptId: string, fromId: string } } | null} */
	let uploadResult = $state(null);
	/** "Hierher umhängen": the receipt was another booking's; moved on the person's word. */
	const moveHere = () =>
		act(async () => {
			const move = uploadResult?.move;
			if (!move || !tx) return;
			await moveReceipt({
				store: /** @type {any} */ (currentStore()),
				receiptId: move.receiptId,
				tx,
				fromTransactionId: move.fromId,
				ctx: { companyNames: app.matchingSettings?.companyNames ?? [] }
			});
			uploadResult = { text: t('zahlungen.detail.uploadMoved'), warnings: [] };
		});
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
		showDetails = false;
		altOpen = false;
		othersOpen = false;
		findQuery = '';
		findTab = null;
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
			if (r.outcome === 'linked-elsewhere' && r.receipt) {
				const other = r.elsewhere;
				uploadResult = {
					text: t('zahlungen.detail.uploadElsewhere', {
						vendor: receiptVendor(r.receipt),
						booking: other
							? `${other.counterparty || '—'}, ${formatDate(String(other.bookedOn))}, ${formatMoney(other.amountCents ?? 0, other.currency ?? 'EUR')}`
							: t('zahlungen.detail.uploadElsewhereUnknown')
					}),
					warnings: [],
					...(other ? { move: { receiptId: String(r.receipt.id), fromId: String(other.id) } } : {})
				};
				return;
			}
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

	const acknowledgeChange = () =>
		act(async () => {
			await acknowledgeImportChange(/** @type {any} */ (currentStore()), txId);
		});

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

	/**
	 * @param {string} receiptId @param {number} score @param {string[]} reasons
	 * @param {boolean} [alongside] one more instalment: the receipt's other links stay (#258)
	 */
	const assign = (receiptId, score, reasons, alongside = false) =>
		act(async () => {
			const store = /** @type {any} */ (currentStore());
			await confirmMatch(store, {
				receiptId,
				transactionId: txId,
				score,
				reasons: [...reasons, 'manual'],
				alongside
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
			const candidates = aiCandidates;
			// Nothing to send: the page already says why; the model is not asked (#167).
			if (!candidates.length) return;
			const r = await client.matchAssist({
				booking: {
					counterparty: String(tx.counterparty ?? '').slice(0, 200),
					purpose: String(tx.purpose ?? '').slice(0, 1000),
					amount: formatMoney(tx.amountCents ?? 0, tx.currency).replace(/\s*EUR$/, ''),
					day: String(tx.bookedOn ?? '')
				},
				candidates
			});
			const calls = r.llm.calls ?? [];
			aiChoice = {
				pick: r.pick,
				reason: r.reason ?? r.pick?.reason ?? '',
				model: calls.at(-1)?.model ?? '',
				seconds: Math.max(1, Math.round(calls.reduce((n, c) => n + (c.ms ?? 0), 0) / 1000)),
				sent: r.llm.sent ?? [],
				checked: candidates
			};
			await recordEvent(currentStore()?.events, 'match-assist', {
				transactionId: tx.id,
				candidates: candidates.length,
				pick: r.pick?.confidence ?? null,
				model: r.llm.calls.at(-1)?.model ?? null,
				calls: eventCalls(r.llm.calls),
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
		tx &&
			!tx.noReceipt &&
			// Also for an own transfer found another way, while no company name is set (#176).
			(!classification ||
				(classification.kind === 'own-transfer' &&
					!(app.matchingSettings?.companyNames ?? []).length))
			? ownNameCandidate(tx, app.transactions, app.matchingSettings?.companyNames ?? [])
			: null
	);
	// Twins (#176): several bookings of exactly this amount the other way on own
	// accounts within days, and no rule could tell which is the other side.
	let twins = $derived.by(() => {
		if (!tx || classification || tx.noReceipt || privateKind(tx) || !tx.amountCents) return [];
		const day = Date.parse(`${tx.bookedOn}T00:00:00Z`);
		return app.transactions.filter(
			(o) =>
				!o.deleted &&
				o.accountId !== tx.accountId &&
				o.amountCents === -tx.amountCents &&
				(o.currency ?? 'EUR') === (tx.currency ?? 'EUR') &&
				Math.abs(Date.parse(`${o.bookedOn}T00:00:00Z`) - day) <= 4 * 86_400_000
		);
	});
	let ownNameDismissed = $state(false);
	const acceptOwnName = () =>
		act(async () => {
			if (!ownName) return;
			await addCompanyName(/** @type {any} */ (currentStore()), ownName.name);
			await runMatchingNow();
		});

	// Token migration (#162): the replacement a burned token may have, and a rate by hand.
	let migrationChoices = $derived(
		tx && classification?.kind === 'token-burn'
			? migrationCandidates(tx, app.transactions, app.accounts)
			: []
	);
	/** @param {string} otherId */
	const migrateWith = (otherId) =>
		act(async () => {
			await linkMigration(/** @type {any} */ (currentStore()), txId, otherId);
			await runMatchingNow();
		});
	let rateOpen = $state(false);
	let rateText = $state('');
	const saveRate = () =>
		act(async () => {
			await setManualRate(/** @type {any} */ (currentStore()), txId, rateText);
			rateOpen = false;
			rateText = '';
		});

	const notTransfer = () =>
		act(async () => {
			if (!classification?.counterBookingId) return;
			await (
				classification.kind === 'refund'
					? rejectRefund
					: classification.kind === 'crypto-swap'
						? unlinkSwap
						: classification.kind === 'token-migration'
							? unlinkMigration
							: rejectTransfer
			)(/** @type {any} */ (currentStore()), txId, classification.counterBookingId);
			await runMatchingNow();
		});

	let linkChoices = $derived(
		linkOpen && tx
			? transferCandidates(tx, app.transactions, {
					query: linkQuery,
					...(linkMode === 'refund' ? { days: 120, anyAccount: true } : {})
				})
			: []
	);

	async function suggestTransferByAi() {
		if (!client || !tx || !linkChoices.length) return;
		linkAsking = true;
		error = null;
		linkAi = null;
		try {
			const candidates = linkChoices.map((o) => ({ id: String(o.id), ...transferFields(o) }));
			const r = await client.transferAssist({ booking: transferFields(tx), candidates });
			linkAi = { pick: r.pick };
			await recordEvent(currentStore()?.events, 'transfer-assist', {
				transactionId: tx.id,
				candidates: candidates.length,
				pick: r.pick?.confidence ?? null,
				model: r.llm.calls.at(-1)?.model ?? null,
				calls: eventCalls(r.llm.calls),
				ms: r.llm.calls.reduce((n, c) => n + (c.ms ?? 0), 0),
				tokensTotal: r.llm.calls.reduce(
					(n, c) => n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
					0
				)
			});
		} catch (e) {
			error = message(e);
		} finally {
			linkAsking = false;
		}
	}
	let linkAiRow = $derived.by(() => {
		const id = /** @type {any} */ (linkAi)?.pick?.id;
		return id ? (linkChoices.find((o) => String(o.id) === id) ?? null) : null;
	});

	/** @param {string} otherId */
	const linkOther = (otherId) =>
		act(async () => {
			await (linkMode === 'refund' ? linkRefund : linkMode === 'swap' ? linkSwap : linkTransfer)(
				/** @type {any} */ (currentStore()),
				txId,
				otherId
			);
			linkOpen = false;
			linkQuery = '';
			linkAi = null;
			altOpen = false;
			await runMatchingNow();
		});

	const bankFee = () =>
		act(async () => {
			await markBankFee(/** @type {any} */ (currentStore()), txId);
			await runMatchingNow();
		});

	const needsReceipt = () =>
		act(async () => setNoReceipt(/** @type {any} */ (currentStore()), txId, null));

	// "Beleg finden": one search text for the lists and the private mailbox.
	let findQuery = $state('');
	/** @type {'passend' | 'alle' | 'postfach' | 'portal' | null} null: the default for this booking */
	let findTab = $state(null);
	/** The search text, when the bridge takes it as its text (3–100 plain characters). */
	let freeText = $derived.by(() => {
		const q = findQuery.replace(/\s+/g, ' ').trim();
		return q.length >= 3 && q.length <= 100 && !/["\\\r\n]/.test(q) ? q : null;
	});
	let baseQuery = $derived.by(() => {
		if (!tx) return null;
		// Never search for ourselves: company names and own names (#231).
		const s = cleanMatchingSettings(app.matchingSettings);
		return privateSearchQuery(tx, app.partners ?? [], {
			ownNames: [...s.companyNames, ...s.ownNames]
		});
	});
	// What the private mailbox is asked: the search text, when given, instead of the telling word.
	let query = $derived(baseQuery && freeText ? { ...baseQuery, text: freeText } : baseQuery);
	/** @param {string} iso @param {number} days */
	const shift = (iso, days) =>
		formatDate(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10));
	// An exchange's deposit or withdrawal: which chain its hash is on, and the
	// explorer link (#215). An own wallet's booking of the same hash settles it.
	let hashChain = $derived.by(() => {
		if (!tx?.chainTxRef) return null;
		const ref = normalizeTxRef(tx.chainTxRef);
		const mirror = app.transactions.find(
			(o) => !o.deleted && walletChain(o.source) && normalizeTxRef(o.txRef) === ref
		);
		return chainOfHash({
			hash: tx.chainTxRef,
			asset: tx.asset ?? '',
			method: tx.chainMethod ?? '',
			walletChain: mirror ? String(mirror.source) : null
		});
	});
	let searchHint = $derived(
		query && query.terms.length
			? t('zahlungen.detail.privateHintCrypto', {
					from: shift(query.around, -query.days),
					to: shift(query.around, query.days),
					text: query.text ? t('zahlungen.detail.privateHintCryptoText', { text: query.text }) : ''
				})
			: query
				? t(
						!query.text
							? 'zahlungen.detail.privateHintAmount'
							: !freeText && query.textFrom === 'purpose'
								? 'zahlungen.detail.privateHintPurpose'
								: 'zahlungen.detail.privateHint',
						{
							text: query.text ?? '',
							amount: `${query.amount} €`,
							from: shift(query.around, -query.days),
							to: shift(query.around, query.days)
						}
					)
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
				amount: query.amount ?? searchAmount(Number(tx.amountCents ?? 0)),
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
				calls: eventCalls(r.llm.calls),
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
		// Taken from the search: "Beleg finden" stays open, so its result and the hits stay in view.
		assigning = true;
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
		if (e.key !== 'Escape') return;
		// Esc closes the receipt preview first, the detail after.
		if (peeked) {
			peek.close();
			return;
		}
		onclose();
	}

	// The hover preview of a receipt among the choices (#273, receipts/peek.js).
	/** @typedef {import('$lib/store/repository.js').StoredRecord} Receipt */
	/** @type {{ receipt: Receipt, anchor: HTMLElement } | null} */
	let peeked = $state(null);
	const peek = createPeek({
		onchange: (v) => (peeked = /** @type {{ receipt: Receipt, anchor: HTMLElement } | null} */ (v))
	});
	/** The row a choice's event came from. @param {Event} e */
	const rowOf = (e) =>
		/** @type {HTMLElement} */ (
			/** @type {HTMLElement} */ (e.currentTarget).closest('[data-testid="tx-choice"]')
		);
	// A preview belongs to the payment it was opened on.
	$effect(() => {
		void txId;
		peek.close();
	});

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

	// "Beleg finden": the search text filters the lists (every word somewhere in
	// vendor, amount, date, number, sender, subject or file name).
	/** @param {import('$lib/store/repository.js').StoredRecord} r */
	function findsReceipt(r) {
		const words = findQuery.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return true;
		const hay = [
			receiptVendor(r),
			receiptAmount(r),
			receiptDay(r),
			r.invoiceNumber,
			r.from,
			r.subject,
			r.fileName
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return words.every((w) => hay.includes(w));
	}
	/** How far a receipt is from this booking: `Betrag gleich · 0 Tage`, `+1,86 € · +37 Tage`. @param {import('$lib/store/repository.js').StoredRecord} r */
	function receiptDiff(r) {
		if (!tx) return '';
		const parts = [];
		const want = Math.abs(Number(tx.amountCents ?? 0));
		if (typeof r.amountCents === 'number' && (r.currency ?? 'EUR') === (tx.currency ?? 'EUR')) {
			const d = r.amountCents - want;
			parts.push(
				d === 0
					? t('zahlungen.detail.find.sameAmount')
					: `${d > 0 ? '+' : '−'}${formatMoney(Math.abs(d), tx.currency ?? 'EUR')}`
			);
		} else if (r.currency && r.currency !== (tx.currency ?? 'EUR')) {
			parts.push(t('zahlungen.detail.find.otherCurrency'));
		}
		const day = receiptDate(r);
		if (day && tx.bookedOn) {
			const days = Math.round(
				(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${tx.bookedOn}T00:00:00Z`)) / 864e5
			);
			parts.push(t('zahlungen.detail.find.days', { days: days > 0 ? `+${days}` : String(days) }));
		}
		return parts.join(' · ');
	}
	let scamCtx = $derived(
		scamContext({ partners: app.partners, transactions: app.transactions, accounts: app.accounts })
	);
	let foundSuggestions = $derived(suggestions.filter((c) => findsReceipt(c.receipt)));
	let foundAll = $derived(choices.filter((c) => findsReceipt(c.receipt)));
	let tab = $derived(findTab ?? (suggestions.length ? 'passend' : 'alle'));
	/** @param {string | number | null} id */
	const pickTab = (id) => {
		if (id === 'passend' || id === 'alle' || id === 'postfach' || id === 'portal') findTab = id;
	};
	let rows = $derived(tab === 'passend' ? foundSuggestions : foundAll);

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

{#snippet uploadControls()}
	<!-- Upload a receipt and link it here: above the list of receipts while one is being
	     chosen (#274) – below a long list it is not found –, else at the end of the part. -->
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
		{#if uploadResult.move}
			{@const move = uploadResult.move}
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class={button}
					onclick={() => onopen(move.fromId)}
					data-testid="tx-upload-elsewhere-open">{t('zahlungen.detail.uploadElsewhereOpen')}</button
				>
				<button
					type="button"
					class={button}
					onclick={moveHere}
					disabled={busy}
					data-testid="tx-upload-move">{t('zahlungen.detail.uploadMove')}</button
				>
			</div>
		{/if}
	{/if}
	{#if folderNote}
		<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-folder-result">
			{folderNote}
		</p>
	{/if}
{/snippet}

<!-- The backdrop closes on a click on itself only. The panel does not stop
     clicks from bubbling: SvelteKit's router hears link clicks on the document,
     and a stopped click made an internal link reload the page – and lock the books. -->
<div
	class="fixed inset-0 z-50 flex justify-end bg-black/40"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div
		bind:this={panel}
		class="h-full w-full max-w-xl overflow-y-auto bg-bg px-4 py-4 shadow-xl sm:px-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tx-detail-title"
		tabindex="-1"
		onkeydown={onKey}
		onscroll={() => peek.close()}
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
		{#if peeked}
			<ReceiptPeek
				receipt={peeked.receipt}
				anchor={peeked.anchor}
				title={receiptVendor(peeked.receipt)}
				detail={[
					receiptAmount(peeked.receipt),
					receiptDay(peeked.receipt),
					peeked.receipt.invoiceNumber
				]
					.filter(Boolean)
					.join(' · ')}
				onenter={() => peek.stay()}
				onleave={() => peek.leave()}
			/>
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
						{heading}
					</h2>
					{#if payee && payee.from !== 'unknown' && !parties}
						<a
							class="text-sm underline"
							href={`${resolve('/lieferantenkonto')}?name=${encodeURIComponent(payee.name)}&until=${tx.bookedOn}`}
							data-testid="vendor-account-link">{t('vendorAccount.open')}</a
						>
					{/if}
					{#if parties}
						<!-- The full address under each name (issue #114): the list keeps the short
						     form, here it is copied into an explorer or a wallet. -->
						<!-- Who sent and who received (issue #254): both sides the same way, ours
						     marked, each address once and short – the full one on hover and copy. -->
						<dl
							class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm"
							data-testid="tx-parties"
						>
							{#each [{ side: 'from', p: parties.from }, { side: 'to', p: parties.to }] as { side, p } (side)}
								{@const pageUrl = addressExplorerUrl(tx.explorerUrl, tx.txRef, p.address)}
								<dt class="text-faint">{t(`zahlungen.detail.party.${side}`)}</dt>
								<dd class="min-w-0" data-testid={`tx-party-${side}`} data-own={p.own}>
									{#if p.own}<span
											class="mr-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-success"
											data-testid={`tx-party-${side}-own`}
											>{t('zahlungen.detail.party.ownChip')}</span
										>{/if}<span class="font-medium text-heading"
										>{p.address && p.label === shortAddress(p.address)
											? t('zahlungen.detail.party.unknownAddress')
											: p.label}</span
									>
									{#if p.address}
										<span class="mt-0.5 flex flex-wrap items-center gap-x-2">
											<span class="whitespace-nowrap" title={p.address}>
												<CopyButton
													text={p.address}
													label={t('copy.address')}
													testid={`tx-party-${side}-address`}
													valueClass="font-mono text-xs text-faint"
													>{shortAddress(p.address)}</CopyButton
												>
											</span>
											{#if pageUrl}<a
													href={pageUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="text-xs underline"
													data-testid={`tx-party-${side}-explorer`}
													>{t('zahlungen.detail.party.explorer')}</a
												>{/if}
										</span>
									{/if}
								</dd>
							{/each}
						</dl>
					{/if}
				</div>
				<div class="flex shrink-0 items-start gap-3">
					<p
						class="font-mono text-2xl font-semibold whitespace-nowrap tabular-nums {txDirection(
							tx
						) < 0
							? 'text-red-700 dark:text-red-400'
							: 'text-emerald-700 dark:text-emerald-400'}"
						data-testid="tx-detail-amount"
					>
						{formatTxAmount(tx)}
					</p>
					<button type="button" class={button} onclick={onclose} data-testid="tx-detail-close"
						>{t('zahlungen.detail.close')}</button
					>
				</div>
			</div>
			<p class="mt-1 text-sm text-faint" data-testid="tx-detail-meta">
				<span class="text-heading" data-testid="tx-detail-date"
					>{formatDate(tx.bookedOn)}{#if formatBookingTime(tx)}, {t('zahlungen.time', {
							time: formatBookingTime(tx)
						})}{/if}</span
				>{#if account}&nbsp;· {accountLabel(account)}{/if}{#if quantityText(tx)}&nbsp;·
					<span class="font-mono text-heading tabular-nums" data-testid="tx-detail-quantity"
						>{quantityText(tx)}</span
					>{/if}{#if tx.bookingType}&nbsp;· {tx.bookingType}{/if}{#if safeExplorerUrl(tx.explorerUrl)}&nbsp;·
					<a
						href={safeExplorerUrl(tx.explorerUrl)}
						target="_blank"
						rel="noopener noreferrer"
						class="underline"
						data-testid="tx-explorer">{t('zahlungen.detail.explorer')}</a
					>
					<button
						type="button"
						class="underline"
						aria-expanded={explorerQrOpen}
						onclick={() => (explorerQrOpen = !explorerQrOpen)}
						data-testid="tx-explorer-qr-toggle">{t('zahlungen.detail.explorerQr')}</button
					>{/if}
			</p>
			{#if explorerQrOpen && safeExplorerUrl(tx.explorerUrl)}
				<div
					class="mt-2 inline-block rounded-md bg-white p-2 [&_svg]:block [&_svg]:size-40"
					data-testid="tx-explorer-qr"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of a checked https explorer link -->
					{@html renderSVG(/** @type {string} */ (safeExplorerUrl(tx.explorerUrl)), { border: 1 })}
				</div>
			{/if}
			{#if walletPurposeExtra(tx)}
				<p
					class="mt-1 line-clamp-2 font-mono text-xs break-words text-text"
					title={tx.purpose}
					data-testid="tx-detail-purpose-line"
				>
					{displayPurpose(walletPurposeExtra(tx))}
				</p>
			{/if}
			{#if tradeOther}
				<p class="mt-1 text-sm text-heading" data-testid="tx-detail-trade">
					{t('zahlungen.trade', { arrow: tradeArrow(tx), what: tradeSideWhat(tradeOther) })}
					<button
						type="button"
						class="ml-2 text-sm underline"
						onclick={() => tradeOther && onopen(String(tradeOther.id))}
						data-testid="tx-trade-open">{t('zahlungen.tradeOpen')}</button
					>
				</p>
			{/if}
			<div class="mt-3 flex flex-wrap items-center gap-2" data-testid="tx-status">
				<button
					type="button"
					class="min-h-9 rounded-full border px-3 py-1 text-sm font-semibold {receiptState ===
					'missing'
						? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
						: 'border-success/30 bg-success/10 text-success'}"
					onclick={() => scrollToPart('tx-receipt-part')}
					data-testid="tx-status-receipt"
					data-state={receiptState}>{t(`zahlungen.detail.status.receipt.${receiptState}`)}</button
				>
				<button
					type="button"
					class="min-h-9 rounded-full border px-3 py-1 text-sm font-semibold {isBookingConfirmed(tx)
						? 'border-success/30 bg-success/10 text-success'
						: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}"
					onclick={() => scrollToPart('tx-konto-part')}
					title={isBookingConfirmed(tx)
						? undefined
						: t('zahlungen.detail.status.konto.missingHint')}
					data-testid="tx-status-konto"
					data-state={isBookingConfirmed(tx) ? 'done' : 'missing'}
					>{isBookingConfirmed(tx)
						? t('zahlungen.detail.status.konto.done')
						: t('zahlungen.detail.status.konto.missing')}</button
				>
				<span class="flex-1"></span>
				<button
					type="button"
					class="text-sm text-cyan-800 underline dark:text-cyan"
					onclick={() => (showDetails = !showDetails)}
					aria-expanded={showDetails}
					aria-controls="tx-details"
					data-testid="tx-details-toggle"
					>{showDetails ? t('zahlungen.detail.detailsHide') : t('zahlungen.detail.details')}</button
				>
			</div>
			{#if whereOpen}
				<section
					class="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
					aria-labelledby="tx-where-h"
					data-testid="tx-where"
				>
					<h3 id="tx-where-h" class="text-xs font-semibold tracking-wide text-faint uppercase">
						{t(
							txDirection(tx) < 0
								? 'zahlungen.detail.where.titleOut'
								: 'zahlungen.detail.where.titleIn'
						)}
					</h3>
					{#if whereCandidate}
						{@const acc = app.accounts.find((a) => a.id === whereCandidate?.accountId)}
						<p class="mt-1 text-text" data-testid="tx-where-candidate">
							{t('zahlungen.detail.where.candidate', {
								account: acc ? accountLabel(acc) : '—',
								date: formatDate(String(whereCandidate.bookedOn)),
								quantity:
									quantityText(whereCandidate) ||
									formatMoney(whereCandidate.amountCents ?? 0, 'EUR')
							})}
						</p>
						<div class="mt-1 flex flex-wrap gap-3">
							<button
								type="button"
								class={button}
								disabled={busy}
								onclick={() => whereCandidate && linkCandidate(String(whereCandidate.id))}
								data-testid="tx-where-link">{t('zahlungen.detail.where.link')}</button
							>
							<button
								type="button"
								class="text-sm underline"
								onclick={() => whereCandidate && onopen(String(whereCandidate.id))}
								data-testid="tx-where-candidate-open">{t('zahlungen.detail.where.open')}</button
							>
						</div>
					{/if}
					{#if sameAddress.length}
						<p class="mt-2 text-text" data-testid="tx-where-same">
							{sameAddress.length === 1
								? t('zahlungen.detail.where.sameOne')
								: t('zahlungen.detail.where.same', { count: sameAddress.length })}
							<!-- They are listed below, under "Weitere Zahlungen an …": opened there. -->
							<button
								type="button"
								class="ml-1 underline"
								onclick={() => {
									othersOpen = true;
									scrollToPart('tx-others');
								}}
								data-testid="tx-where-same-show">{t('zahlungen.detail.where.show')}</button
							>
						</p>
					{:else}
						<p class="mt-2 text-faint" data-testid="tx-where-first">
							{t('zahlungen.detail.where.first')}
						</p>
					{/if}
					{#if whereUnnamed}
						<form
							class="mt-2 flex flex-wrap items-end gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								saveAddressName();
							}}
						>
							<label class="flex min-w-48 flex-1 flex-col text-xs text-faint"
								>{t('zahlungen.detail.where.nameLabel')}
								<input
									class="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-heading"
									bind:value={addressName}
									placeholder={t('zahlungen.detail.where.namePlaceholder')}
									data-testid="tx-where-name"
								/>
							</label>
							<button
								type="submit"
								class={button}
								disabled={busy || !addressName.trim()}
								data-testid="tx-where-name-save">{t('zahlungen.detail.where.nameSave')}</button
							>
						</form>
					{/if}
				</section>
			{/if}
			{#if tx.importChange}
				<div
					class="mt-2 rounded-md border border-l-4 border-red-300 border-l-red-700 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:border-l-red-400 dark:bg-red-950/40"
					role="alert"
					data-testid="tx-import-change"
				>
					<p class="font-semibold text-red-800 dark:text-red-300">
						{t('zahlungen.detail.changedTitle', {
							date: formatDate(String(tx.importChange.at).slice(0, 10))
						})}
					</p>
					<p class="mt-0.5 text-text">
						{t('zahlungen.detail.changedText', {
							from: formatMoney(Number(tx.importChange.fromCents), tx.currency),
							to: formatMoney(Number(tx.importChange.toCents), tx.currency)
						})}
						{#if tx.importChange.signFlipped}{t('zahlungen.detail.changedFlipped')}{/if}
						{#if !isBookingConfirmed(tx)}{t('zahlungen.detail.changedAccount')}{/if}
						{#if links.length}{t('zahlungen.detail.changedReceipt')}{/if}
					</p>
					<button
						type="button"
						class="mt-1.5 text-sm underline"
						onclick={acknowledgeChange}
						disabled={busy}
						data-testid="tx-import-change-ok">{t('zahlungen.detail.changedOk')}</button
					>
				</div>
			{/if}

			<div id="tx-details" hidden={!showDetails} data-testid="tx-details">
				<dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
					{#if tx.valueDate && tx.valueDate !== tx.bookedOn}
						<dt class="text-faint">{t('zahlungen.detail.valueDate')}</dt>
						<dd class="text-heading">{formatDate(tx.valueDate)}</dd>
					{/if}
					{#if quantityText(tx)}
						{#if valuationText(tx)}
							<dt class="text-faint">{t('zahlungen.detail.valuation')}</dt>
							<dd class="text-heading" data-testid="tx-detail-valuation" title={valuationText(tx)}>
								{valuationText(tx, { short: true })}
							</dd>
						{/if}
					{/if}
					{#if tx.original?.currency}
						<dt class="text-faint">{t('zahlungen.detail.original')}</dt>
						<dd class="text-heading" data-testid="tx-detail-original">
							{tx.original.amount
								? t('zahlungen.detail.originalAmount', {
										amount: tx.original.amount,
										currency: tx.original.currency
									})
								: tx.original.currency}{tx.original.rate
								? t('zahlungen.detail.originalRate', { rate: tx.original.rate })
								: ''}
						</dd>
					{/if}
					{#if tx.exchangeType}
						<dt class="text-faint">{t('zahlungen.detail.exchangeType')}</dt>
						<dd class="font-mono text-xs text-heading">{tx.exchangeType}</dd>
					{/if}
					{#if tx.txRef}
						<dt class="text-faint">
							{t(parties ? 'zahlungen.detail.txHashLabel' : 'zahlungen.detail.txRef')}
						</dt>
						<dd class="font-mono text-xs break-all text-heading" data-testid="tx-detail-ref">
							<CopyButton
								text={tx.txRef}
								label={t(parties ? 'copy.hash' : 'copy.ref')}
								testid="tx-detail-ref-copy">{tx.txRef}</CopyButton
							>
						</dd>
					{/if}
					{#if tx.chainTxRef}
						<dt class="text-faint">{t('zahlungen.detail.chainTxRef')}</dt>
						<dd class="text-xs text-heading" data-testid="tx-detail-chain-ref">
							<span class="font-mono break-all">
								<CopyButton
									text={tx.chainTxRef}
									label={t('copy.hash')}
									testid="tx-detail-chain-ref-copy">{tx.chainTxRef}</CopyButton
								>
							</span>
							{#if hashChain?.chains.length === 1}
								<span class="mt-1 block" data-testid="tx-detail-chain">
									{hashChain.chains[0].name} ·
									<a
										href={hashUrl(hashChain.chains[0], tx.chainTxRef)}
										target="_blank"
										rel="noopener noreferrer"
										class="underline"
										data-testid="tx-detail-chain-explorer"
										>{t('zahlungen.detail.explorerAt', {
											explorer: hashChain.chains[0].explorer
										})}</a
									>{#if tx.chainMethod}&nbsp;· {t('zahlungen.detail.chainMethod', {
											method: tx.chainMethod
										})}{/if}
								</span>
							{:else if hashChain && hashChain.chains.length > 1}
								<span class="mt-1 block" data-testid="tx-detail-chain-unclear">
									{t('zahlungen.detail.chainUnclear')}
									{#each hashChain.chains as c, i (c.id)}{i ? ' · ' : ' '}<a
											href={hashUrl(c, tx.chainTxRef)}
											target="_blank"
											rel="noopener noreferrer"
											class="underline">{c.name}</a
										>{/each}
								</span>
							{/if}
						</dd>
					{/if}
					{#if tx.counterpartyAddress && !parties}
						<dt class="text-faint">{t('zahlungen.detail.address')}</dt>
						<dd class="font-mono text-xs break-all text-heading" data-testid="tx-detail-address">
							<CopyButton
								text={tx.counterpartyAddress}
								label={t('copy.address')}
								testid="tx-detail-address-copy">{tx.counterpartyAddress}</CopyButton
							>
						</dd>
					{/if}
					{#if tx.counterpartyIban}
						<dt class="text-faint">{t('zahlungen.detail.iban')}</dt>
						<dd class="font-mono text-xs break-all text-heading" data-testid="tx-detail-iban">
							<CopyButton
								text={tx.counterpartyIban}
								label={t('copy.iban')}
								testid="tx-detail-iban-copy">{tx.counterpartyIban}</CopyButton
							>
						</dd>
					{/if}
				</dl>
				{#if parties ? walletPurposeExtra(tx) : tx.purpose}
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
			</div>
			{#if related.length || linked.length}
				<div class="mt-3" data-testid="tx-related">
					<h3 class="text-xs font-semibold tracking-wide text-faint uppercase">
						{t('zahlungen.detail.related.title')}
					</h3>
					<div class="mt-1.5 flex flex-wrap gap-2">
						{#each related as rel (rel.other.id)}
							<button
								type="button"
								class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cyan-800/30 bg-cyan-50 px-3 py-1 text-left text-sm text-cyan-900 hover:border-cyan-800 dark:border-cyan/30 dark:bg-cyan-950/40 dark:text-cyan-100"
								onclick={() => onopen(String(rel.other.id))}
								data-testid="tx-related-chip"
								data-kind={rel.kind}
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"></path><path
										d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"
									></path></svg
								>
								<span
									><strong class="font-semibold"
										>{t(`zahlungen.detail.related.kind.${rel.kind}`)}</strong
									>
									· {relatedAccount(rel.other)} · {formatTxAmount(rel.other)} · {formatDate(
										String(rel.other.bookedOn)
									)} ·&#32;<span class="text-faint"
										>{t(`zahlungen.detail.related.via.${rel.via}`)}</span
									></span
								>
							</button>
						{/each}
						{#each linked as l (l.receipt.id)}
							<a
								href={receiptHref(String(l.receipt.id))}
								class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm text-heading no-underline hover:border-success"
								data-testid="tx-related-receipt"
								><strong class="font-semibold">{t('zahlungen.detail.related.receipt')}</strong> · {receiptVendor(
									l.receipt
								)} · {receiptAmount(l.receipt)}</a
							>
						{/each}
					</div>
				</div>
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

			<section
				id="tx-receipt-part"
				class="mt-4 scroll-mt-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
			>
				<h3 class="text-sm font-semibold text-heading">{t('zahlungen.detail.receipts')}</h3>
				{#if memoIn}
					<p
						class="mt-2 rounded-md border border-l-4 border-border border-l-cyan-800 bg-surface-2 px-3 py-2 text-sm text-text dark:border-l-cyan"
						data-testid="tx-memo-in"
					>
						{t('zahlungen.detail.memoIn', { memo: memoIn })}
					</p>
				{/if}
				{#if classification?.lookalike}
					<div
						class="mt-2 rounded-md border border-l-4 border-red-300 border-l-red-700 bg-red-50 px-3 py-2 dark:border-red-900 dark:border-l-red-400 dark:bg-red-950/40"
						role="alert"
						data-testid="tx-poison-warning"
					>
						<p class="text-sm font-semibold text-red-800 dark:text-red-300">
							{t('zahlungen.detail.poisonTitle')}
						</p>
						<p class="mt-0.5 text-sm break-all text-text">
							{t('zahlungen.detail.poisonText', {
								address: String(tx.counterpartyAddress ?? ''),
								known: classification.lookalike
							})}
						</p>
					</div>
				{/if}
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
						{#if (classification?.kind === 'own-transfer' || classification?.kind === 'refund' || classification?.kind === 'crypto-swap' || classification?.kind === 'token-migration') && classification.counterBookingId && !tx.noReceipt}
							<div class="mt-1.5 flex flex-wrap gap-3 text-sm">
								<button
									type="button"
									class="underline"
									onclick={() =>
										classification?.counterBookingId && onopen(classification.counterBookingId)}
									data-testid="tx-counter-open">{t('zahlungen.detail.counterOpen')}</button
								>
								{#if classification.kind !== 'crypto-swap' || classification.via === 'manual'}<button
										type="button"
										class="text-faint underline hover:text-heading"
										onclick={notTransfer}
										disabled={busy}
										data-testid="tx-not-transfer"
										>{classification.via === 'manual'
											? t('zahlungen.detail.unlinkTransfer')
											: classification.kind === 'refund'
												? t('zahlungen.detail.notRefund')
												: t('zahlungen.detail.notTransfer')}</button
									>{/if}
							</div>
						{/if}
					</div>
				{/if}
				{#if ownIbanOffer}
					<div
						class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
						data-testid="tx-own-iban"
					>
						<p class="text-text">
							{t('zahlungen.detail.ownIban.question', {
								iban: groupIban(ownIbanOffer.iban),
								name: ownIbanOffer.sender
							})}
						</p>
						{#if ownIbanOffer.outgoing.length}
							<p class="mt-0.5 text-faint">
								{ownIbanOffer.outgoing.length === 1
									? t('home.ownIban.explainsOne')
									: t('home.ownIban.explains', { count: ownIbanOffer.outgoing.length })}
							</p>
						{/if}
						<div class="mt-1.5 flex flex-wrap gap-3">
							<button
								type="button"
								class={button}
								disabled={busy}
								onclick={() => answerOwnIban(true)}
								data-testid="tx-own-iban-yes">{t('home.ownIban.yes')}</button
							>
							<button
								type="button"
								class="text-sm text-faint underline hover:text-heading"
								disabled={busy}
								onclick={() => answerOwnIban(false)}
								data-testid="tx-own-iban-no">{t('home.ownIban.no')}</button
							>
						</div>
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
				{#if twins.length > 1}
					<div
						class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
						data-testid="tx-twins"
					>
						<p class="text-text">{t('zahlungen.detail.twins', { count: twins.length })}</p>
						<button
							type="button"
							class="mt-1.5 {button}"
							onclick={() => {
								altOpen = true;
								linkOpen = true;
								linkMode = 'transfer';
								linkAi = null;
							}}
							data-testid="tx-twins-link">{t('zahlungen.detail.linkTransfer')}</button
						>
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
				{#if tx.rateMissing || (showDetails && tx.quantity)}
					<div class="mt-2 text-sm" data-testid="tx-rate">
						{#if tx.rateMissing}
							<p class="text-warning" data-testid="tx-rate-missing">
								{t('zahlungen.detail.rate.missing', { reason: tx.rateMissing.reason ?? '' })}
							</p>
						{/if}
						{#if rateOpen || tx.rateMissing}
							<form
								class="mt-1 flex flex-wrap items-end gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									saveRate();
								}}
							>
								<label class="flex flex-col text-xs text-faint"
									>{t('zahlungen.detail.rate.label', { asset: tx.asset ?? '' })}
									<input
										class="mt-1 min-h-11 w-40 rounded-md border border-border bg-surface px-2 font-mono text-sm text-heading"
										inputmode="decimal"
										bind:value={rateText}
										placeholder={rateInputPlaceholder(tx.valuation?.rate)}
										data-testid="tx-rate-input"
									/></label
								>
								<button
									type="submit"
									class={button}
									disabled={busy || !rateText.trim()}
									data-testid="tx-rate-save">{t('zahlungen.detail.rate.save')}</button
								>
							</form>
							<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.rate.hint')}</p>
						{:else}
							<button
								type="button"
								class="text-xs text-text underline"
								onclick={() => (rateOpen = true)}
								data-testid="tx-rate-edit">{t('zahlungen.detail.rate.edit')}</button
							>
						{/if}
					</div>
				{/if}
				{#if classification?.kind === 'token-burn'}
					<div class="mt-2 text-sm" data-testid="tx-migration">
						{#if migrationChoices.length}
							<p class="text-text">
								{t('zahlungen.detail.migration.found', { count: migrationChoices.length })}
							</p>
							<ul class="mt-1 divide-y divide-border rounded-md border border-border">
								{#each migrationChoices as o (o.id)}
									<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
										<span class="min-w-0 text-sm text-text"
											>{formatDate(String(o.bookedOn))} · {quantityText(o)}</span
										>
										<button
											type="button"
											class={button}
											onclick={() => migrateWith(String(o.id))}
											disabled={busy}
											data-testid="tx-migration-link">{t('zahlungen.detail.migration.link')}</button
										>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-faint" data-testid="tx-migration-none">
								{t('zahlungen.detail.migration.none')}
							</p>
						{/if}
					</div>
				{/if}
				{#if tx.noReceipt}
					<p class="mt-1 text-sm text-text" data-testid="tx-detail-no-receipt">
						{t('matching.kind.no-receipt', { reason: tx.noReceipt.reason ?? '' })}
					</p>
					<button type="button" class="mt-2 {button}" onclick={needsReceipt} disabled={busy}
						>{t('zahlungen.detail.needsReceipt')}</button
					>
				{/if}
				{#if tx.privateMistake}
					<div class="mt-1 text-sm" data-testid="tx-private">
						<p class="font-medium text-warning">{t(pk('title'))}</p>
						<p class="mt-1 whitespace-pre-wrap text-text" data-testid="tx-private-note">
							{tx.privateMistake.note}
						</p>
						{#if !legalForm}
							<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.private.noLegalForm')}</p>
						{:else if privateRules.settle && !privateRules.payment}
							<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.private.noClearing')}</p>
						{/if}
						{#if privateRules.settle && settlement}
							<p
								class="mt-1 {settlement.openCents ? 'text-warning' : 'text-success'}"
								data-testid="tx-private-state"
							>
								{settlement.openCents
									? t(pk('open'), {
											amount: formatMoney(settlement.openCents, tx.currency ?? 'EUR')
										})
									: t('zahlungen.detail.private.settled')}
							</p>
						{/if}
						{#each settlement?.repayments ?? [] as r (r.id)}
							<p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text">
								<button type="button" class="underline" onclick={() => onopen(String(r.id))}
									>{t(pk('repaidBy'), {
										date: formatDate(String(r.bookedOn)),
										amount: formatMoney(r.amountCents ?? 0, r.currency ?? 'EUR')
									})}</button
								>
								<button
									type="button"
									class="text-faint underline"
									onclick={() => repayUndo(txId, String(r.id))}
									disabled={busy}>{t('zahlungen.detail.private.unlink')}</button
								>
							</p>
						{/each}
						<div class="mt-2 flex flex-wrap gap-2">
							<button
								type="button"
								class={button}
								onclick={() => (repayOpen = !repayOpen)}
								aria-expanded={repayOpen}
								disabled={busy}
								data-testid="tx-private-repay">{t(pk('repay'))}</button
							>
							<button
								type="button"
								class={button}
								onclick={notPrivate}
								disabled={busy}
								data-testid="tx-private-undo">{t('zahlungen.detail.private.undo')}</button
							>
						</div>
						{#if repayOpen}
							<ul class="mt-2 divide-y divide-border rounded-md border border-border">
								{#each repayChoices as o (o.id)}
									<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
										<span class="min-w-0 text-sm text-text"
											>{formatDate(String(o.bookedOn))} · {o.counterparty || '—'} · {String(
												o.purpose ?? ''
											).slice(0, 80)}</span
										>
										<span class="font-mono text-sm text-heading tabular-nums"
											>{formatMoney(o.amountCents ?? 0, o.currency ?? 'EUR')}</span
										>
										<button
											type="button"
											class={button}
											onclick={() => repayWith(String(o.id))}
											disabled={busy}
											data-testid="tx-private-repay-pick"
											>{t('zahlungen.detail.private.repayPick')}</button
										>
									</li>
								{:else}
									<li class="px-3 py-2 text-sm text-faint" data-testid="tx-private-repay-none">
										{t(pk('repayNone'))}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
				{#if tx.privateRepaymentOf?.length}
					<div class="mt-1 text-sm" data-testid="tx-private-repayment">
						<p class="font-medium text-heading">
							{t(`zahlungen.detail.private.repaymentTitle${passOn ? 'Out' : ''}`)}
						</p>
						{#each settlement?.payments ?? [] as p (p.id)}
							<p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text">
								<button type="button" class="underline" onclick={() => onopen(String(p.id))}
									>{t(`zahlungen.detail.private.repays${passOn ? 'Out' : ''}`, {
										date: formatDate(String(p.bookedOn)),
										amount: formatMoney(p.amountCents ?? 0, p.currency ?? 'EUR')
									})}</button
								>
								<button
									type="button"
									class="text-faint underline"
									onclick={() => repayUndo(String(p.id), txId)}
									disabled={busy}>{t('zahlungen.detail.private.unlink')}</button
								>
							</p>
						{/each}
					</div>
				{/if}
				{#each linked as l (l.match.id)}
					{@const r = l.receipt}
					{@const paidOf = invoiceSettlement(r, app.matches, app.transactions)}
					{@const part = instalmentOf(paidOf, txId)}
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
						{#if part}
							<p class="mt-0.5 text-sm text-heading" data-testid="tx-instalment">
								{t('zahlungen.detail.instalment.line', {
									index: part.index,
									count: part.count,
									number: r.invoiceNumber || receiptVendor(r)
								})} ·
								{paidOf.state === 'partial'
									? t('zahlungen.detail.instalment.open', {
											open: formatMoney(paidOf.openCents, r.currency ?? 'EUR')
										})
									: paidOf.state === 'overpaid'
										? t('zahlungen.detail.instalment.over', {
												over: formatMoney(paidOf.overCents, r.currency ?? 'EUR')
											})
										: t('zahlungen.detail.instalment.paid')}
							</p>
						{/if}
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
					{#if linked.length || classification || tx.noReceipt}
						<button
							type="button"
							class={button}
							onclick={() => (assigning = !assigning)}
							disabled={busy}
							aria-expanded={assigning}
							data-testid="tx-assign"
							>{linked.length
								? t('zahlungen.detail.find.other')
								: t('zahlungen.detail.find.open')}</button
						>
					{/if}
					{#if !tx.noReceipt || !tx.receiptId}
						<button
							type="button"
							class={button}
							onclick={() => (altOpen = !altOpen)}
							aria-expanded={altOpen}
							aria-controls="tx-alt"
							data-testid="tx-alt-toggle">{t('zahlungen.detail.alt.toggle')}</button
						>
					{/if}
				</div>
				{#if altOpen}
					<div
						id="tx-alt"
						class="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2"
						data-testid="tx-alt"
					>
						<div class="flex flex-wrap gap-2">
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
							{#if !privateKind(tx) && (tx.amountCents ?? 0) !== 0}
								<button
									type="button"
									class={button}
									onclick={startPrivate}
									aria-expanded={privateAsking}
									disabled={busy}
									title={t('zahlungen.detail.private.markTitle')}
									data-testid="tx-private-mark">{t('zahlungen.detail.private.mark')}</button
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
						{#if privateAsking}
							<form
								class="mt-2 flex flex-col gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									savePrivate();
								}}
								data-testid="tx-private-form"
							>
								<label class="text-sm text-text" for="tx-private-text"
									>{t('zahlungen.detail.private.noteLabel')}</label
								>
								<textarea
									id="tx-private-text"
									class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-heading"
									rows="3"
									bind:value={privateText}
									data-testid="tx-private-text"
								></textarea>
								<p class="text-xs text-faint">{t('zahlungen.detail.private.hint')}</p>
								<div>
									<button type="submit" class={button} disabled={busy} data-testid="tx-private-save"
										>{t('zahlungen.detail.private.save')}</button
									>
								</div>
							</form>
						{/if}
						{#if !tx.receiptId && classification?.via !== 'manual'}
							<div class="mt-2 flex flex-wrap gap-2">
								<button
									type="button"
									class={button}
									onclick={() => {
										linkOpen = !(linkOpen && linkMode === 'transfer');
										linkMode = 'transfer';
										linkAi = null;
									}}
									aria-expanded={linkOpen && linkMode === 'transfer'}
									disabled={busy}
									title={t('zahlungen.detail.linkTransferTitle')}
									data-testid="tx-link-transfer">{t('zahlungen.detail.linkTransfer')}</button
								>
								<button
									type="button"
									class={button}
									onclick={() => {
										linkOpen = !(linkOpen && linkMode === 'refund');
										linkMode = 'refund';
										linkAi = null;
									}}
									aria-expanded={linkOpen && linkMode === 'refund'}
									disabled={busy}
									title={t('zahlungen.detail.linkRefundTitle')}
									data-testid="tx-link-refund">{t('zahlungen.detail.linkRefund')}</button
								>
								{#if tx.quantity}
									<button
										type="button"
										class={button}
										onclick={() => {
											linkOpen = !(linkOpen && linkMode === 'swap');
											linkMode = 'swap';
											linkAi = null;
										}}
										aria-expanded={linkOpen && linkMode === 'swap'}
										disabled={busy}
										title={t('zahlungen.detail.linkSwapTitle')}
										data-testid="tx-link-swap">{t('zahlungen.detail.linkSwap')}</button
									>
								{/if}
							</div>
							{#if linkOpen}
								<div class="mt-2" data-testid="tx-link-transfer-panel">
									<label class="sr-only" for="tx-link-q"
										>{t('zahlungen.detail.linkTransferSearch')}</label
									>
									<input
										id="tx-link-q"
										type="search"
										class="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-heading"
										bind:value={linkQuery}
										placeholder={t('zahlungen.detail.linkTransferSearch')}
										autocomplete="off"
										data-testid="tx-link-transfer-query"
									/>
									{#if client && linkChoices.length && linkMode === 'transfer'}
										<button
											type="button"
											class="mt-2 {button}"
											onclick={suggestTransferByAi}
											disabled={busy || linkAsking}
											title={t('zahlungen.detail.linkTransferAiTitle')}
											data-testid="tx-link-transfer-ai"
											><AiMark />{t('zahlungen.detail.linkTransferAi')}</button
										>
									{/if}
									{#if linkAi}
										<div
											class="mt-2 rounded-md border border-cyan-800/40 bg-surface px-3 py-2 text-sm dark:border-cyan/40"
											role="status"
											data-testid="tx-link-transfer-ai-result"
										>
											{#if linkAi.pick && linkAiRow}
												<p class="text-heading">
													<AiMark />{t('zahlungen.detail.linkTransferAiPick', {
														confidence: t(
															`zahlungen.detail.aiConfidence.${linkAi.pick.confidence}`
														),
														reason: linkAi.pick.reason || '—'
													})}
												</p>
												<p class="mt-1 text-faint">
													{payeeName(linkAiRow, book).name} · {relatedAccount(linkAiRow)} · {formatTxAmount(
														linkAiRow
													)} · {formatDate(linkAiRow.bookedOn)}
												</p>
												<div class="mt-2 flex gap-2">
													<button
														type="button"
														class={primary}
														onclick={() => linkAiRow && linkOther(String(linkAiRow.id))}
														disabled={busy}
														data-testid="tx-link-transfer-ai-take"
														>{t('zahlungen.detail.linkTransferAiTake')}</button
													>
													<button
														type="button"
														class={button}
														onclick={() => (linkAi = null)}
														data-testid="tx-link-transfer-ai-dismiss"
														>{t('zahlungen.detail.linkTransferAiDismiss')}</button
													>
												</div>
											{:else}
												<p class="text-text">
													<AiMark />{t('zahlungen.detail.linkTransferAiNone')}
												</p>
											{/if}
										</div>
									{/if}
									{#if linkChoices.length}
										<ul class="mt-2 divide-y divide-border text-sm">
											{#each linkChoices as other (other.id)}
												<li
													class="flex flex-wrap items-center justify-between gap-2 py-1.5"
													data-testid="tx-link-transfer-choice"
												>
													<span class="min-w-0">
														<span class="text-heading">{payeeName(other, book).name}</span>
														<span class="text-faint">
															· {relatedAccount(other)} · {formatTxAmount(other)} · {formatDate(
																other.bookedOn
															)}</span
														>
													</span>
													<button
														type="button"
														class={button}
														onclick={() => linkOther(String(other.id))}
														disabled={busy}
														data-testid="tx-link-transfer-pick"
														>{t('zahlungen.detail.linkTransferPick')}</button
													>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="mt-2 text-sm text-faint" data-testid="tx-link-transfer-none">
											{linkMode === 'refund'
												? t('zahlungen.detail.linkRefundNone')
												: linkMode === 'swap'
													? t('zahlungen.detail.linkSwapNone')
													: t('zahlungen.detail.linkTransferNone')}
										</p>
									{/if}
								</div>
							{/if}
							<EigenbelegForm {tx} {account} />
						{/if}
					</div>
				{/if}

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

				{#if importNote}
					<p class="mt-2 text-sm text-heading" role="status" data-testid="tx-private-result">
						{importNote}
					</p>
				{/if}
				{#if finding}
					<div class="mt-3 border-t border-border pt-3" data-testid="tx-find">
						<h4 class="text-sm font-semibold text-heading">{t('zahlungen.detail.find.title')}</h4>
						<label class="sr-only" for="tx-find-q">{t('zahlungen.detail.find.label')}</label>
						<input
							id="tx-find-q"
							type="search"
							class="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-heading"
							bind:value={findQuery}
							placeholder={t('zahlungen.detail.find.placeholder')}
							autocomplete="off"
							data-testid="tx-find-query"
						/>
						<div
							class="mt-2 flex flex-wrap gap-1.5"
							role="group"
							aria-label={t('zahlungen.detail.find.sources')}
						>
							{#each [['passend', foundSuggestions.length], ['alle', foundAll.length], ['postfach', hits ? hits.length : null], ['portal', null]] as [id, count] (id)}
								<button
									type="button"
									class="rounded-full border px-3 py-1 text-sm {tab === id
										? 'border-cyan-800 bg-cyan-800 text-white dark:border-cyan dark:bg-cyan dark:text-bg'
										: 'border-border text-text hover:text-heading'}"
									aria-pressed={tab === id}
									onclick={() => pickTab(id)}
									data-testid={`tx-find-tab-${id}`}
									>{t(`zahlungen.detail.find.tab.${id}`)}{#if count !== null}
										<span class="ml-1 font-mono text-xs opacity-80">{count}</span>{/if}</button
								>
							{/each}
						</div>

						<div class="mt-3" data-testid="tx-upload">
							{@render uploadControls()}
						</div>

						{#if tab === 'passend' || tab === 'alle'}
							<div class="mt-3" data-testid="tx-choices">
								{#if client && choices.length}
									<div class="mb-2" data-testid="tx-ai-choice">
										<button
											type="button"
											class="inline-flex items-center gap-1.5 {button}"
											onclick={suggestByAi}
											disabled={aiPicking || busy || Boolean(aiEmpty)}
											title={t('zahlungen.detail.aiChoiceTitle')}
											data-testid="tx-ai-choice-ask"
											><AiMark />{aiPicking
												? t('zahlungen.detail.aiChoiceBusy')
												: t('zahlungen.detail.aiChoice')}</button
										>
										{#if aiEmpty}
											<p class="mt-1 text-sm text-faint" data-testid="tx-ai-choice-empty">
												{t(`zahlungen.detail.aiChoiceEmpty.${aiEmpty}`)}
											</p>
										{:else if aiChoice && !aiChoice.pick}
											<p class="mt-1 text-sm text-text" data-testid="tx-ai-choice-none">
												{t('zahlungen.detail.aiChoiceNone', {
													model: aiChoice.model || t('zahlungen.detail.aiChoiceModel'),
													count: aiChoice.checked.length,
													seconds: aiChoice.seconds
												})}{aiChoice.reason ? `: ${aiChoice.reason}` : '.'}
											</p>
										{/if}
										{#if aiChoice && !aiEmpty}
											<details class="mt-1 text-sm" data-testid="tx-ai-choice-checked">
												<summary class="cursor-pointer text-faint underline"
													>{t('zahlungen.detail.aiChoiceChecked', {
														count: aiChoice.checked.length
													})}</summary
												>
												<ul class="mt-1 space-y-0.5 text-xs text-text">
													{#each aiChoice.checked as c (c.id)}
														<li data-testid="tx-ai-choice-checked-item">
															{[
																c.vendor,
																c.amount ? `${c.amount} ${c.currency ?? ''}`.trim() : '',
																c.date,
																c.number
															]
																.filter(Boolean)
																.join(' · ')}
														</li>
													{/each}
												</ul>
											</details>
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
								{#each rows as c (c.receipt.id)}
									{@const scam = scamSigns(c.receipt, scamCtx).suspicious}
									<div
										class="mt-1 flex items-center gap-2 border-t border-border py-2"
										onpointerenter={(e) => {
											if (e.pointerType !== 'touch') peek.hover(c.receipt, rowOf(e));
										}}
										onpointerleave={(e) => {
											if (e.pointerType !== 'touch') peek.leave();
										}}
										onfocusin={(e) => peek.show(c.receipt, rowOf(e))}
										onfocusout={(e) => {
											const next = /** @type {Node | null} */ (e.relatedTarget);
											if (!next || !rowOf(e).contains(next)) peek.leave();
										}}
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
													.join(' · ')}</span
											>
											{#if c.alongside}
												<span
													class="block truncate text-xs text-heading"
													data-testid="tx-choice-instalment"
													>{t('zahlungen.detail.instalment.offer', {
														open: formatMoney(c.alongside.openCents, c.receipt.currency ?? 'EUR'),
														count: c.alongside.payments.length
													})}</span
												>
											{/if}
											<span class="block truncate text-xs text-text" data-testid="tx-choice-diff"
												>{[
													receiptDiff(c.receipt),
													c.score > 0
														? `${t('matching.score', { score: c.score })} (${reasonText(c.reasons)})`
														: ''
												]
													.filter(Boolean)
													.join(' · ')}</span
											>
										</span>
										{#if canPeek(c.receipt)}
											<!-- No hover on a touch screen: the preview on a tap. -->
											<button
												type="button"
												class="hidden text-xs text-text underline pointer-coarse:inline"
												aria-expanded={peeked?.receipt.id === c.receipt.id}
												onclick={(e) => peek.toggle(c.receipt, rowOf(e))}
												data-testid="tx-choice-peek">{t('zahlungen.detail.peek.open')}</button
											>
										{/if}
										{#if scam}
											<span
												class="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
												data-testid="tx-choice-scam">{t('belege.scam.badge')}</span
											>
										{/if}
										<button
											type="button"
											class={c.score >= 90 && !scam ? primary : button}
											onclick={() => {
												peek.close();
												assign(c.receipt.id, c.score, c.reasons, Boolean(c.alongside));
											}}
											disabled={busy}
											data-testid="tx-choose"
											>{c.alongside
												? t('zahlungen.detail.instalment.choose')
												: t('zahlungen.detail.choose')}</button
										>
									</div>
								{:else}
									<p class="mt-2 text-sm text-faint" data-testid="tx-find-none">
										{findQuery.trim()
											? t('zahlungen.detail.find.noMatch')
											: tab === 'passend'
												? t('zahlungen.detail.find.noSuggestion')
												: t('zahlungen.detail.noChoices')}
									</p>
								{/each}
							</div>
						{:else if tab === 'postfach'}
							<div class="mt-3" data-testid="tx-find-mailbox">
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
																	confidence: t(
																		`zahlungen.detail.aiConfidence.${assist.pick.confidence}`
																	),
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
														<p class="text-sm font-medium break-words text-heading">
															{hit.subject}
														</p>
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
													terms:
														assist.terms.map((x) => t('language.quoted', { text: x })).join(', ') ||
														'—',
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
												{assisting
													? t('zahlungen.detail.aiSearching')
													: t('zahlungen.detail.aiSearch')}
											</button>
											<p class="mt-1 text-xs text-faint">{t('zahlungen.detail.aiSearchHint')}</p>
										{/if}
									{/if}
									{#if hitReceipts.length}
										<ul
											class="mt-1 divide-y divide-border text-sm"
											data-testid="tx-private-receipts"
										>
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
														<span class="text-danger"
															>⚠ {t('zahlungen.detail.receiptConfirmFirst')}</span
														>
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
							</div>
						{:else}
							<div class="mt-3" data-testid="tx-vendor">
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
							</div>
						{/if}
					</div>
				{/if}
				{#if !finding}
					<div class="mt-3 border-t border-border pt-3" data-testid="tx-upload">
						{@render uploadControls()}
					</div>
				{/if}
			</section>

			<div id="tx-konto-part" class="scroll-mt-4"><BookingBlock {tx} /></div>

			{#if error}
				<p class="mt-3 text-sm text-danger" role="alert" data-testid="tx-detail-error">{error}</p>
			{/if}

			<section class="mt-4" id="tx-others" data-testid="tx-others">
				<button
					type="button"
					class="flex w-full items-center justify-between gap-2 text-left"
					onclick={() => (othersOpen = !othersOpen)}
					aria-expanded={othersOpen}
					data-testid="tx-others-toggle"
				>
					<h3 class="text-sm font-semibold text-heading">
						{t(
							(tx.amountCents ?? 0) > 0
								? 'zahlungen.detail.othersIn'
								: 'zahlungen.detail.othersOut',
							{
								// A wallet's counterparty is an address: its name, or its short form.
								name: (parties ? payee?.name : tx.counterparty) || '—'
							}
						)} ({others.length})
					</h3>
					{#if othersWithout}
						<span class="text-sm text-amber-800 dark:text-amber-200"
							>{t('zahlungen.detail.othersMissing', { count: othersWithout })}</span
						>
					{/if}
				</button>
				{#if othersOpen}
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
											class="rounded border px-1.5 py-0.5 text-xs {isTxCovered(
												o,
												app.classifications
											)
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
				{/if}
			</section>
			{#if receiptState === 'missing' || !isBookingConfirmed(tx)}
				<div
					class="sticky bottom-0 -mx-4 mt-4 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden"
					data-testid="tx-next"
				>
					<span class="flex-1 text-xs text-faint">{t('zahlungen.detail.next')}</span>
					<button
						type="button"
						class={primary}
						onclick={() =>
							scrollToPart(receiptState === 'missing' ? 'tx-receipt-part' : 'tx-konto-part')}
						data-testid="tx-next-button"
						>{receiptState === 'missing'
							? t('zahlungen.detail.find.title')
							: t('zahlungen.detail.nextKonto')}</button
					>
				</div>
			{/if}
		{/if}
	</div>
</div>
