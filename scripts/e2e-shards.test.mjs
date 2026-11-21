// node --test scripts/e2e-shards.test.mjs – runs in e2e.yml's `changes` job.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parseShard, shardOf, shards } from "./e2e-shards.mjs";

const sum = (
  /** @type {string[]} */ names,
  /** @type {Record<string, number>} */ d,
) => names.reduce((s, n) => s + d[n], 0);

test("every spec is in exactly one shard", () => {
  const d = { a: 50, b: 40, c: 30, d: 20, e: 10, f: 5 };
  const out = shards(Object.keys(d), d, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.flat().sort(), Object.keys(d));
});

test("by time, not by count: one long spec stands against many short ones", () => {
  const d = { long: 300, s1: 60, s2: 60, s3: 60, s4: 60, s5: 60 };
  const out = shards(Object.keys(d), d, 2);
  assert.deepEqual(out, [["long"], ["s1", "s2", "s3", "s4", "s5"]]);
});

test("the same answer whatever order the specs come in", () => {
  const d = { a: 7, b: 7, c: 7, d: 3, e: 3 };
  assert.deepEqual(
    shards(["a", "b", "c", "d", "e"], d, 2),
    shards(["e", "c", "a", "d", "b"], d, 2),
  );
});

test("a spec without a time counts as a middling one and still runs", () => {
  const d = { a: 100, b: 10, c: 1 };
  const out = shards(["a", "b", "c", "new"], d, 2);
  assert.deepEqual(out, [["a"], ["b", "c", "new"]]);
});

test("no times at all: dealt out evenly by count", () => {
  const out = shards(["a", "b", "c", "d"], {}, 2);
  assert.deepEqual(out, [
    ["a", "c"],
    ["b", "d"],
  ]);
});

test("more shards than specs: the rest stay empty", () => {
  assert.deepEqual(shards(["a"], { a: 1 }, 3), [["a"], [], []]);
});

test('E2E_SHARD: "3/5", nothing, and what is refused', () => {
  assert.deepEqual(parseShard("3/5"), { index: 3, total: 5 });
  assert.equal(parseShard(undefined), null);
  assert.equal(parseShard(""), null);
  for (const bad of ["0/5", "6/5", "3", "a/b", "3/0"])
    assert.throws(() => parseShard(bad));
  assert.deepEqual(
    shardOf(["a", "b"], { a: 2, b: 1 }, { index: 2, total: 2 }),
    ["b"],
  );
});

test("the times in the repository: only specs that exist, and five even shards", () => {
  const dir = new URL("../app/e2e/", import.meta.url);
  const durations = JSON.parse(
    readFileSync(new URL("durations.json", dir), "utf8"),
  );
  const specs = readdirSync(dir)
    .filter((f) => f.endsWith(".spec.js"))
    .map((f) => f.slice(0, -".spec.js".length));
  for (const name of Object.keys(durations)) {
    assert.ok(
      specs.includes(name),
      `durations.json names ${name}, which is no spec`,
    );
    assert.ok(durations[name] > 0, `${name}: not a time`);
  }
  const timed = specs.filter((name) => name in durations);
  const sums = shards(timed, durations, 5).map((names) =>
    sum(names, durations),
  );
  const longest = Math.max(0, ...Object.values(durations));
  // Greedy by the longest first: no shard is more than one spec above another.
  assert.ok(Math.max(...sums) - Math.min(...sums) <= longest);
});
