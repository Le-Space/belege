// Which browser specs a shard runs: by how long they take, not by how many
// they are.
//
// Playwright's own `--shard` deals the tests out by count, so one runner got
// the long specs and the pull request waited for it. Here the specs are dealt
// out by their measured time (app/e2e/durations.json, seconds per spec file):
// the longest first, each to the shard that has the least so far. A spec the
// file does not know yet counts as a middling one, so a new spec needs no
// entry to run.
//
// playwright.config.js reads E2E_SHARD ("3/5") and asks this for its specs.
// The times come from CI's own reports: scripts/e2e-report.mjs --durations.

/**
 * @param {string[]} specs the spec names of this run, without `.spec.js`
 * @param {Record<string, number>} durations seconds per spec
 * @param {number} total how many shards
 * @returns {string[][]} the specs of each shard, each list sorted by name
 */
export function shards(specs, durations, total) {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`Not a number of shards: ${total}`);
  const known = specs
    .map((name) => durations[name])
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  const middle = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (/** @type {string} */ name) => {
    const s = durations[name];
    return Number.isFinite(s) && s > 0 ? s : middle;
  };
  // The same answer on every runner: ties by name, then by the lower shard.
  const order = [...new Set(specs)].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const bins = Array.from({ length: total }, () => ({
    sum: 0,
    specs: /** @type {string[]} */ ([]),
  }));
  for (const name of order) {
    let least = bins[0];
    for (const bin of bins) if (bin.sum < least.sum) least = bin;
    least.specs.push(name);
    least.sum += weight(name);
  }
  return bins.map((bin) => bin.specs.sort());
}

/**
 * E2E_SHARD's value: "3/5" is the third of five.
 *
 * @param {string | undefined} value
 * @returns {{ index: number, total: number } | null} null: no shard asked for
 */
export function parseShard(value) {
  if (!value) return null;
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  const [index, total] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  if (!m || index < 1 || total < 1 || index > total) {
    throw new Error(`E2E_SHARD is "${value}": expected e.g. 3/5`);
  }
  return { index, total };
}

/**
 * The specs of one shard.
 *
 * @param {string[]} specs
 * @param {Record<string, number>} durations
 * @param {{ index: number, total: number }} shard
 */
export function shardOf(specs, durations, shard) {
  return shards(specs, durations, shard.total)[shard.index - 1];
}
