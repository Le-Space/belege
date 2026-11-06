// node --test scripts/ci-changes.test.mjs – runs in each workflow's `changes` job.
import assert from 'node:assert/strict';
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
