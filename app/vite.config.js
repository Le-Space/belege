// Ported from Le-Space/simple-todo apps/invoice01 (vite.config.js) at 56647d5.
// Changed: the build stamp is the last commit touching the app (not a
// chapter's), no version defines; unit tests run in Node rather than in a
// browser, because the store test drives a real OrbitDB and Helia there.
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const isVitest = Boolean(process.env.VITEST);

/**
 * The commit the footer names, and that commit's instant — never the build
 * clock (Le-Space time and date convention), so a rebuild of one commit gives
 * the same bytes. The last commit that touched the app or what it is built
 * with; a change to the bridge alone does not restamp it. Without git, two
 * empty strings, and the footer leaves the stamp out.
 */
function lastAppCommit() {
	try {
		const cwd = fileURLToPath(new URL('.', import.meta.url));
		const out = execFileSync(
			'git',
			['log', '-1', '--format=%H%n%cI', '--', '.', '../package.json', '../pnpm-lock.yaml'],
			{ cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		).trim();
		const [commit = '', date = ''] = out.split('\n');
		return commit && date ? { commit, date } : { commit: '', date: '' };
	} catch {
		return { commit: '', date: '' };
	}
}

const built = lastAppCommit();

export default defineConfig({
	test: {
		include: ['src/**/*.spec.js'],
		environment: 'node',
		testTimeout: 30_000
	},
	define: {
		__BUILD_COMMIT__: JSON.stringify(built.commit),
		__BUILD_DATE__: JSON.stringify(built.date)
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
