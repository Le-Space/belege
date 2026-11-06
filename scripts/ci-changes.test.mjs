// node --test scripts/ci-changes.test.mjs – runs in each workflow's `changes` job.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { needs } from './ci-changes.mjs';

const pr = (...files) => needs('pull_request', files);
const all = { unit: true, bridge: true, e2e: 'full' };

test('anything but a pull request runs everything', () => {
	for (const event of ['push', 'workflow_dispatch', 'workflow_call', 'release', '']) {
		assert.deepEqual(needs(event, ['docs/x.md']), all);
	}
});

test('a pull request without a file list runs everything', () => {
	assert.deepEqual(pr(), all);
});

test('docs only: the unit tests (they read the docs), no browser, no bridge', () => {
	assert.deepEqual(pr('docs/banking.de.md', 'README.md', 'CHANGELOG.md'), {
		unit: true,
		bridge: false,
		e2e: 'none'
	});
});

test('the bridge only: its tests, the unit tests and the specs that pair a bridge', () => {
	assert.deepEqual(pr('bridge/src/chains/filecoin.js', 'bridge/test/filecoin.test.js'), {
		unit: true,
		bridge: true,
		e2e: 'bridge'
	});
	assert.deepEqual(pr('bridge/README.md'), {
		unit: false,
		bridge: true,
		e2e: 'none'
	});
});

test("the bridge's fakes run every spec", () => {
	assert.deepEqual(pr('bridge/test/support/synthetic-pdf.js'), all);
	assert.deepEqual(pr('bridge/package.json'), all);
});

test('the app: unit and every spec, not the bridge', () => {
	assert.deepEqual(pr('app/src/lib/ledger.js', 'docs/ai.md'), {
		unit: true,
		bridge: false,
		e2e: 'full'
	});
});

test('app and bridge together: everything', () => {
	assert.deepEqual(pr('app/src/routes/+page.svelte', 'bridge/src/server.js'), all);
});

test('packages, the lockfile and unknown files: everything', () => {
	for (const file of [
		'packages/device-gate/src/index.js',
		'packages/chain-new',
		'pnpm-lock.yaml',
		'package.json',
		'new-thing.txt',
		'scripts/ci-changes.mjs'
	]) {
		assert.deepEqual(pr(file), all, file);
	}
});

test('a workflow file: itself, and the bridge job that checks its shell', () => {
	assert.deepEqual(pr('.github/workflows/release.yml'), {
		unit: false,
		bridge: true,
		e2e: 'none'
	});
	assert.deepEqual(pr('.github/workflows/e2e.yml'), {
		unit: false,
		bridge: true,
		e2e: 'full'
	});
	assert.deepEqual(pr('.github/workflows/unit.yml'), {
		unit: true,
		bridge: true,
		e2e: 'none'
	});
});

test('outside the workspace: nothing', () => {
	assert.deepEqual(pr('spikes/imap/probe.mjs', 'e2e-remote/remote.mjs', 'LICENSE'), {
		unit: false,
		bridge: false,
		e2e: 'none'
	});
});

test('a chain package: its tests, the bridge, the unit tests and the specs that pair a bridge', () => {
	for (const file of [
		'packages/chain-cosmos/src/cosmos.js',
		'packages/chain-core/src/http.js',
		'packages/chain-filecoin/test/support/fake-filfox.js'
	]) {
		assert.deepEqual(pr(file), { unit: true, bridge: true, e2e: 'bridge' }, file);
	}
	assert.deepEqual(pr('packages/chain-cosmos/README.md'), {
		unit: false,
		bridge: false,
		e2e: 'none'
	});
});

// The narrowing above holds only while the app reaches the chain packages
// through its unit specs and the specs that pair a bridge, nowhere else.
test('in the app, only unit specs and the bridge specs use the chain packages', () => {
	const repo = join(import.meta.dirname, '..');
	const bridgeSpecs = new Set(
		[
			...readFileSync(join(repo, 'app/e2e/bridge.js'), 'utf8').matchAll(/^\t'([a-z0-9-]+)',?$/gm)
		].map((m) => `${m[1]}.spec.js`)
	);
	assert.ok(bridgeSpecs.size > 10, 'BRIDGE_SPECS read from app/e2e/bridge.js');
	const USES = /@belege\/chain-|@belege\/bridge\/(chains|testing\/(chains|filfox|alchemy))\b/;
	/** @param {string} dir @returns {string[]} */
	const files = (dir) =>
		readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? files(join(dir, e.name))
				: /\.(js|svelte)$/.test(e.name)
					? [join(dir, e.name)]
					: []
		);
	const offenders = [...files(join(repo, 'app/src')), ...files(join(repo, 'app/e2e'))].filter(
		(path) => {
			if (!USES.test(readFileSync(path, 'utf8'))) return false;
			if (path.includes('/app/src/') && path.endsWith('.spec.js')) return false;
			if (path.includes('/app/e2e/') && bridgeSpecs.has(path.split('/').pop() ?? '')) return false;
			return true;
		}
	);
	assert.deepEqual(
		offenders.map((p) => p.slice(repo.length + 1)),
		[],
		'these use a chain package: give them e2e full in ci-changes.mjs, or add them to BRIDGE_SPECS'
	);
});
