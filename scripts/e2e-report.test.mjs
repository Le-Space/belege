// node --test scripts/e2e-report.test.mjs – runs in e2e.yml's `changes` job.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { durationsOf, readReports, summary, testsOf } from "./e2e-report.mjs";

// The shape of Playwright's JSON reporter, cut down to what is read.
const one = (title, status, ...ms) => ({
  title,
  tests: [{ status, results: ms.map((duration) => ({ duration })) }],
});
const report = {
  suites: [
    {
      title: "alpha.spec.js",
      file: "alpha.spec.js",
      specs: [
        one("first", "expected", 4000),
        one("wobbly", "flaky", 90000, 6200),
      ],
      suites: [{ title: "a group", specs: [one("inside", "expected", 1500)] }],
    },
    {
      title: "beta.spec.js",
      file: "beta.spec.js",
      specs: [
        one("left out", "skipped", 0),
        one("broken", "unexpected", 3000, 3000),
      ],
    },
  ],
};

test("the tests of a report: file, outcome, the try that counted and what was lost", () => {
  assert.deepEqual(testsOf(report), [
    { spec: "alpha", title: "first", outcome: "passed", seconds: 4, wasted: 0 },
    {
      spec: "alpha",
      title: "wobbly",
      outcome: "flaky",
      seconds: 6.2,
      wasted: 90,
    },
    {
      spec: "alpha",
      title: "inside",
      outcome: "passed",
      seconds: 1.5,
      wasted: 0,
    },
    {
      spec: "beta",
      title: "left out",
      outcome: "skipped",
      seconds: 0,
      wasted: 0,
    },
    { spec: "beta", title: "broken", outcome: "failed", seconds: 3, wasted: 3 },
  ]);
  assert.deepEqual(testsOf({}), []);
});

test("seconds per spec: the tries that counted, without what a retry lost", () => {
  assert.deepEqual(durationsOf(testsOf(report)), { alpha: 12, beta: 3 });
});

test("the summary names a test that passed only on a second try", () => {
  const text = summary([{ name: "http-1", rows: testsOf(report) }]);
  assert.match(text, /### 1 passed only on a second try/);
  assert.match(text, /\| alpha \| wobbly \| http-1 \| 90 s \|/);
  assert.match(text, /\| http-1 \| 4 \| 1\.8 min \|/);
});

test("the summary of a run without one says so, and of no report too", () => {
  const sound = {
    suites: [
      { file: "alpha.spec.js", specs: [one("first", "expected", 1000)] },
    ],
  };
  assert.match(
    summary([{ name: "http-1", rows: testsOf(sound) }]),
    /passed on its first try/,
  );
  assert.match(summary([]), /No report was kept/);
});

test("a title cannot write Markdown into the summary", () => {
  const odd = {
    suites: [
      { file: "a.spec.js", specs: [one("x | [y](z) `w`", "flaky", 1, 1)] },
    ],
  };
  const line = summary([{ name: "s", rows: testsOf(odd) }])
    .split("\n")
    .find((l) => l.startsWith("| a |"));
  assert.equal(line, "| a | x y (z) w | s | 0 s |");
});

test("reports are read from the artifacts’ folders, a broken file left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
  try {
    for (const name of [
      "e2e-report-http-1",
      "e2e-report-stream-1",
      "e2e-report-http-2",
    ]) {
      mkdirSync(join(dir, name));
      writeFileSync(
        join(dir, name, "e2e-report.json"),
        name.endsWith("http-2") ? '{"suites": [' : JSON.stringify(report),
      );
    }
    assert.deepEqual(
      readReports(dir).map((r) => r.name),
      ["http-1", "stream-1"],
    );
    assert.deepEqual(readReports(join(dir, "nothing-here")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
