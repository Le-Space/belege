// The service worker (issue #141): the app shell offline, nothing else.
// Registered by lib/pwa/pwa.svelte.js, not by SvelteKit, so that a new
// version waits until the person reloads (a switch under an open session
// would lock the books). The rules are in lib/pwa/cache-rules.js.
/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { SHELL, cacheDecision, shellFiles } from '$lib/pwa/cache-rules.js';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = `belege-${version}`;
const ASSETS = shellFiles(build, files);
const assets = new Set(ASSETS);

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys())
				if (key.startsWith('belege-') && key !== CACHE) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

// "Neu laden" in the app: the waiting version takes over.
sw.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	const decision = cacheDecision(url, {
		origin: sw.location.origin,
		assets,
		method: request.method,
		mode: request.mode
	});
	if (decision === 'network') return;
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (decision === 'asset') return (await cache.match(url.pathname)) ?? fetch(request);
			// A page: the network first, so an update is seen; offline, the shell.
			try {
				return await fetch(request);
			} catch (error) {
				const shell = await cache.match(SHELL);
				if (shell) return shell;
				throw error;
			}
		})()
	);
});
