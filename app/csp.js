// The page's Content-Security-Policy (#535, audit plan #209): what the app may
// load, run and talk to. SvelteKit writes it into every built page as a
// `<meta http-equiv>` (svelte.config.js, `kit.csp`) and adds the hash of its
// own start script – a header is not ours to set on an IPFS gateway.
//
// What it does: no script but the app's own files (no inline script, no
// `eval`, nothing from another host), no plugin content, no `<base>` pointing
// elsewhere, no form posted anywhere, one frame (the payment page of Le Space
// Credits). What it does not do is written down in docs/threat-model.md: a
// meta policy cannot forbid being framed, and `connect-src` stays wide.

/**
 * @param {{ e2e?: boolean }} [options] `e2e`: a build for the end-to-end tests, whose
 *   stand-in for the payment page is on this machine
 * @returns {Record<string, string[]>}
 */
export function cspDirectives({ e2e = false } = {}) {
	return {
		'default-src': ['none'],
		// WebAssembly is compiled (the cryptography of the dependencies); that is
		// all `wasm-unsafe-eval` allows. No `unsafe-eval`, no `unsafe-inline`.
		'script-src': ['self', 'wasm-unsafe-eval'],
		'style-src': ['self'],
		// `style="…"` attributes, which the components' markup carries. Not
		// stylesheets: those are the app's own files only.
		'style-src-attr': ['unsafe-inline'],
		// Receipt previews and generated images are blob: and data: URLs.
		'img-src': ['self', 'data:', 'blob:'],
		'font-src': ['self'],
		// Not a list of hosts: relays can be set by the person, Aleph's nodes and
		// a hosted bridge's name are known only at run time. So: TLS anywhere, and
		// this machine in the clear (the bridge on 127.0.0.1, its node's WebSocket).
		'connect-src': [
			'self',
			'https:',
			'wss:',
			'data:',
			'blob:',
			'http://127.0.0.1:*',
			'ws://127.0.0.1:*',
			'http://localhost:*',
			'ws://localhost:*'
		],
		'worker-src': ['self'],
		'manifest-src': ['self'],
		'media-src': ['self', 'blob:'],
		// The payment page of Le Space Credits (credits/credits.js, CREDITS_URL).
		'frame-src': ['https://credits.le-space.de', ...(e2e ? ['http://127.0.0.1:*'] : [])],
		// Trusted Types: the places where text becomes markup or a script —
		// innerHTML, DOMParser, a worker's URL — take only values a named policy
		// made, so a string from a mail, a file or a synced record cannot reach
		// them by mistake. The policies: Svelte's own for its templates,
		// lib/trusted-xml.js for parsing XML files into a document of their own,
		// and lib/pwa/pwa.svelte.js for the app's own service worker.
		'require-trusted-types-for': ['script'],
		'trusted-types': ['svelte-trusted-html', 'belege-xml', 'belege-service-worker'],
		'object-src': ['none'],
		'base-uri': ['self'],
		'form-action': ['none']
	};
}
