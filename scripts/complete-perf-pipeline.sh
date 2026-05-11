#!/bin/bash
# 一键性能监测 - 完整流程
# 包括: 构建 -> 测试 -> 基准 -> 记录 -> 检测 -> 报告

set -e

REPO_ROOT="$(dirname "$(dirname "${BASH_SOURCE[0]}")")"
cd "$REPO_ROOT"

echo "🔧 Tauri Diff - Complete Performance Pipeline"
echo "==========================================="
echo ""

# 检查依赖
echo "📦 Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "❌ Rust/Cargo not found. Please install Rust first."
    exit 1
fi

# 安装依赖
echo "📥 Installing dependencies..."
npm ci --silent

# 运行测试
echo ""
echo "🧪 Running tests..."
npm run test -- run

# 运行基准测试
echo ""
echo "⏱️  Running performance benchmarks (stable mode)..."
npm run perf:bench:stable

# 记录结果
echo ""
echo "💾 Recording results..."
npm run perf:record

# 检查基线
echo ""
echo "📋 Checking baseline compliance..."
npm run perf:check

# 检测回归
echo ""
echo "🔍 Detecting regressions..."
npm run perf:detect

# 生成报告
echo ""
echo "📊 Generating report..."
npm run perf:chart

# 总结
echo ""
echo "✅ Pipeline Complete!"
echo ""
echo "📊 Performance Report:"
echo "   📈 HTML Chart: ./perf-report.html"
echo "   💾 History Data: ./scripts/perf-history.json"
echo ""
echo "📚 Next steps:"
echo "   1. Review the HTML report"
echo "   2. Commit perf-history.json to track trends"
echo "   3. Set up CI/CD with .github/workflows/performance-monitoring.yml"
echo ""
