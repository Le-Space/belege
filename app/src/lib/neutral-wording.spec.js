// Neutral wording (#334): the export is a DATEV format many bookkeeping
// programs read, so the app, its docs and its sources name the format and
// "your bookkeeping", never one product. This keeps it so.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const self = fileURLToPath(import.meta.url);
/** Built from parts, so this file does not name it either. */
const NAMED = new RegExp(['mon', 'key', '\\s*', 'off', 'ice'].join(''), 'i');
const SKIP = new Set(['node_modules', '.svelte-kit', 'build', 'dist', 'test-results', '.git']);
const TEXT = /\.(js|mjs|svelte|md|html|json|txt|css)$/;

/** @param {string} dir @returns {string[]} */
function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		if (SKIP.has(name)) return [];
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return TEXT.test(name) && path !== self ? [path] : [];
	});
}

describe('neutral wording (#334)', () => {
	it('no bookkeeping product is named in the app, the docs or the sources', () => {
		const roots = ['app/src', 'app/e2e', 'app/static', 'bridge/src', 'docs', 'schema'].map((r) =>
			join(repo, r)
		);
		const found = [
			...roots.flatMap((r) => files(r)),
			join(repo, 'README.md'),
			join(repo, 'CHANGELOG.md')
		].filter((path) => NAMED.test(readFileSync(path, 'utf8')));
		expect(found.map((path) => relative(repo, path))).toEqual([]);
	});
});
