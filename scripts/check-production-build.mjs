#!/usr/bin/env node
// A production build carries no test hook (AGENTS.md, "Web app"; #536).
//
//   node scripts/check-production-build.mjs app/build
//
// Reads every text file of the built site and fails when one of them names
// what only a build for the end-to-end tests may contain. The names are
// property names on `window`/`globalThis` and strings, which a minifier keeps
// as they are – so a hook that is compiled in is found, whether or not it
// would run.
//
// Runs after `pnpm run build` in unit.yml, on the build the production spec
// tested in e2e.yml, and in deploy.yml on the very directory that is published.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What a production build must not contain, and why it would be there. */
export const FORBIDDEN = [
	{
		// `window.__belegeE2E`, the PRF override `__belegeTestPrf`, and every
		// switch the specs set on the page: all are named `__belege…`.
		name: 'a test global (__belege…)',
		pattern: /__belege[A-Za-z0-9_]*/g
	},
	{
		// The flag itself: where it is left in the bundle, a branch for the
		// tests was kept instead of dropped.
		name: 'the test build flag (VITE_E2E)',
		pattern: /VITE_E2E/g
	},
	{
		// node.js hands the session's keys to the E2E hook under this name.
		name: 'the key export for tests (secretsForE2E)',
		pattern: /secretsForE2E/g
	},
	{
		// The button "Testbuchung anlegen" on the payments page.
		name: 'the test booking button (add-test-transaction)',
		pattern: /add-test-transaction/g
	}
];

const TEXT = /\.(m?js|html?|css|json|webmanifest|svg|txt|xml|map)$/;

/** @param {string} dir @returns {string[]} */
function filesIn(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? filesIn(path) : [path];
	});
}

/**
 * @param {string} dir the built site
 * @returns {{ scripts: number, files: number, findings: { file: string, name: string, match: string, count: number }[] }}
 */
export function checkBuild(dir) {
	const files = filesIn(dir).filter((file) => TEXT.test(file));
	/** @type {{ file: string, name: string, match: string, count: number }[]} */
	const findings = [];
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		for (const { name, pattern } of FORBIDDEN) {
			/** @type {Map<string, number>} */
			const counts = new Map();
			for (const [match] of text.matchAll(pattern)) counts.set(match, (counts.get(match) ?? 0) + 1);
			for (const [match, count] of counts) {
				findings.push({ file: relative(dir, file), name, match, count });
			}
		}
	}
	return {
		scripts: files.filter((f) => /\.m?js$/.test(f)).length,
		files: files.length,
		findings
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2];
	if (!dir) {
		console.error('usage: node scripts/check-production-build.mjs <build directory>');
		process.exit(2);
	}
	const { scripts, files, findings } = checkBuild(dir);
	// An empty or wrong directory must not pass for a clean build.
	if (scripts === 0) {
		console.error(`${dir}: no script found – is this the built site?`);
		process.exit(2);
	}
	for (const f of findings) {
		console.error(`${f.file}: ${f.name}: ${f.match}${f.count > 1 ? ` (${f.count}×)` : ''}`);
	}
	if (findings.length) {
		console.error(`\n${dir}: this build contains test hooks. A production build must not.`);
		process.exit(1);
	}
	console.log(`${dir}: no test hook in ${files} files (${scripts} scripts).`);
}
