// Ported from Le-Space/simple-todo packages/todo (src/build-info.js) at f0d3df4.
// Changed: only `builtFrom` and `shortCommit`; this app shows no dependency
// versions.

/* global __BUILD_COMMIT__, __BUILD_DATE__, __BUILD_RELEASE__ */

/**
 * The release name baked in by vite.config.js: `v0.2.0`, `v0.2.0+3` (three
 * commits after v0.2.0), or '' when unknown.
 *
 * @returns {string}
 */
export function releaseName() {
	const r = typeof __BUILD_RELEASE__ === 'string' ? __BUILD_RELEASE__.trim() : '';
	return /^v\d+\.\d+\.\d+(\+\d+)?$/.test(r) ? r : '';
}

/**
 * What this bundle was built from: the commit, and that commit's instant.
 *
 * Both are baked in by vite.config.js from `git log`, never from the build
 * clock (the Le-Space time and date convention): a rebuild of the same commit
 * gives the same bytes. A build without git has neither, and then there is
 * nothing to show.
 *
 * @returns {{ commit: string, short: string, when: Date } | null}
 */
export function builtFrom() {
	const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__.trim().toLowerCase() : '';
	const short = shortCommit(commit);
	const iso = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
	const when = iso ? new Date(iso) : null;
	if (!short || !when || Number.isNaN(when.getTime())) return null;
	return { commit, short, when };
}

/**
 * Seven characters, as `git log --oneline` prints them; empty for anything
 * that is not a commit.
 *
 * @param {string | null | undefined} sha
 * @returns {string}
 */
export function shortCommit(sha) {
	const trimmed = String(sha ?? '').trim();
	if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return '';
	return trimmed.slice(0, 7).toLowerCase();
}

/** Where this app's source lives: this repository, never a tool it uses. */
export const SOURCE_URL = 'https://github.com/Le-Space/belege';
