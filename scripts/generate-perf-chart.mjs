#!/usr/bin/env node
/**
 * 生成性能趋势图表 (HTML)
 * 用法: node generate-perf-chart.mjs [--output=./perf-report.html] [--limit=30]
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const historyPath = path.join(repoRoot, "scripts", "perf-history.json");

// 解析命令行参数
let outputPath = path.join(repoRoot, "perf-report.html");
let limit = 30; // 最多显示最后 30 条记录

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--output=")) {
    outputPath = arg.replace("--output=", "");
  } else if (arg.startsWith("--limit=")) {
    limit = parseInt(arg.replace("--limit=", ""));
  }
}

if (!fs.existsSync(historyPath)) {
  console.error(`History file not found: ${historyPath}`);
  process.exit(1);
}

const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));

if (history.records.length === 0) {
  console.error("No records in history file");
  process.exit(1);
}

// 获取要显示的记录
const recordsToShow = history.records.slice(-limit);

// 提取所有基准名称
const benchmarks = new Set();
recordsToShow.forEach(record => {
  Object.keys(record.results).forEach(bench => benchmarks.add(bench));
});
const benchmarkArray = Array.from(benchmarks).sort();

// 为每个基准准备数据
const chartData = {};
benchmarkArray.forEach(benchmark => {
  chartData[benchmark] = {
    labels: [],
    means: [],
    medians: [],
    stddevs: [],
    samples: []
  };
});

recordsToShow.forEach((record, index) => {
  const dateStr = new Date(record.timestamp).toLocaleString();
  const label = `${index + 1}. ${dateStr.substring(0, 16)}\n${record.commit || "?"}`;
  
  benchmarkArray.forEach(benchmark => {
    const result = record.results[benchmark];
    if (result) {
      chartData[benchmark].labels.push(label);
      chartData[benchmark].means.push(result.mean_ms);
      chartData[benchmark].medians.push(result.median_ms);
      chartData[benchmark].stddevs.push(result.stddev_ms);
      chartData[benchmark].samples.push(result.samples);
    }
  });
});

// 计算统计信息
function calculateStats(values) {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { mean, stddev };
}

// 生成 HTML 报告
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tauri Diff - Performance Trend Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .header {
            background: white;
            border-radius: 8px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header h1 {
            color: #333;
            font-size: 2em;
            margin-bottom: 10px;
        }
        .header .meta {
            color: #666;
            font-size: 0.9em;
        }
        .header .meta span {
            margin-right: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .stat-card h3 {
            color: #667eea;
            font-size: 0.9em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: #333;
        }
        .stat-subtext {
            color: #999;
            font-size: 0.85em;
            margin-top: 5px;
        }
        .chart-container {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .chart-container h2 {
            color: #333;
            font-size: 1.3em;
            margin-bottom: 20px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }
        canvas {
            max-height: 400px;
        }
        .legend {
            display: flex;
            gap: 20px;
            margin-top: 15px;
            flex-wrap: wrap;
            font-size: 0.9em;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }
        .table-container {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow-x: auto;
        }
        .table-container h2 {
            color: #333;
            font-size: 1.3em;
            margin-bottom: 15px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th {
            background: #f5f5f5;
            font-weight: 600;
            color: #333;
        }
        tr:hover {
            background: #f9f9f9;
        }
        .trend-up {
            color: #e74c3c;
            font-weight: bold;
        }
        .trend-down {
            color: #27ae60;
            font-weight: bold;
        }
        .trend-stable {
            color: #95a5a6;
        }
        .footer {
            text-align: center;
            color: white;
            font-size: 0.85em;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Performance Trend Report</h1>
            <div class="meta">
                <span>📅 Generated: ${new Date().toLocaleString()}</span>
                <span>📈 Records shown: ${recordsToShow.length} / ${history.records.length}</span>
                <span>🔧 Benchmarks: ${benchmarkArray.length}</span>
            </div>
        </div>

        <div class="stats-grid">
            ${benchmarkArray.map(benchmark => {
              const values = chartData[benchmark].means;
              const latest = values[values.length - 1];
              const previous = values.length > 1 ? values[values.length - 2] : latest;
              const change = ((latest - previous) / previous) * 100;
              const stats = calculateStats(values);
              
              return `
            <div class="stat-card">
                <h3>${benchmark.split('/')[1]}</h3>
                <div class="stat-value">${latest.toFixed(2)}ms</div>
                <div class="stat-subtext">
                    ${change > 0 ? '📈' : '📉'} ${Math.abs(change).toFixed(1)}% vs previous
                </div>
                <div class="stat-subtext">
                    Avg: ${stats.mean.toFixed(2)}ms ±${stats.stddev.toFixed(2)}ms
                </div>
            </div>
            `;
            }).join('')}
        </div>

        ${benchmarkArray.map((benchmark, idx) => {
          const data = chartData[benchmark];
          const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe'];
          const color = colors[idx % colors.length];
          
          return `
        <div class="chart-container">
            <h2>${benchmark}</h2>
            <canvas id="chart-${idx}"></canvas>
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background-color: ${color};"></div>
                    Mean ± StdDev
                </div>
            </div>
        </div>
        
        <script>
            const ctx = document.getElementById('chart-${idx}').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ${JSON.stringify(data.labels)},
                    datasets: [
                        {
                            label: 'Mean',
                            data: ${JSON.stringify(data.means)},
                            borderColor: '${color}',
                            backgroundColor: '${color}20',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBackgroundColor: '${color}',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2
                        },
                        {
                            label: 'Min (Mean - StdDev)',
                            data: ${JSON.stringify(data.means.map((m, i) => Math.max(0, m - data.stddevs[i])))},
                            borderColor: '${color}80',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            fill: false,
                            pointRadius: 0,
                            tension: 0.3
                        },
                        {
                            label: 'Max (Mean + StdDev)',
                            data: ${JSON.stringify(data.means.map((m, i) => m + data.stddevs[i]))},
                            borderColor: '${color}80',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            fill: '-1',
                            backgroundColor: '${color}10',
                            pointRadius: 0,
                            tension: 0.3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Time (ms)'
                            }
                        }
                    }
                }
            });
        </script>
            `;
        }).join('')}

        <div class="table-container">
            <h2>Latest Performance Data</h2>
            <table>
                <thead>
                    <tr>
                        <th>Benchmark</th>
                        <th>Mean (ms)</th>
                        <th>Median (ms)</th>
                        <th>StdDev (ms)</th>
                        <th>Samples</th>
                        <th>Trend vs Prev</th>
                    </tr>
                </thead>
                <tbody>
                    ${benchmarkArray.map(benchmark => {
                      const result = recordsToShow[recordsToShow.length - 1].results[benchmark];
                      const prevResult = recordsToShow.length > 1 
                        ? recordsToShow[recordsToShow.length - 2].results[benchmark] 
                        : null;
                      
                      if (!result) return '';
                      
                      const change = prevResult 
                        ? ((result.mean_ms - prevResult.mean_ms) / prevResult.mean_ms) * 100 
                        : 0;
                      
                      const trendClass = change > 2 ? 'trend-up' : change < -2 ? 'trend-down' : 'trend-stable';
                      const trendText = change > 0 ? '+' : '';
                      
                      return `
                    <tr>
                        <td>${benchmark}</td>
                        <td>${result.mean_ms.toFixed(2)}</td>
                        <td>${result.median_ms.toFixed(2)}</td>
                        <td>${result.stddev_ms.toFixed(2)}</td>
                        <td>${result.samples}</td>
                        <td class="${trendClass}">${trendText}${change.toFixed(2)}%</td>
                    </tr>
                      `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <p>Generated by Tauri Diff Performance Monitoring System</p>
            <p>For more information, see <a href="https://github.com/yourusername/tauri-diff" style="color: inherit;">Project Repository</a></p>
        </div>
    </div>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(`✓ Performance chart generated: ${outputPath}`);
console.log(`  Total benchmarks: ${benchmarkArray.length}`);
console.log(`  Records displayed: ${recordsToShow.length}`);
