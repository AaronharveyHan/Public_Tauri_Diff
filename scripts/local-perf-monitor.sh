#!/bin/bash
# 本地性能监测脚本
# 用于开发者快速进行性能监测和回归检测
# 用法: ./scripts/local-perf-monitor.sh [--quick] [--threshold=10]

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

PROFILE="stable"  # 默认使用稳定模式
THRESHOLD=10
QUICK_MODE=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            PROFILE="quick"
            shift
            ;;
        --threshold=*)
            THRESHOLD="${1#*=}"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "🚀 Starting Performance Monitoring (${PROFILE} profile)"
echo "=================================="

# 第 1 步：运行基准测试
echo ""
echo "📊 [1/4] Running benchmark tests..."
cd "$REPO_ROOT"

if [ "$PROFILE" = "quick" ]; then
    npm run perf:bench:quick
else
    npm run perf:bench:stable
fi

# 第 2 步：记录性能结果
echo ""
echo "💾 [2/4] Recording performance results..."
npm run perf:record

# 第 3 步：检测性能回归
echo ""
echo "🔍 [3/4] Detecting performance regressions (threshold: ${THRESHOLD}%)..."
npm run perf:detect -- --threshold=$THRESHOLD || REGRESSION_DETECTED=true

# 第 4 步：生成趋势图表
echo ""
echo "📈 [4/4] Generating performance trends..."
npm run perf:chart

# 输出总结
echo ""
echo "=================================="
echo "✅ Performance Monitoring Complete"
echo ""
echo "📍 Report Location:"
echo "   HTML Report: $REPO_ROOT/perf-report.html"
echo "   History Data: $REPO_ROOT/scripts/perf-history.json"
echo ""
echo "📊 To view the report, open:"
echo "   open $REPO_ROOT/perf-report.html"
echo ""

if [ "$REGRESSION_DETECTED" = true ]; then
    echo "⚠️  Performance regressions detected!"
    echo "   Review the report and history for details."
    exit 1
else
    echo "✨ No performance regressions detected!"
fi
