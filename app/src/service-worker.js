// The service worker (issue #141): the app shell offline, nothing else.
// Registered by lib/pwa/pwa.svelte.js, not by SvelteKit, so that a new
// version waits until the person reloads (a switch under an open session
// would lock the books). The rules are in lib/pwa/cache-rules.js.
/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { base, build, files, version } from '$service-worker';
import { FALLBACK, cacheDecision, shellFiles, shellFor } from '$lib/pwa/cache-rules.js';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = `belege-${version}`;
// Where the build is served: '' at the origin's root, '/ipfs/<cid>' on a path
// gateway – read by `$service-worker` from the worker's own address.
const ASSETS = shellFiles(build, files, base);
const assets = new Set(ASSETS);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// The fallback is adapter-static's: a build served by `vite preview`
			// (the e2e suite) has none. Its absence must not fail the install;
			// the start page stands in for it below.
			await cache.addAll(ASSETS.filter((a) => a !== base + FALLBACK));
			await cache.add(base + FALLBACK).catch(() => {});
		})()
	);
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
			// A page: the network first, so an update is seen; offline, the shell
			// (the start page at the root, the fallback for a deeper route – or
			// the start page again where there is no fallback: right for a route
			// one level deep, as its base is still the root).
			try {
				return await fetch(request);
			} catch (error) {
				const shell =
					(await cache.match(shellFor(url.pathname, base))) ?? (await cache.match(base + '/'));
				if (shell) return shell;
				throw error;
			}
		})()
	);
});
