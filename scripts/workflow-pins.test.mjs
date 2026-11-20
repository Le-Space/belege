// node --test scripts/workflow-pins.test.mjs – runs in bridge.yml, which every
// change to a workflow starts (scripts/ci-changes.mjs).
//
// The deploy chain (#534, audit plan #209): whoever can change what a workflow
// runs can change what belege.le-space.de serves. So
//   - every action is named by a commit, with its version beside it – a tag
//     can be moved to other code, a commit cannot;
//   - nothing a workflow installs comes from outside a lockfile;
//   - a deploy takes a release tag and nothing else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../.github/workflows', import.meta.url));
const workflows = readdirSync(DIR)
	.filter((name) => /\.ya?ml$/.test(name))
	.map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));
/** A workflow's lines without its comments. @param {string} text */
const code = (text) =>
	text
		.split('\n')
		.map((line, i) => ({ line, number: i + 1 }))
		.filter(({ line }) => !/^\s*#/.test(line));

test('there are workflows to check', () => {
	assert.ok(workflows.some((w) => w.name === 'deploy.yml'));
});

test('every action is pinned to a commit, with its version as a comment', () => {
	/** @type {string[]} */
	const loose = [];
	for (const { name, text } of workflows) {
		for (const { line, number } of code(text)) {
			const uses = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
			if (!uses) continue;
			const [, what, rest] = uses;
			// A workflow or action of this repository: the same commit as the caller.
			if (what.startsWith('./')) continue;
			if (!/@[0-9a-f]{40}$/.test(what) || !/^\s+#\s*\S/.test(rest)) {
				loose.push(`${name}:${number}: ${line.trim()}`);
			}
		}
	}
	assert.deepEqual(loose, []);
});

/**
 * Installs that take whatever the registry serves under a name today, outside
 * the deploy chain of the site: named here so that a new one fails this test.
 * Each is to move into a lockfile too.
 */
const OTHER_CHAINS = [
	// The attest relay inside the bridge image, built from a pinned commit of relay-button.
	/^bridge-image\.yml: npm install --no-package-lock /,
	// The attestation check of a try-out VM: two pinned versions, no lockfile.
	/^bridge-try\.yml: .*npm install .*@le-space\/attest-wasm@[\d.]+ ethers@[\d.]+\)$/,
	// The npm that publishes the packages with provenance: a pinned version.
	/^packages-publish\.yml: run: npm install --global npm@[\d.]+$/
];

test('nothing is installed from outside a lockfile', () => {
	/** @type {string[]} */
	const found = [];
	for (const { name, text } of workflows) {
		for (const { line } of code(text)) {
			// `npm install`, `npx <package>`, `pnpm add`, `pnpm dlx`, a `pnpm install`
			// that may change the lockfile: each fetches what a name resolves to today.
			const fetches =
				/\bnpm\s+(install|i|add)\b/.test(line) ||
				/\b(npx|pnpm\s+dlx|pnpm\s+add|yarn\s+add|yarn\s+dlx)\s/.test(line) ||
				(/\bpnpm\s+install\b/.test(line) && !/--frozen-lockfile/.test(line));
			if (fetches) found.push(`${name}: ${line.trim()}`);
		}
	}
	const unknown = found.filter((line) => !OTHER_CHAINS.some((known) => known.test(line)));
	assert.deepEqual(unknown, []);
	// The list is not longer than what is there: an entry that no longer matches goes.
	for (const known of OTHER_CHAINS)
		assert.ok(
			found.some((line) => known.test(line)),
			String(known)
		);
	// The site's own chain has none at all.
	assert.deepEqual(
		found.filter((line) => /^(deploy|release|ci|unit|e2e|bridge|packages)\.yml:/.test(line)),
		[]
	);
});

const deploy = String(workflows.find((w) => w.name === 'deploy.yml')?.text);

