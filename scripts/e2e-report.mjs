#!/usr/bin/env node
// What the browser specs' reports say, from Playwright's JSON reports (one per
// shard, kept by e2e.yml as the artifacts e2e-report-*):
//
//   node scripts/e2e-report.mjs <dir>              a summary in Markdown: the
//                                                  tests that passed only on a
//                                                  second try, each shard's
//                                                  time, the slowest specs
//   node scripts/e2e-report.mjs --durations <dir>  app/e2e/durations.json:
//                                                  seconds per spec file, from
//                                                  the reports of the HTTP
//                                                  shards (e2e-report-http-*)
//
// A retry hides a test that fails now and then: the run is green and nobody
// hears of it. The summary names it, on the run's page. To renew the times:
//
//   gh run download <run of e2e.yml on main> -p 'e2e-report-http-*' -D reports
//   node scripts/e2e-report.mjs --durations reports > app/e2e/durations.json
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} TestRow
 * @property {string} spec the spec file's name without `.spec.js`
 * @property {string} title
 * @property {'passed' | 'flaky' | 'failed' | 'skipped'} outcome
 * @property {number} seconds the time of the try that counted (the last)
 * @property {number} wasted the time of the tries before it
 */

/**
 * The tests of one JSON report.
 *
 * @param {any} report
 * @returns {TestRow[]}
 */
export function testsOf(report) {
  /** @type {TestRow[]} */
  const rows = [];
  const walk = (/** @type {any} */ suite, /** @type {string} */ file) => {
    const at = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const last = results[results.length - 1];
        const ms = (/** @type {any} */ r) =>
          Number.isFinite(r?.duration) ? r.duration : 0;
        rows.push({
          spec: basename(spec.file ?? at ?? "").replace(/\.spec\.js$/, ""),
          title: spec.title ?? "",
          outcome:
            t.status === "flaky"
              ? "flaky"
              : t.status === "skipped"
                ? "skipped"
                : t.status === "expected"
                  ? "passed"
                  : "failed",
          seconds: ms(last) / 1000,
          wasted: results.slice(0, -1).reduce((s, r) => s + ms(r), 0) / 1000,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, at);
  };
  for (const suite of report?.suites ?? []) walk(suite, suite.file ?? "");
  return rows;
}

/**
 * Seconds per spec file: the tries that counted, rounded up to whole seconds.
 *
 * @param {TestRow[]} rows
 * @returns {Record<string, number>} sorted by name
 */
export function durationsOf(rows) {
  /** @type {Record<string, number>} */
  const sums = {};
  for (const row of rows) {
    if (row.outcome === "skipped") continue;
    sums[row.spec] = (sums[row.spec] ?? 0) + row.seconds;
  }
  return Object.fromEntries(
    Object.keys(sums)
      .sort()
      .map((name) => [name, Math.max(1, Math.ceil(sums[name]))]),
  );
}

const minutes = (/** @type {number} */ s) => `${(s / 60).toFixed(1)} min`;
// A test's title is the repository's own text; still, nothing but plain text
// goes into the summary's Markdown.
const plain = (/** @type {string} */ s) =>
  s
    .replace(/[|`<>[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The summary, in Markdown.
 *
 * @param {{ name: string, rows: TestRow[] }[]} reports one per shard
 */
export function summary(reports) {
  const out = ["## Browser specs", ""];
  if (!reports.length) return [...out, "No report was kept.", ""].join("\n");

  const flaky = reports.flatMap((r) =>
    r.rows
      .filter((row) => row.outcome === "flaky")
      .map((row) => ({ ...row, shard: r.name })),
  );
  if (flaky.length) {
    out.push(
      `### ${flaky.length} passed only on a second try`,
      "",
      "The run is green, and these are not sound: each failed once in this run.",
      "",
      "| Spec | Test | Shard | Lost |",
      "| --- | --- | --- | --- |",
    );
    for (const row of flaky) {
      out.push(
        `| ${plain(row.spec)} | ${plain(row.title)} | ${plain(row.shard)} | ${Math.round(row.wasted)} s |`,
      );
    }
  } else {
    out.push("Every test that passed, passed on its first try.");
  }

  out.push(
    "",
    "### Time per shard",
    "",
    "| Shard | Tests | Time |",
    "| --- | --- | --- |",
  );
  for (const r of reports) {
    const ran = r.rows.filter((row) => row.outcome !== "skipped");
    const time = ran.reduce((s, row) => s + row.seconds + row.wasted, 0);
    out.push(`| ${plain(r.name)} | ${ran.length} | ${minutes(time)} |`);
  }

  const http = reports.filter((r) => r.name.includes("http"));
  const perSpec = Object.entries(
    durationsOf((http.length ? http : reports).flatMap((r) => r.rows)),
  );
  perSpec.sort((a, b) => b[1] - a[1]);
  out.push(
    "",
    "### The ten longest specs",
    "",
    "| Spec | Time |",
    "| --- | --- |",
  );
  for (const [name, s] of perSpec.slice(0, 10))
    out.push(`| ${plain(name)} | ${s} s |`);
  return [...out, ""].join("\n");
}

/**
 * Every JSON report under a directory, named by where it lies:
 * `<dir>/e2e-report-http-3/e2e-report.json` is "http-3".
 *
 * @param {string} dir
 * @returns {{ name: string, rows: TestRow[] }[]}
 */
export function readReports(dir) {
  /** @type {{ name: string, rows: TestRow[] }[]} */
  const found = [];
  const walk = (/** @type {string} */ at) => {
    for (const entry of readdirSync(at).sort()) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".json")) {
        const folder = basename(at);
        const name = (
          at === dir ? entry.replace(/\.json$/, "") : folder
        ).replace(/^e2e-report-/, "");
        try {
          found.push({
            name,
            rows: testsOf(JSON.parse(readFileSync(path, "utf8"))),
          });
        } catch {
          // A shard that was cancelled may leave half a file: the others still count.
        }
      }
    }
  };
  try {
    walk(dir);
  } catch {
    return [];
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const wantDurations = args[0] === "--durations";
  const dir = args[wantDurations ? 1 : 0];
  if (!dir) {
    console.error("usage: node scripts/e2e-report.mjs [--durations] <dir>");
    process.exit(2);
  }
  const reports = readReports(dir);
  if (wantDurations) {
    const http = reports.filter((r) => r.name.includes("http"));
    const rows = (http.length ? http : reports).flatMap((r) => r.rows);
    if (!rows.length) {
      console.error(`No report under ${dir}`);
      process.exit(1);
    }
    console.log(JSON.stringify(durationsOf(rows), null, "\t"));
  } else {
    console.log(summary(reports));
  }
}
