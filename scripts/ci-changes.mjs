#!/usr/bin/env node
// Which test workflows a pull request needs, from the files it changes.
//
//   git diff --name-only HEAD^1 HEAD | node scripts/ci-changes.mjs pull_request
//
// prints `unit=…`, `bridge=…` and `e2e=…` lines for $GITHUB_OUTPUT:
//
//   unit    true | false
//   bridge  true | false               (the bridge's tests and the Windows job)
//   e2e     full | bridge | none       (bridge: only the specs that pair a
//                                       bridge, app/e2e/bridge.js BRIDGE_SPECS)
//
// Anything but a pull request – a push to main, a release (ci.yml through
// workflow_call), a run by hand – gets everything: only a pull request is
// narrowed. A file this script does not know runs everything, too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FULL = Object.freeze({ unit: true, bridge: true, e2e: 'full' });
const E2E_RANK = { none: 0, bridge: 1, full: 2 };

/**
 * What one changed file needs.
 *
 * @param {string} file a path relative to the repository's root
 * @returns {{ unit?: boolean, bridge?: boolean, e2e?: 'full' | 'bridge' | 'none' }}
 */
export function needsOf(file) {
	// Not part of the workspace or of these three workflows.
	if (/^(spikes|e2e-remote)\//.test(file)) return {};
	if (file === 'LICENSE' || /^\.github\/ISSUE_TEMPLATE\//.test(file)) return {};

	// The workflows: each runs itself; the bridge job checks every workflow's shell.
	if (file === '.github/workflows/unit.yml') return { unit: true, bridge: true };
	if (file === '.github/workflows/bridge.yml') return { bridge: true };
	if (file === '.github/workflows/e2e.yml') return { e2e: 'full', bridge: true };
	if (/^\.github\/workflows\//.test(file)) return { bridge: true };
	if (file === 'scripts/check-workflow-shell.rb') return { bridge: true };

	// The docs: the unit tests read them (neutral wording, app/src/lib/neutral-wording.spec.js).
	if (/^docs\//.test(file) || /^[^/]+\.md$/.test(file)) return { unit: true };

	// The Agent Skills and the plugin manifests: their test runs in the unit
	// workflow (skills/test/skills.test.js, Le-Space/eigenbeleg-agent#29).
	if (/^skills\//.test(file) || /^\.claude-plugin\//.test(file)) return { unit: true };

	if (/^bridge\//.test(file)) {
		// The README's command table is a bridge test (bridge/test/readme.test.js).
		if (/\.md$/.test(file)) return { bridge: true };
		// The fakes the browser specs start (@belege/bridge/testing/*, in
		// test/support), and the exports the app imports.
		if (/^bridge\/test\/support\//.test(file) || file === 'bridge/package.json') return FULL;
		// The launcher and what the Phala image runs before the bridge: the
		// Phala spec runs them for real (app/e2e/hosted-bridge-phala.spec.js).
		if (/^bridge\/tee\/(launcher|dstack)\/.*\.(m?js|json)$/.test(file)) return FULL;
		// The specs that pair a bridge run it.
		return { unit: true, bridge: true, e2e: 'bridge' };
	}

	if (/^app\//.test(file)) return { unit: true, e2e: 'full' };

	// The shared packages (Le-Space/eigenbeleg-agent#6). The chain readers,
	// the ledger, the PDF/A fonts and the Eigenbeleg ship in the app too
	// (wallets/filecoin-address.js, receipts/self-receipt.js), so they run
	// everything. The day's rate runs in the bridge only: its tests, the
	// unit tests and the specs that pair a bridge – ci-changes.test.mjs checks
	// that nothing else in the app imports it. The browser-test helper is
	// only for the packages' own tests (packages.yml).
	if (/^packages\/(chains|ledger|rates|pdf|eigenbeleg|browser-test)\/.*\.md$/.test(file)) return {};
	if (/^packages\/rates\//.test(file)) return { unit: true, bridge: true, e2e: 'bridge' };
	if (/^packages\/browser-test\//.test(file)) return {};
	// The demo films' kit: used by app/e2e-video, which no workflow records.
	if (/^packages\/video-kit\//.test(file)) return {};

	// The other packages (device-gate: the app's sync uses it too), schema/,
	// the lockfile, the root package.json, patches/, this script, and
	// whatever is new.
	return FULL;
}

/**
 * @param {string} event github.event_name
 * @param {string[]} files the changed files
 */
export function needs(event, files) {
	// No list (a diff that came back empty) is no reason to test less.
	if (event !== 'pull_request' || files.length === 0) return { ...FULL };
	const out = { unit: false, bridge: false, e2e: 'none' };
	for (const file of files) {
		const n = needsOf(file);
		out.unit ||= Boolean(n.unit);
		out.bridge ||= Boolean(n.bridge);
		if (n.e2e && E2E_RANK[n.e2e] > E2E_RANK[out.e2e]) out.e2e = n.e2e;
	}
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const event = process.argv[2] ?? '';
	const files =
		event === 'pull_request'
			? readFileSync(0, 'utf8')
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			: [];
	const out = needs(event, files);
	for (const [key, value] of Object.entries(out)) console.log(`${key}=${value}`);
}
