// node --test scripts/check-production-build.test.mjs – runs in unit.yml.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBuild } from './check-production-build.mjs';

const SCRIPT = fileURLToPath(new URL('./check-production-build.mjs', import.meta.url));

/** @param {Record<string, string>} files @returns {string} a built site with these files */
function site(files) {
	const dir = mkdtempSync(join(tmpdir(), 'belege-build-check-'));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(dir, name, '..'), { recursive: true });
		writeFileSync(join(dir, name), text);
	}
	return dir;
}

const CLEAN = {
	'index.html': '<!doctype html><script type="module" src="/_app/start.js"></script>',
	'_app/start.js': 'const a=globalThis.belege;export{a};'
};

test('a clean build passes and says how much it read', () => {
	const out = execFileSync('node', [SCRIPT, site(CLEAN)], { encoding: 'utf8' });
	assert.match(out, /no test hook in 2 files \(1 scripts\)/);
});

for (const [what, text] of Object.entries({
	'the E2E hook': 'window.__belegeE2E={secrets:()=>s}',
	'the PRF override': 'const f=globalThis.__belegeTestPrf;',
	'a switch a spec sets on the page': 'const d=Number(globalThis.__belegeBackupAutoDelayMs)||6e4;',
	'a kept branch on the build flag': 'const x={};if(x?.VITE_E2E==="true"){}',
	'the key export': 'return{secretsForE2E:{databaseKey:k}}',
	'the test booking button': '<button data-testid="add-test-transaction">'
})) {
	test(`${what} fails the check, minified into a chunk`, () => {
		const dir = site({
			...CLEAN,
			'_app/immutable/chunks/x.js': `const q=1;${text};export{q};`
		});
		assert.equal(checkBuild(dir).findings.length, 1);
		const run = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
		assert.equal(run.status, 1);
		assert.match(run.stderr, /_app\/immutable\/chunks\/x\.js: /);
		assert.match(run.stderr, /contains test hooks/);
	});
}

test('a hook in the page itself is found, too', () => {
	const dir = site({
		...CLEAN,
		'index.html': '<script>window.__belegeE2E</script>'
	});
	assert.deepEqual(
		checkBuild(dir).findings.map((f) => [f.file, f.match]),
		[['index.html', '__belegeE2E']]
	);
});

test('a directory without a script is not a clean build', () => {
	const run = spawnSync('node', [SCRIPT, site({ 'readme.txt': 'nothing here' })], {
		encoding: 'utf8'
	});
	assert.equal(run.status, 2);
	assert.match(run.stderr, /no script found/);
});
