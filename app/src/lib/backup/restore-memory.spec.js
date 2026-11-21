// A backup larger than the memory its restore may use (#512).
//
// The first restore of a real backup on a phone ended without a word: the
// sealed file, its plaintext and its blocks were in memory at once, three
// times the backup, and Android Chrome ends such a tab. Here a backup of
// 48 MiB is restored into a node whose blocks are on disk, as the app's are,
// under a ceiling of 24 MiB of buffers – half the backup. The same backup
// sealed in one piece, as before #512, is restored too, to show that the
// ceiling is one the old way breaks: a "streamed" restore that quietly
// gathered the file would fail here.
//
// Each run is a process of its own (bench/restore-memory.js), because what
// is measured is that process's ArrayBuffers after a collection. Node's
// `--max-old-space-size` would not do: it bounds the JavaScript heap, and
// the bytes of a Uint8Array are outside it.
//
// Node on a desk, not Chrome on a phone: this proves the code holds little,
// not that a given phone has enough.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HELPER = fileURLToPath(new URL('../../../bench/restore-memory.js', import.meta.url));
const MIB = 1024 * 1024;
const SIZE = 48;
const CEILING = 24 * MIB;

/** @param {'frames' | 'one-piece'} mode */
async function measure(mode) {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		['--expose-gc', '--no-warnings', HELPER, mode, String(SIZE)],
		// Not this process's options: vitest's loader flags are not the helper's.
		{ env: { ...process.env, NODE_OPTIONS: '' }, maxBuffer: MIB }
	);
	return JSON.parse(/** @type {string} */ (stdout.trim().split('\n').at(-1)));
}

describe('what a restore holds in memory (#512)', () => {
	it('in frames: 48 MiB restored under 24 MiB of buffers', async () => {
		const run = await measure('frames');
		expect(run.size).toBeGreaterThan(SIZE * MIB);
		expect(run.streamed).toBe(true);
		// All of it arrived, and the books are back.
		expect(run.blocks).toBe(run.expected);
		expect(run.records).toBe(1);
		expect(run.peak).toBeLessThan(CEILING);
	}, 180_000);

	it('in one piece, as before: the same backup takes more than twice its size', async () => {
		const run = await measure('one-piece');
		expect(run.streamed).toBe(false);
		expect(run.blocks).toBe(run.expected);
		expect(run.records).toBe(1);
		expect(run.peak).toBeGreaterThan(CEILING);
		expect(run.peak).toBeGreaterThan(2 * SIZE * MIB);
	}, 180_000);
});
