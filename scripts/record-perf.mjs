#!/usr/bin/env node
/**
 * 记录性能基准结果到历史文件
 * 用法: node record-perf.mjs [--commit=<hash>] [--branch=<name>]
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();
const historyPath = path.join(repoRoot, "scripts", "perf-history.json");
const criterionRoots = [
  path.join(repoRoot, "src-tauri", "target", "criterion"),
  path.join(repoRoot, "target", "criterion")
];

const benchmarks = [
  "diff_performance/50K_lines_10pct_change",
  "diff_performance/100K_lines_10pct_change",
  "diff_performance/200K_lines_10pct_change"
];

function toMs(ns) {
  return ns / 1_000_000;
}

function getGitInfo() {
  try {
    const commit = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    return { commit, branch };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

function readBenchmarkStats(benchmarkName) {
  for (const root of criterionRoots) {
    const benchPath = benchmarkName.split("/");
    const newDir = path.join(root, ...benchPath, "new");
    const estimatePath = path.join(newDir, "estimates.json");
    const samplePath = path.join(newDir, "sample.json");
    
    if (!fs.existsSync(estimatePath)) continue;
    
    try {
      const estimates = JSON.parse(fs.readFileSync(estimatePath, "utf8"));
      
      // 提取时间数据 (纳秒)
      const median_ns = estimates.median?.point_estimate ?? 0;
      const mean_ns = estimates.mean?.point_estimate ?? 0;
      const stddev_ns = estimates.std_dev?.point_estimate ?? 0;
      
      // 获取样本数
      let samples = 0;
      if (fs.existsSync(samplePath)) {
        try {
          const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
          samples = (sample.times ?? []).length;
        } catch (e) {
          samples = 10; // 默认
        }
      }
      
      // 转换纳秒 → 毫秒
      return {
        mean_ms: toMs(mean_ns),
        median_ms: toMs(median_ns),
        stddev_ms: toMs(stddev_ns),
        samples: samples
      };
    } catch (e) {
      console.debug(`Failed to parse ${estimatePath}: ${e.message}`);
      continue;
    }
  }
  
  throw new Error(
    `No estimates.json found for ${benchmarkName}. Tried paths in:\n` +
    criterionRoots.map(r => r + "/*/*/new").join('\n') +
    `\n\nMake sure to run benchmarks first:\n` +
    `npm run perf:bench:quick  or  npm run perf:bench:stable`
  );
}

// 解析命令行参数
const args = process.argv.slice(2);
let commit = getGitInfo().commit;
let branch = getGitInfo().branch;

for (const arg of args) {
  if (arg.startsWith("--commit=")) {
    commit = arg.replace("--commit=", "");
  } else if (arg.startsWith("--branch=")) {
    branch = arg.replace("--branch=", "");
  }
}

// 读取或创建历史文件
let history;
if (fs.existsSync(historyPath)) {
  history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
} else {
  history = {
    version: "1.0",
    description: "Performance history tracking for regression detection",
    records: []
  };
}

// 记录新的性能数据
const record = {
  timestamp: new Date().toISOString(),
  commit,
  branch,
  results: {}
};

console.log("Recording performance benchmarks...");
for (const benchmark of benchmarks) {
  try {
    const stats = readBenchmarkStats(benchmark);
    record.results[benchmark] = stats;
    console.log(
      `  ✓ ${benchmark}: mean=${stats.mean_ms.toFixed(2)}ms ±${stats.stddev_ms.toFixed(2)}ms (n=${stats.samples})`
    );
  } catch (err) {
    console.error(`  ✗ ${benchmark}: ${err.message}`);
  }
}

// 添加记录
history.records.push(record);

// 只保留最后 100 条记录
if (history.records.length > 100) {
  history.records = history.records.slice(-100);
}

// 写入历史文件
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
console.log(`\n✓ Performance recorded at ${historyPath}`);
console.log(`  Total records: ${history.records.length}`);
