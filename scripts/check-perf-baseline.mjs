#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const baselinePath = path.join(repoRoot, "scripts", "perf-baseline.json");

if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline file not found: ${baselinePath}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const criterionRoots = [
  path.join(repoRoot, "src-tauri", "target", "criterion"),
  path.join(repoRoot, "target", "criterion")
];

function toMs(ns) {
  return ns / 1_000_000;
}

function readEstimateNs(groupAndName) {
  const benchPath = groupAndName.split("/");
  for (const root of criterionRoots) {
    const estimatePath = path.join(root, ...benchPath, "new", "estimates.json");
    if (!fs.existsSync(estimatePath)) {
      continue;
    }

    const estimates = JSON.parse(fs.readFileSync(estimatePath, "utf8"));
    if (estimates.median?.point_estimate) {
      return estimates.median.point_estimate;
    }
    if (estimates.mean?.point_estimate) {
      return estimates.mean.point_estimate;
    }
    throw new Error(`No median/mean point_estimate in ${estimatePath}`);
  }

  throw new Error(
    `No estimates.json found for ${groupAndName}. Run benchmark first, e.g.:\n` +
      `DIFF_BENCH_PROFILE=stable cargo bench --bench diff_benchmark -- "50K_lines_10pct_change|100K_lines_10pct_change|200K_lines_10pct_change"`
  );
}

const failures = [];
const rows = [];

for (const [name, rule] of Object.entries(baseline.benchmarks)) {
  const ns = readEstimateNs(name);
  const actualMs = toMs(ns);
  const pass = actualMs <= rule.max_ms;
  rows.push({
    name,
    actualMs,
    limitMs: rule.max_ms,
    status: pass ? "PASS" : "FAIL"
  });
  if (!pass) {
    failures.push({ name, actualMs, limitMs: rule.max_ms });
  }
}

console.log("Performance Baseline Check");
console.log("==========================");
for (const row of rows) {
  console.log(
    `${row.status.padEnd(4)} ${row.name.padEnd(40)} actual=${row.actualMs
      .toFixed(2)
      .padStart(8)}ms  limit=${row.limitMs.toFixed(2).padStart(8)}ms`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} benchmark(s) exceeded baseline limits.`);
  process.exit(1);
}

console.log("\nAll benchmark baselines passed.");
