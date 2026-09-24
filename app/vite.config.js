// Ported from Le-Space/simple-todo apps/invoice01 (vite.config.js) at 56647d5.
// Changed: no build stamps and no chapter commit; unit tests run in Node
// rather than in a browser, because the store test drives a real OrbitDB and
// Helia there.
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const isVitest = Boolean(process.env.VITEST);

export default defineConfig({
	test: {
		include: ['src/**/*.spec.js'],
		environment: 'node',
		testTimeout: 30_000
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		// libp2p, Helia and the identity provider still reach for Node's
		// `Buffer`, `process` and friends in a browser. Node has them already.
		...(isVitest
			? []
			: [
					nodePolyfills(
						/** @type {any} */ ({
							include: ['buffer', 'process', 'events', 'util', 'crypto', 'stream'],
							globals: { Buffer: true, global: true, process: true },
							protocolImports: true
						})
					)
				])
	]
});
