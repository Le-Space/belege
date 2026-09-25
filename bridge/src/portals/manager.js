// The local portal connector: a Chromium (Playwright) that the bridge starts
// with a persistent profile per portal, under <config dir>/portals/<id>/profile
// (0700). It logs in to a customer portal and downloads the invoices.
//
// - Login: a visible window on the portal's login page. With a password in
//   the keychain the recipe fills the form; a one-time code, a bot check or
//   anything unexpected is left to the user in that window. The bridge waits
//   until the recipe sees "logged in" (10 minutes), or the window is closed,
//   or the run is cancelled. The session then lives in the profile.
// - Fetch: headless on the same profile. An expired session is logged in
//   again with the stored password when that works without the user;
//   otherwise it answers 409 PORTAL_NEEDS_LOGIN and the app asks for a login.
// - Every download must be a PDF by its bytes and at most 15 MB. The bytes
//   are kept in memory for the app to pick up (GET …/invoice), never on disk
//   outside the browser's own download folder, which Playwright deletes.
// - Record ("Portal aufzeichnen", ./recorder.js): the visible window on the
//   portal's start page; the user clicks to the invoices and downloads one.
//   Stop returns the steps for review, save writes the route as a local
//   recipe override (<config dir>/recipes/<id>.json, 0600) and rebuilds the
//   portal's recipe, so the next fetch replays it.
// - One run at a time per portal; a recording counts as one.
//
// Nothing of a page (text, HTML, screenshots) is logged, stored or sent
// anywhere; the log names the step that failed. No LLM is involved.

import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { PortalError, busy, needsLogin, stepFailed, unknownPortal } from './errors.js';
import { MAX_INVOICE_BYTES, isPdf } from './pdf.js';
import {
	buildOverride,
	readOverride,
	review,
	startRecording,
	validateOverride,
	writeOverride
} from './recorder.js';

export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
export const RECORD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * @typedef {object} PortalState what is on disk in state.json; no secret, no page content
 * @property {string | null} lastLoginAt
 * @property {'logged-in' | 'needs-login' | null} session
 * @property {{ at: string, ok: boolean, count?: number, refused?: number, code?: string, step?: string | null } | null} lastRun
 */

/**
 * @typedef {object} InvoiceMeta what the app gets for one invoice
 * @property {string} id
 * @property {string | null} date YYYY-MM-DD
 * @property {string | null} period YYYY-MM
 * @property {number | null} amountCents
 * @property {string | null} invoiceNumber
 * @property {string} fileName
 * @property {number} size
 * @property {string} sha256
 */

/**
 * @typedef {(profileDir: string, options: { headless: boolean }) => Promise<import('playwright').BrowserContext>} Launch
 */

/** @type {Launch} */
export async function launchChromium(profileDir, { headless }) {
	const { chromium } = await import('playwright');
	return chromium.launchPersistentContext(profileDir, {
		headless,
		acceptDownloads: true,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
		viewport: headless ? { width: 1280, height: 900 } : null
	});
}

/**
 * @param {object} options
 * @param {Record<string, import('./recipe.js').Recipe>} options.recipes by id
 * @param {string} options.dir <config dir>/portals
 * @param {(id: string) => Promise<{ username: string, password: string } | null>} options.credentials
 *   null when no password is stored; called only when a login form is on screen
 * @param {Launch} [options.launch]
 * @param {'auto' | 'always'} [options.headless] `always` only in tests: nobody could act in a window
 * @param {(id: string) => boolean} [options.visibleFetch] true: fetches in a visible window too
 * @param {number} [options.loginTimeoutMs]
 * @param {number} [options.recordTimeoutMs] a recording nobody stops ends by itself
 * @param {string} [options.recipesDir] <config dir>/recipes, where recordings are saved; none: recording is off
 * @param {(id: string) => import('./recipe.js').Recipe} [options.rebuild] the portal's recipe as built from disk again
 * @param {(event: { portal: string, reason: string, page: import('playwright').Page }) => void} [options.onUserNeeded]
 *   for tests: what a person would do in the window (reason `record` while recording)
 * @param {(line: string) => void} [options.log]
 */