test('the deploy tool comes from its own lockfile, pinned to one version', () => {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const pkg = JSON.parse(readFileSync(join(root, 'deploy/package.json'), 'utf8'));
	assert.match(pkg.dependencies['@le-space/node'], /^\d+\.\d+\.\d+$/);
	const lock = readFileSync(join(root, 'deploy/pnpm-lock.yaml'), 'utf8');
	assert.ok(lock.includes(`'@le-space/node@${pkg.dependencies['@le-space/node']}`));
	// Both jobs that hold the key install it frozen, apart from the workspace, without scripts.
	const installs = deploy.match(
		/working-directory: deploy\n\s+run: pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts/g
	);
	assert.equal(installs?.length, 2);
	assert.ok(!deploy.includes('/tmp/le-space-deployer'));
});

test('both jobs that hold the key run in the environment `production`, after the tag was checked', () => {
	for (const job of ['publish', 'link-domain']) {
		const body =
			new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`).exec(deploy)?.[1] ?? '';
		assert.match(body, /\n    environment: production\n/, job);
		assert.match(body, /(^|\n)    needs: \[tag, /, job);
		assert.match(body, /ref: refs\/tags\/\$\{\{ needs\.tag\.outputs\.tag \}\}/, job);
		assert.match(body, /ALEPH_PRIVATE_KEY: \$\{\{ secrets\.ALEPH_PRIVATE_KEY \}\}/, job);
	}
	// Nothing else is checked out: not a branch, not what a caller passes as it is.
	assert.ok(!/ref: \$\{\{ (inputs\.ref|github\.ref)/.test(deploy));
	// The key is named in those two jobs only (and once where a caller hands it in).
	assert.equal(deploy.match(/secrets\.ALEPH_PRIVATE_KEY/g)?.length, 2);
});

/** The shell of the step that decides which tag is deployed, run with an event's values. */
function whichTag(/** @type {Record<string, string>} */ env) {
	const script = /- name: Which tag\n[\s\S]*?run: \|\n([\s\S]*?)\n      - uses:/.exec(deploy)?.[1];
	assert.ok(script, 'the step is there');
	const out = join(mkdtempSync(join(tmpdir(), 'belege-deploy-tag-')), 'output');
	writeFileSync(out, '');
	const run = spawnSync('bash', ['-c', script.replace(/^ {10}/gm, '')], {
		env: {
			PATH: process.env.PATH ?? '',
			GITHUB_OUTPUT: out,
			GIVEN: '',
			RELEASED: '',
			REF: '',
			...env
		},
		encoding: 'utf8'
	});
	return { status: run.status, output: readFileSync(out, 'utf8').trim(), said: run.stdout };
}

test('a deploy takes a release tag and nothing else', () => {
	// A published release; release.yml's call, whose event is whatever started
	// release.yml (a run by hand, on main); a run of deploy.yml by hand from a tag.
	assert.deepEqual(whichTag({ EVENT: 'release', RELEASED: 'v1.2.3' }).output, 'tag=v1.2.3');
	assert.deepEqual(
		whichTag({ EVENT: 'workflow_dispatch', GIVEN: 'v0.43.0', REF: 'refs/heads/main' }).output,
		'tag=v0.43.0'
	);
	assert.deepEqual(
		whichTag({ EVENT: 'workflow_dispatch', REF: 'refs/tags/v0.43.0' }).output,
		'tag=v0.43.0'
	);
	// By hand from a branch; a branch, a commit or anything with more in it handed in.
	for (const env of [
		{ EVENT: 'workflow_dispatch', REF: 'refs/heads/main' },
		{ EVENT: 'workflow_dispatch', REF: 'refs/heads/v1.2.3' },
		{ EVENT: 'workflow_dispatch', REF: 'refs/tags/nightly' },
		{ EVENT: 'workflow_dispatch', GIVEN: 'main', REF: 'refs/tags/v1.2.3' },
		{ EVENT: 'workflow_dispatch', GIVEN: '0123456789abcdef0123456789abcdef01234567' },
		{ EVENT: 'workflow_dispatch', GIVEN: 'v1.2.3-rc.1' },
		{ EVENT: 'workflow_dispatch', GIVEN: 'v1.2.3\nmain' },
		{ EVENT: 'push', REF: 'refs/heads/main' },
		{ EVENT: 'release', RELEASED: 'nightly' }
	]) {
		const run = whichTag(env);
		assert.equal(run.status, 1, JSON.stringify(env));
		assert.equal(run.output, '', JSON.stringify(env));
	}
});
