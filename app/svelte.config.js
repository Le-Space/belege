// Ported from Le-Space/simple-todo apps/invoice01 (svelte.config.js) at 56647d5.
// Changed: no shared brand assets folder; an SPA fallback page, because every
// route renders in the browser only (the data lives in IndexedDB).
import adapter from '@sveltejs/adapter-static';

import { cspDirectives } from './csp.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: '200.html' }),
		// Registered by lib/pwa/pwa.svelte.js, so a new version waits for "Neu laden" (issue #141).
		serviceWorker: { register: false },
		// The Content-Security-Policy of every page, as a meta tag with the hash
		// of SvelteKit's start script (csp.js, #535).
		csp: {
			mode: 'hash',
			directives: /** @type {any} */ (cspDirectives({ e2e: process.env.VITE_E2E === 'true' }))
		}
	}
};

export default config;