export function createPortalManager({
	recipes,
	dir,
	credentials,
	launch = launchChromium,
	headless = 'auto',
	visibleFetch = () => false,
	loginTimeoutMs = LOGIN_TIMEOUT_MS,
	recordTimeoutMs = RECORD_TIMEOUT_MS,
	recipesDir,
	rebuild,
	onUserNeeded,
	log = () => {}
}) {
	/** @type {Map<string, { kind: string, cancel: () => void }>} */
	const running = new Map();
	/** @type {Map<string, Map<string, { meta: InvoiceMeta, bytes: Buffer | null, ref: any }>>} */
	const invoices = new Map();
	/** @type {Map<string, { stop: () => Promise<void> }>} recordings in progress */
	const recordings = new Map();
	/** @type {Map<string, import('./recorder.js').Recording>} stopped, not yet saved or discarded */
	const recorded = new Map();

	/** @param {string} id */
	function recipeOf(id) {
		const recipe = Object.hasOwn(recipes, id) ? recipes[id] : null;
		if (!recipe) throw unknownPortal(id);
		return recipe;
	}

	const portalDir = (/** @type {string} */ id) => join(dir, id);
	const profileDir = (/** @type {string} */ id) => join(dir, id, 'profile');
	const statePath = (/** @type {string} */ id) => join(dir, id, 'state.json');

	/** @param {string} path */
	async function exists(path) {
		return stat(path).then(
			() => true,
			() => false
		);
	}

	/** @param {string} id @returns {Promise<PortalState>} */
	async function readState(id) {
		try {
			return {
				lastLoginAt: null,
				session: null,
				lastRun: null,
				...JSON.parse(await readFile(statePath(id), 'utf8'))
			};
		} catch {
			return { lastLoginAt: null, session: null, lastRun: null };
		}
	}

	/** @param {string} id @param {Partial<PortalState>} patch */
	async function writeState(id, patch) {
		const next = { ...(await readState(id)), ...patch };
		await ensureDirs(id);
		const tmp = `${statePath(id)}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
		await rename(tmp, statePath(id));
		return next;
	}

	/** @param {string} id */
	async function ensureDirs(id) {
		for (const d of [dir, portalDir(id), profileDir(id)]) {
			await mkdir(d, { recursive: true, mode: 0o700 });
			if (process.platform !== 'win32') await chmod(d, 0o700);
		}
	}

	/**
	 * @template T
	 * @param {string} id
	 * @param {string} kind
	 * @param {(signal: AbortSignal) => Promise<T>} fn
	 * @returns {Promise<T>}
	 */
	async function exclusive(id, kind, fn) {
		if (running.has(id)) throw busy(id);
		const controller = new AbortController();
		running.set(id, { kind, cancel: () => controller.abort() });
		try {
			return await fn(controller.signal);
		} finally {
			running.delete(id);
		}
	}

	/**
	 * Runs one recipe step; a failure becomes PORTAL_STEP_FAILED naming the step,
	 * and the log gets the step and the error's class only.
	 *
	 * @param {string} id
	 */
	const stepper =
		(id) =>
		/** @template T @param {string} name @param {() => Promise<T>} fn @returns {Promise<T>} */
		async (name, fn) => {
			try {
				return await fn();
			} catch (/** @type {any} */ error) {
				if (error instanceof PortalError) throw error;
				log(`portal ${id}: step ${name} failed (${error?.name ?? 'Error'})`);
				throw stepFailed(id, name);
			}
		};

	/**
	 * @param {string} id
	 * @param {boolean} wantHeadless
	 */
	async function open(id, wantHeadless) {
		await ensureDirs(id);
		/** @type {import('playwright').BrowserContext} */
		let context;
		try {
			context = await launch(profileDir(id), {
				headless: headless === 'always' ? true : wantHeadless
			});
		} catch (/** @type {any} */ error) {
			if (/Executable doesn't exist|playwright install/i.test(String(error?.message))) {
				throw new PortalError(
					'The browser for the portals is not installed: run `pnpm --filter @belege/bridge exec playwright install chromium`.',
					'PORTAL_BROWSER_MISSING',
					503
				);
			}
			// Chromium allows one process per profile.
			if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(String(error?.message))) {
				throw new PortalError(
					'The portal profile is in use by another browser.',
					'PORTAL_PROFILE_IN_USE',
					409
				);
			}
			throw error;
		}
		recipeOf(id).attach?.(context);
		const page = context.pages()[0] ?? (await context.newPage());
		return { context, page };
	}

	/**
	 * Waits until one of the context's pages is logged in; the user is at work.
	 *
	 * @param {import('./recipe.js').Recipe} recipe
	 * @param {import('playwright').BrowserContext} context
	 * @param {AbortSignal} signal
	 */
	async function waitForUser(recipe, context, signal) {
		let closed = false;
		context.once('close', () => (closed = true));
		const end = Date.now() + loginTimeoutMs;
		while (Date.now() < end) {
			if (signal.aborted)
				throw new PortalError('The login was cancelled.', 'PORTAL_CANCELLED', 409);
			if (closed) throw new PortalError('The login window was closed.', 'PORTAL_CANCELLED', 409);
			for (const page of context.pages()) {
				if (await recipe.isLoggedIn(page).catch(() => false)) return;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		throw new PortalError('Nobody logged in within the time allowed.', 'PORTAL_LOGIN_TIMEOUT', 408);
	}

	/**
	 * Logged in by the recipe with stored credentials, without the user.
	 *
	 * @param {string} id
	 * @param {import('./recipe.js').Recipe} recipe
	 * @param {import('playwright').Page} page
	 * @returns {Promise<string>} the outcome: logged-in, otp, captcha, rejected, unknown, no-password
	 */
	async function loginByRecipe(id, recipe, page) {
		const step = stepper(id);
		const creds = await credentials(id);
		if (!creds) return 'no-password';
		if (!page.url().startsWith(recipe.loginUrl)) {
			await step('login.open', () => page.goto(recipe.loginUrl));
		}
		const result = await recipe.login(page, creds, step);
		log(`portal ${id}: login by recipe: ${result}`);
		return result;
	}

	return {
		/** Every known portal, with what is on disk about it. Starts no browser. */
		async list() {
			const out = [];
			for (const [id, recipe] of Object.entries(recipes)) {
				const state = await readState(id);
				const hasProfile = await exists(profileDir(id));
				out.push({
					id,
					name: recipe.name,
					recipeVersion: recipe.version,
					state:
						!hasProfile || !state.lastLoginAt
							? 'never'
							: state.session === 'logged-in'
								? 'logged-in'
								: 'needs-login',
					lastLoginAt: state.lastLoginAt,
					lastRun: state.lastRun,
					running: running.get(id)?.kind ?? null,
					recordable: Boolean(recipesDir && rebuild),
					recorded: Boolean(recipe.definition.recorded),
					review: recorded.has(id)
				});
			}
			return out;
		},

		/**
		 * Opens the visible window and returns once logged in.
		 *
		 * @param {string} id
		 */
		async login(id) {
			const recipe = recipeOf(id);
			return exclusive(id, 'login', async (signal) => {
				const step = stepper(id);
				const { context, page } = await open(id, false);
				try {
					await step('login.open', () => page.goto(recipe.loginUrl));
					if (!(await recipe.isLoggedIn(page))) {
						const result = await loginByRecipe(id, recipe, page);
						if (result !== 'logged-in') {
							log(`portal ${id}: waiting for the user in the window (${result})`);
							onUserNeeded?.({ portal: id, reason: result, page });
							await waitForUser(recipe, context, signal);
						}
					}
					log(`portal ${id}: logged in`);
					const state = await writeState(id, {
						lastLoginAt: new Date().toISOString(),
						session: 'logged-in'
					});
					return { state: 'logged-in', lastLoginAt: state.lastLoginAt };
				} finally {
					await context.close().catch(() => {});
				}
			});
		},

		/** Ends a waiting login. @param {string} id */
		cancel(id) {
			recipeOf(id);
			const run = running.get(id);
			if (run?.kind === 'login') run.cancel();
			return { cancelled: run?.kind === 'login' };
		},

		/**
		 * Lists the invoices from `since` on and downloads those not in `known`.
		 *
		 * @param {string} id
		 * @param {{ since: string, known?: string[] }} options since YYYY-MM
		 */
		async fetch(id, { since, known = [] }) {
			const recipe = recipeOf(id);
			if (!(await exists(profileDir(id))) || !(await readState(id)).lastLoginAt) {
				throw needsLogin(id, 'never');
			}
			const skip = new Set(known);
			return exclusive(id, 'fetch', async () => {
				const step = stepper(id);
				const { context, page } = await open(id, !visibleFetch(id));
				try {
					await step('session.open', () => page.goto(recipe.invoicesUrl));
					if (!(await recipe.isLoggedIn(page))) {
						const result = await loginByRecipe(id, recipe, page);
						if (result !== 'logged-in') {
							await writeState(id, {
								session: 'needs-login',
								lastRun: { at: new Date().toISOString(), ok: false, code: 'PORTAL_NEEDS_LOGIN' }
							});
							log(`portal ${id}: session expired (${result})`);
							throw needsLogin(id, result === 'no-password' ? 'expired' : result);
						}
						await writeState(id, { lastLoginAt: new Date().toISOString(), session: 'logged-in' });
					}
					const listed = await recipe.listInvoices(page, step, (line) =>
						log(`portal ${id}: ${line}`)
					);
					const wanted = listed.filter(
						(inv) => (inv.period ?? inv.date?.slice(0, 7) ?? '') >= since
					);
					/** @type {Map<string, { meta: InvoiceMeta, bytes: Buffer | null, ref: any }>} */
					const cache = invoices.get(id) ?? new Map();
					invoices.set(id, cache);
					/** @type {InvoiceMeta[]} */
					const out = [];
					/** @type {{ id: string, code: string }[]} */
					const errors = [];
					let skipped = 0;
					for (const inv of wanted) {
						if (skip.has(inv.id)) {
							skipped++;
							continue;
						}
						const bytes = await download(id, recipe, page, inv.downloadRef).catch((error) => {
							errors.push({ id: inv.id, code: error.code ?? 'PORTAL_DOWNLOAD_FAILED' });
							return null;
						});
						if (!bytes) continue;
						const meta = {
							id: inv.id,
							date: inv.date,
							period: inv.period,
							amountCents: inv.amountCents,
							invoiceNumber: inv.invoiceNumber,
							fileName: `${recipe.name.replace(/\s+/g, '-')}-${inv.id}.pdf`,
							size: bytes.length,
							sha256: createHash('sha256').update(bytes).digest('hex')
						};
						cache.set(inv.id, { meta, bytes, ref: inv.downloadRef });
						out.push(meta);
					}
					await writeState(id, {
						session: 'logged-in',
						lastRun: {
							at: new Date().toISOString(),
							// Some invoices fetched and some refused is a run that worked.
							ok: errors.length === 0 || out.length > 0,
							count: out.length,
							...(errors.length ? { refused: errors.length, code: errors[0].code } : {})
						}
					});
					log(
						`portal ${id}: listed ${listed.length}, from ${since}: ${wanted.length}, downloaded ${out.length}, known ${skipped}, refused ${errors.length}`
					);
					return { since, listed: wanted.length, skipped, invoices: out, errors };
				} catch (/** @type {any} */ error) {
					if (error instanceof PortalError && error.code === 'PORTAL_STEP_FAILED') {
						await writeState(id, {
							lastRun: {
								at: new Date().toISOString(),
								ok: false,
								code: error.code,
								step: error.step
							}
						});
					}
					throw error;
				} finally {
					await context.close().catch(() => {});
				}
			});
		},

		/**
		 * The bytes of one invoice from the last fetch.
		 *
		 * @param {string} id
		 * @param {string} invoiceId
		 */
		async invoice(id, invoiceId) {
			recipeOf(id);
			const hit = invoices.get(id)?.get(invoiceId);
			if (!hit?.bytes) {
				throw new PortalError(
					'This invoice is not from the last fetch; fetch again.',
					'PORTAL_UNKNOWN_INVOICE',
					404
				);
			}
			return hit.bytes;
		},

		/**
		 * Ends the session on the portal when it can, then deletes the profile.
		 *
		 * @param {string} id
		 */
		async logout(id) {
			const recipe = recipeOf(id);
			return exclusive(id, 'logout', async () => {
				if (await exists(profileDir(id))) {
					try {
						const { context, page } = await open(id, true);
						try {
							await page.goto(recipe.invoicesUrl, { timeout: 20_000 });
							if (await recipe.isLoggedIn(page)) await recipe.logout(page);
						} finally {
							await context.close().catch(() => {});
						}
					} catch (/** @type {any} */ error) {
						log(
							`portal ${id}: logout on the portal failed (${error?.name ?? 'Error'}); deleting the profile anyway`
						);
					}
				}
				await rm(portalDir(id), { recursive: true, force: true });
				invoices.delete(id);
				log(`portal ${id}: profile deleted`);
				return { state: 'never' };
			});
		},

		/**
		 * Opens the visible window on the portal's start page and records the
		 * user's clicks until `recordStop`. Returns once the page is open.
		 *
		 * @param {string} id
		 */
		async recordStart(id) {
			const recipe = recipeOf(id);
			if (!recipesDir || !rebuild) throw recordingOff();
			if (running.has(id)) throw busy(id);
			/** @type {() => void} */
			let cancel = () => {};
			running.set(id, { kind: 'record', cancel: () => cancel() });
			recorded.delete(id);
			try {
				const step = stepper(id);
				const { context, page } = await open(id, false);
				const session = await startRecording({
					context,
					recipe,
					log: (line) => log(`portal ${id}: ${line}`)
				}).catch(async (error) => {
					await context.close().catch(() => {});
					throw error;
				});
				/** @type {Promise<void> | null} */
				let stopping = null;
				// Once, whoever ends it first (stop, discard, the window, the timeout); the others wait for it.
				const stop = () => (stopping ??= end());
				const end = async () => {
					clearTimeout(timer);
					recorded.set(id, await session.stop());
					recordings.delete(id);
					running.delete(id);
					await context.close().catch(() => {});
					const r = session.recording;
					log(
						`portal ${id}: recording stopped: ${r.steps.filter((s) => s.kind === 'click').length} click(s), download ${r.download ? 'seen' : 'not seen'}, ${r.pausedOnLogin} on a login page not recorded`
					);
				};
				const timer = setTimeout(() => void stop(), recordTimeoutMs);
				// Closing the window ends the recording too; what was recorded stays for review.
				context.once('close', () => void stop());
				cancel = () => void stop();
				recordings.set(id, { stop });
				try {
					await step('record.open', () => page.goto(recipe.baseUrl));
				} catch (error) {
					await stop();
					recorded.delete(id);
					throw error;
				}
				log(`portal ${id}: recording`);
				onUserNeeded?.({ portal: id, reason: 'record', page });
				return { recording: true };
			} catch (error) {
				if (!recordings.has(id)) running.delete(id);
				throw error;
			}
		},

		/**
		 * Ends the recording (if one runs) and returns its steps for review:
		 * roles, labels and masked paths only.
		 *
		 * @param {string} id
		 */
		async recordStop(id) {
			recipeOf(id);
			await recordings.get(id)?.stop();
			const r = recorded.get(id);
			if (!r) throw nothingRecorded();
			return review(r);
		},

		/**
		 * Saves the stopped recording as the portal's recipe override and
		 * rebuilds the recipe: the next fetch replays the route.
		 *
		 * @param {string} id
		 */
		async recordSave(id) {
			const recipe = recipeOf(id);
			if (!recipesDir || !rebuild) throw recordingOff();
			if (running.has(id)) throw busy(id);
			const r = recorded.get(id);
			if (!r) throw nothingRecorded();
			const patch = validateOverride(buildOverride(recipe.definition, r), id);
			writeOverride(recipesDir, id, patch);
			recipes[id] = rebuild(id);
			recorded.delete(id);
			log(`portal ${id}: recorded recipe saved (${patch.route.length} route step(s))`);
			return { saved: true, recipeVersion: recipes[id].version, route: patch.route.length };
		},

		/** Ends a recording and drops it, or drops a stopped one. @param {string} id */
		async recordDiscard(id) {
			recipeOf(id);
			await recordings.get(id)?.stop();
			const had = recorded.delete(id);
			if (had) log(`portal ${id}: recording discarded`);
			return { discarded: had };
		},

		/**
		 * The saved override, for sharing (a future @le-space/portal-recipes).
		 *
		 * @param {string} id
		 */
		recipeExport(id) {
			recipeOf(id);
			const patch = recipesDir ? readOverride(recipesDir, id) : null;
			if (!patch) {
				throw new PortalError(
					'This portal has no recorded recipe.',
					'PORTAL_NO_RECORDED_RECIPE',
					404
				);
			}
			return patch;
		},

		/** Cancels waiting logins and ends recordings; for the bridge's shutdown. */
		close() {
			for (const run of running.values()) run.cancel();
		}
	};

	/**
	 * @param {string} id
	 * @param {import('./recipe.js').Recipe} recipe
	 * @param {import('playwright').Page} page
	 * @param {any} ref
	 */
	async function download(id, recipe, page, ref) {
		/** @type {Buffer} */
		let bytes;
		try {
			bytes = await recipe.download(page, ref, { maxBytes: MAX_INVOICE_BYTES });
		} catch (/** @type {any} */ error) {
			if (error?.tooLarge) throw new PortalError('Larger than 15 MB.', 'PORTAL_TOO_LARGE', 502);
			log(`portal ${id}: step invoices.download failed (${error?.name ?? 'Error'})`);
			throw stepFailed(id, 'invoices.download');
		}
		if (bytes.length > MAX_INVOICE_BYTES) {
			log(`portal ${id}: refused a download larger than 15 MB`);
			throw new PortalError('Larger than 15 MB.', 'PORTAL_TOO_LARGE', 502);
		}
		if (!isPdf(bytes)) {
			log(
				`portal ${id}: refused a download that is not a PDF (${sniff(bytes)}, ${bytes.length} bytes, by ${ref?.href ? 'link' : ref?.kind === 'api' ? 'api' : 'click'})`
			);
			throw new PortalError('Not a PDF.', 'PORTAL_NOT_PDF', 502);
		}
		return bytes;
	}
}

const recordingOff = () =>
	new PortalError('Recording is not available on this bridge.', 'PORTAL_RECORDING_OFF', 503);

const nothingRecorded = () =>
	new PortalError('Nothing was recorded; start a recording first.', 'PORTAL_NOT_RECORDED', 409);

/**
 * What a download is instead of a PDF, from its first bytes; its content is never logged.
 *
 * @param {Uint8Array} bytes
 */
export function sniff(bytes) {
	if (!bytes?.length) return 'empty';
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 512))
		.toString('latin1')
		.trimStart()
		.toLowerCase();
	if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
	if (head.startsWith('<?xml') || head.startsWith('<')) return 'xml or html';
	if (head.startsWith('{') || head.startsWith('[')) return 'json';
	if (head.startsWith('pk')) return 'zip';
	if (head.startsWith('\x89png')) return 'png';
	if (head.startsWith('\xff\xd8')) return 'jpeg';
	return 'unknown';
}

/** @typedef {ReturnType<typeof createPortalManager>} PortalManager */
