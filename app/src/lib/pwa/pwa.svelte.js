// The PWA's side in the page (issue #141): registers the service worker,
// says when a new version waits ("Neu laden"), and offers the browser's
// install prompt where there is one (Chromium's beforeinstallprompt).
// Nothing here in the dev server: it would cache what Vite serves.
import { dev } from '$app/environment';

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
	try {
		registration = await navigator.serviceWorker.register('/service-worker.js');
		watch(registration);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// Only after "Neu laden": the first install claims the page without one.
			if (pwa.updateReady) location.reload();
		});
	} catch {
		// Refused (a private window, a policy): the app works as before.
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
