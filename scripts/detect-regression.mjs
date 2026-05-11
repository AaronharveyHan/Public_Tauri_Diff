#!/usr/bin/env node
/**
 * 性能回归检测
 * 将最新的性能结果与基线和历史数据进行比较
 * 用法: node detect-regression.mjs [--threshold=10]
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const historyPath = path.join(repoRoot, "scripts", "perf-history.json");
const baselinePath = path.join(repoRoot, "scripts", "perf-baseline.json");

// 解析命令行参数
let thresholdPercent = 10; // 默认 10% 回归检测阈值
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--threshold=")) {
    thresholdPercent = parseFloat(arg.replace("--threshold=", ""));
  }
}

if (!fs.existsSync(historyPath)) {
  console.error(`History file not found: ${historyPath}`);
  console.error("Run benchmarks and record results first: npm run perf:bench:stable && node scripts/record-perf.mjs");
  process.exit(1);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline file not found: ${baselinePath}`);
  process.exit(1);
}

const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

if (history.records.length < 2) {
  console.warn("⚠ History has fewer than 2 records. Run benchmarks multiple times for regression detection.");
  process.exit(0);
}

// 计算统计信息
function calculateStats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { mean, median, stddev, min: sorted[0], max: sorted[sorted.length - 1] };
}

// 检测每个基准的回归
const latestRecord = history.records[history.records.length - 1];
const previousRecord = history.records[history.records.length - 2];

const regressions = [];
const improvements = [];
const stable = [];

console.log("Performance Regression Detection");
console.log("================================\n");

for (const [benchmarkName, baselineRule] of Object.entries(baseline.benchmarks)) {
  const latestMs = latestRecord.results[benchmarkName]?.mean_ms;
  const previousMs = previousRecord.results[benchmarkName]?.mean_ms;
  
  if (!latestMs || !previousMs) {
    console.log(`⚠ ${benchmarkName}: missing data in history`);
    continue;
  }
  
  // 计算历史数据统计
  const historicalValues = history.records
    .map(r => r.results[benchmarkName]?.mean_ms)
    .filter(v => v !== undefined);
  const stats = calculateStats(historicalValues);
  
  // 变化百分比
  const changePercent = ((latestMs - previousMs) / previousMs) * 100;
  const changeVsBaseline = ((latestMs - baselineRule.max_ms) / baselineRule.max_ms) * 100;
  
  // 与平均值的标准差偏离
  const zScore = stats ? Math.abs((latestMs - stats.mean) / stats.stddev) : 0;
  
  // 判断回归
  const isRegression = changePercent > thresholdPercent || (stats && zScore > 2);
  const isImprovement = changePercent < -thresholdPercent;
  const exceedsBaseline = latestMs > baselineRule.max_ms;
  
  const status = isRegression ? "🔴 REGRESS" : isImprovement ? "🟢 IMPROVE" : "🟡 STABLE";
  const sign = changePercent > 0 ? "+" : "";
  
  console.log(`${status} ${benchmarkName}`);
  console.log(`   Current: ${latestMs.toFixed(2)}ms (vs baseline: ${changeVsBaseline > 0 ? "+" : ""}${changeVsBaseline.toFixed(1)}%)`);
  console.log(`   Previous: ${previousMs.toFixed(2)}ms (change: ${sign}${changePercent.toFixed(1)}%)`);
  
  if (stats) {
    console.log(`   Historical avg: ${stats.mean.toFixed(2)}ms ±${stats.stddev.toFixed(2)}ms (range: ${stats.min.toFixed(2)}-${stats.max.toFixed(2)}ms)`);
    console.log(`   z-score: ${zScore.toFixed(2)} (threshold: 2.0)`);
  }
  
  console.log();
  
  if (isRegression) {
    regressions.push({ name: benchmarkName, changePercent, latestMs, previousMs });
  } else if (isImprovement) {
    improvements.push({ name: benchmarkName, changePercent, latestMs, previousMs });
  } else {
    stable.push({ name: benchmarkName, changePercent });
  }
}

// 汇总
console.log("Summary");
console.log("=======");
console.log(`✓ Stable: ${stable.length}`);
console.log(`🟢 Improvements: ${improvements.length}`);
console.log(`🔴 Regressions: ${regressions.length}`);

if (regressions.length > 0) {
  console.log("\nDetailed Regressions:");
  for (const reg of regressions) {
    console.log(`  - ${reg.name}: ${reg.latestMs.toFixed(2)}ms (was ${reg.previousMs.toFixed(2)}ms, +${reg.changePercent.toFixed(1)}%)`);
  }
  
  console.error("\n❌ Performance regressions detected!");
  process.exit(1);
}

console.log("\n✅ No performance regressions detected.");
process.exit(0);
