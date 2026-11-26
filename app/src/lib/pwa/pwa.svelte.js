// The PWA's side in the page (issue #141): registers the service worker,
// says when a new version waits ("Neu laden"), and offers the browser's
// install prompt where there is one (Chromium's beforeinstallprompt).
// Nothing here in the dev server: it would cache what Vite serves.
import { dev } from '$app/environment';
import { base } from '$app/paths';
import { sharedOrigin } from '$lib/shared-origin.js';

export const pwa = $state({
	/** The browser offers to install the app. */
	installable: false,
	/** A new version is installed and waits for a reload. */
	updateReady: false,
	/** Running as an installed app (its own window). */
	standalone: false
});

/** @type {any} the browser's install prompt, kept until used */
let prompt = null;
/** @type {ServiceWorkerRegistration | null} */
let registration = null;

/** @param {ServiceWorkerRegistration} reg */
function watch(reg) {
	const waiting = () => {
		if (reg.waiting && navigator.serviceWorker.controller) pwa.updateReady = true;
	};
	waiting();
	reg.addEventListener('updatefound', () => {
		reg.installing?.addEventListener('statechange', waiting);
	});
}

/** Once, from the root layout. */
export async function startPwa() {
	if (typeof window === 'undefined') return;
	pwa.standalone = matchMedia('(display-mode: standalone)').matches;
	addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		prompt = event;
		pwa.installable = true;
	});
	addEventListener('appinstalled', () => {
		prompt = null;
		pwa.installable = false;
	});
	if (dev || !('serviceWorker' in navigator)) return;
	if (sharedOrigin()) {
		// No worker and no cache on an origin other CIDs share (shared-origin.js);
		// one an earlier build registered here goes.
		await dropWorkers().catch(() => {});
		return;
	}
	try {
		// Beside the page, at the origin's root (its own origin: the domain or a
		// subdomain gateway).
		registration = await navigator.serviceWorker.register(
			/** @type {any} */ (serviceWorkerUrl(`${base}/service-worker.js`))
		);
		watch(registration);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// Only after "Neu laden": the first install claims the page without one.
			if (pwa.updateReady) location.reload();
		});
	} catch {
		// Refused (a private window, a policy): the app works as before.
	}
}

/** This build's workers and caches on this origin, removed. */
/** @type {{ createScriptURL: (url: string) => unknown } | null | undefined} */
let workerPolicy;

/**
 * The service worker's URL as the page's Trusted Types rule wants it (csp.js):
 * `register()` takes only a TrustedScriptURL. The policy makes one for the
 * app's own worker, beside the page, and refuses any other URL. Made on first
 * use, so a module evaluated again does not try to make it twice.
 * @param {string} path
 */
function serviceWorkerUrl(path) {
	if (workerPolicy === undefined) {
		workerPolicy =
			/** @type {any} */ (window).trustedTypes?.createPolicy('belege-service-worker', {
				createScriptURL: (/** @type {string} */ url) => {
					const wanted = new URL(`${base}/service-worker.js`, location.href);
					const asked = new URL(url, location.href);
					if (asked.href !== wanted.href) throw new TypeError("not the app's service worker");
					return asked.href;
				}
			}) ?? null;
	}
	return workerPolicy ? workerPolicy.createScriptURL(path) : path;
}

async function dropWorkers() {
	const scope = new URL(`${base}/`, location.href).href;
	for (const reg of await navigator.serviceWorker.getRegistrations()) {
		if (reg.scope === scope) await reg.unregister();
	}
	for (const name of await caches.keys()) {
		if (name.startsWith('belege-')) await caches.delete(name);
	}
}

/** "Als App installieren". */
export async function installApp() {
	if (!prompt) return;
	prompt.prompt();
	await prompt.userChoice.catch(() => null);
	prompt = null;
	pwa.installable = false;
}

/** "Neu laden": the waiting version takes over, and the page reloads. */
export function applyUpdate() {
	const waiting = registration?.waiting;
	if (!waiting) {
		location.reload();
		return;
	}
	waiting.postMessage('skip-waiting');
}
