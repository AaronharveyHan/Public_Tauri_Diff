# diff-core

一个"下一代"Diff 工具：**Myers O(ND) Rust 引擎** + **React UI**，通过 **Tauri v2** 打包为桌面应用。

支持文件对比、文件夹对比、语法高亮、单向合并、双向合并与冲突检测、以及 tree-sitter AST diff — 所有功能均支持 GB 级大文件的线性空间性能。

---

## 前置依赖

| 工具 | 版本 | 安装 |
|------|------|------|
| Rust | ≥ 1.70 | `https://rustup.rs` |
| Node | ≥ 18 | `https://nodejs.org` |
| Tauri CLI | 2.x | `cargo install tauri-cli --locked` |
| Tauri 系统依赖 | — | 见下文 |

**Linux**（Debian/Ubuntu）：

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS**：Xcode Command Line Tools（`xcode-select --install`）

**Windows**：Microsoft C++ Build Tools + WebView2

---

## 安装

```bash
# 1) 安装前端依赖
npm install

# 2) 生成图标（仅一次，需要 sharp）
npm install sharp
node generate-icons.mjs
# → 写入 src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns}
```

---

## 开发

```bash
# 热更新开发模式（Vite + Tauri 窗口）
cargo tauri dev
```

UI 也支持纯浏览器运行（使用 JS Myers 回退，不支持文件选择器）：

```bash
npm run dev
# 打开 http://localhost:5173
```

页面头部的引擎徽标含义：
- 🟢 `rust engine`：运行在 Tauri 内，IPC 可用
- 🔵 `js engine`：浏览器模式，使用 JS 回退引擎

---

## 构建

```bash
cargo tauri build
# 输出：src-tauri/target/release/bundle/
```

---

## 项目结构

```
tauri-diff/
├── index.html
├── package.json
├── vite.config.js
├── generate-icons.mjs              ← 运行一次生成图标
├── src/
│   ├── main.jsx
│   ├── App.jsx                     ← UI：虚拟列表、字符级高亮、语法高亮
│   ├── components/
│   │   ├── FolderDiff.jsx          ← v0.7：递归文件夹 diff 树
│   │   ├── MergePanel.jsx          ← v0.8：选择性合并 UI
│   │   ├── MergePanel.deep.jsx     ← v0.8：双向合并
│   │   ├── ConflictResolver.jsx    ← v0.8：冲突检测与解决
│   │   ├── BlockSelector.jsx       ← v0.8：块级选择
│   │   └── MergePreview.jsx        ← v0.8：合并预览
│   ├── hooks/
│   │   └── useDiff.js              ← IPC 抽象（Tauri ↔ JS 回退，P2.3 缓存）
│   └── lib/
│       └── diffCore.js             ← JS Myers O(ND) 引擎 + 标准化 + 比较
├── scripts/
│   ├── perf-baseline.json          ← 性能阈值基线
│   ├── check-perf-baseline.mjs     ← CI 守卫：验证基线
│   ├── record-perf.mjs             ← 记录基准结果
│   ├── detect-regression.mjs       ← 回归检测
│   └── generate-perf-chart.mjs     ← 图表生成
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    └── src/
        ├── main.rs                 ← Tauri v2 命令（diff、merge、AST）
        ├── lib.rs                  ← 库导出（用于基准测试）
        └── diff/
            ├── mod.rs              ← 模块重新导出
            ├── types.rs            ← DiffBlock, CompactDiffBlock, DiffTreeNode
            ├── myers_diff.rs       ← Myers O(ND) diff 算法
            ├── lcs_diff.rs         ← 分块 + 并行 diff（≥100K 行）
            ├── folder_diff.rs      ← v0.7：递归目录比较
            ├── merge.rs            ← v0.8：合并数据类型
            ├── merge_algo.rs       ← v0.8：冲突检测、应用块
            ├── ast_diff.rs         ← v0.9：tree-sitter AST diff（7 种语言）
            └── ast_diff_tests.rs   ← v0.9：AST 专用测试
```

---

## 架构

```
┌─────────────────────────────────────────────┐
│              Tauri v2 Shell                  │
│  ┌────────────────┐  ┌───────────────────┐  │
│  │   React UI     │  │    Rust Core      │  │
│  │   App.jsx      │  │  myers_diff.rs    │  │
│  │   useDiff.js   │◄─┤  lcs_diff.rs      │  │
│  │   MergePanel   │  │  folder_diff.rs   │  │
│  │   FolderDiff   │  │  merge_algo.rs    │  │
│  │                │  │  ast_diff.rs      │  │
│  └────────────────┘  └───────────────────┘  │
│      invoke()  ←→  #[tauri::command]         │
└─────────────────────────────────────────────┘
```

`useDiff.js` 会在运行时检测 `window.__TAURI__`：
- **在 Tauri 中**：调用 `invoke("diff_text")` → Rust Myers O(ND) 引擎
- **在浏览器中**：回退到打包的 JS Myers O(ND) 引擎（算法一致）
- **P2.3 缓存**：基于 FNV-1a 哈希的增量 diff — 缓存命中即时返回

---

## Tauri 命令

### 文件与文本 Diff

| 命令 | 输入 | 输出 | 版本 |
|------|------|------|------|
| `diff_text` | `textA`, `textB` | `Vec<DiffBlock>` | v0.1 |
| `diff_text_compact` | `textA`, `textB` | `Vec<CompactDiffBlock>` | v0.5.2 |
| `diff_files` | `pathA`, `pathB` | `Vec<DiffBlock>` | v0.1 |
| `diff_files_compact` | `pathA`, `pathB` | `Vec<CompactDiffBlock>` | v0.5.2 |
| `load_content_range` | `path`, `start_line`, `end_line` | `Vec<String>` | v0.5.2 |
| `read_file_text` | `path` | `String` | v0.1 |

### 文件夹 Diff

| 命令 | 输入 | 输出 | 版本 |
|------|------|------|------|
| `diff_folders` | `pathA`, `pathB` | `DiffTreeNode` | v0.7 |

### 合并（v0.8）

| 命令 | 输入 | 输出 |
|------|------|------|
| `detect_conflicts_text` | `textA`, `textB` | `Vec<ConflictInfo>` |
| `apply_blocks_text` | `source_text`, `target_text`, `selections` | `MergeResult` |
| `three_way_merge_detect_conflicts_text` | `base`, `textA`, `textB` | `Vec<ConflictInfo>` |
| `apply_blocks_bidirectional_text` | `source_text`, `target_text`, `selections`, `direction` | `MergeResult` |

### AST Diff（v0.9）

| 命令 | 输入 | 输出 |
|------|------|------|
| `diff_ast_text` | `source_text`, `target_text`, `file_path` | `ASTDiffResult` |
| `diff_ast_files` | `source_path`, `target_path`, `file_path` | `ASTDiffResult` |

---

## 功能特性

### 核心 Diff（v0.1）

- Rust 和 JS 均使用 **Myers O(ND)** 算法，结果一致
- 字符级变更高亮
- 颜色标记：🟩 新增 / 🟥 删除 / ⬜ 未变

### 大文件支持（v0.2 / P2.2）

- **分块处理**：≥ 100K 行自动分块（50K 行/块）
- **并行执行**：> 300K 行且多核时通过 rayon 并行处理
- **GB 级文件**：自适应 500K 行分块，内存恒定约 100MB
- **线性空间 Myers**：支持 10GB+ 文件

| 文件大小 | 行数 | 时间（单核） | 内存 |
|---------|------|-------------|------|
| 10 MB | 500K | 50–100 ms | ~5 MB |
| 100 MB | 5M | 500–1000 ms | ~10 MB |
| 1 GB | 50M | 5–10 s | ~100 MB |
| 10 GB | 500M | 50–100 s | ~100 MB |

### 增量 Diff 缓存（v0.3 / P2.3）

- 基于 FNV-1a 哈希的缓存检测未变更的输入
- 缓存命中即时返回（< 1ms vs 首次 1500ms）
- 每次 diff 自动填充缓存

### 语法高亮（v0.4 / P2.4）

- 根据文件扩展名自动检测语言
- 40+ 种语言，优化的 highlight.js 打包（~220KB）
- GitHub Dark 风格配色
- 仅高亮可见行（兼容虚拟列表）

### 单向合并（v0.5 / P3.1）

- **Apply A→B 按钮**：一键将文件 A 的所有变更合并到文件 B
- 视觉反馈 + 合并后自动重新 diff
- < 10ms（含缓存清除 + 重新 diff）

### Diff 块压缩（v0.5.2 / P2.5）

- `CompactDiffBlock`：仅存储行范围（32 字节/块）而非完整内容
- **内存节省 50–80%**（大文件）
- 通过 `load_content_range` IPC 按需加载内容
- 向后兼容：原有 `diff_files` / `diff_text` 命令不变

### 文件夹 Diff（v0.7）

- 递归目录比较，自动检测文件状态
- 文件状态：新增、删除、修改、相同
- 目录汇总统计
- 支持 100K+ 文件（已测试 Linux 内核）
- 内存恒定 < 200MB
- 智能忽略：`.git/`、`node_modules/`、`target/`、`dist/`、`__pycache__/` 等

| 项目规模 | 文件数 | 时间 |
|---------|--------|------|
| 小型 | 50 | < 100ms |
| 中型 | 2K | 200–500ms |
| 大型 | 10K+ | 1–3s |
| Linux 内核 | 70K+ | 5–10s |

### 双向合并与冲突检测（v0.8）

- **选择性合并**：选择单个 diff 块进行应用
- **双向合并**：支持 A→B 或 B→A 方向
- **三路合并**：基于 base + A + B 检测冲突
- **冲突解决**：识别重叠变更并提供解决策略
- UI 组件：`MergePanel`、`ConflictResolver`、`BlockSelector`、`MergePreview`

### AST Diff（v0.9）

- 基于 **Tree-sitter** 的语义 diff，支持 7 种语言：
  JavaScript、TypeScript、Python、Rust、Java、C++、Go
- 在 **AST 节点级别**检测变更（函数、类、导入等）
- 基于相似度评分的**模糊匹配**（Levenshtein 距离）
- 参数数量与返回类型变更检测
- 严重程度分类：major / minor / trivial
- 解析器缓存，重复调用无需重新初始化
- 不支持的语言自动降级为行级 diff

---

## 性能

### 基准测试基线（Rust Criterion）

| 场景 | 时间 | 说明 |
|------|------|------|
| `50K_lines_10pct_change` | ~740 ms | 中等大小真实变更 |
| `100K_lines_10pct_change` | ~750–830 ms | 稳定在 1s 以内 |
| `200K_lines_10pct_change` | ~1600 ms | 多核走并行路径 |
| `50K_pure_insert` | ~1.1 ms | 前缀/后缀裁剪快速路径 |
| `50K_identical` | ~0.12 ms | 完全相等快速路径 |

### 运行基准测试

```bash
npm run perf:bench:quick    # 快速迭代（sample_size=10）
npm run perf:bench:stable   # 回归基线（sample_size=20，平采样）
npm run perf:check          # 验证 scripts/perf-baseline.json 基线
npm run perf:ci             # stable + check（CI 门禁）
npm run perf:monitor        # stable + record + detect + chart
```

CI 守护：`.github/workflows/perf-baseline.yml` 在每个 PR 上运行 `npm run perf:ci`。

详情：[PERFORMANCE.md](PERFORMANCE.md) · [PERF_OPTIMIZATION_P2.1.md](PERF_OPTIMIZATION_P2.1.md)

---

## 算法一致性

Rust 和 JavaScript 两端使用**相同的 Myers O(ND) 算法**：

- **Rust**：`src-tauri/src/diff/myers_diff.rs` — 路径快照 + 回溯
- **JavaScript**：`src/lib/diffCore.js` — 相同的 O(ND) 实现
- **验证机制**：`maybeWarnEngineDrift()` 在开发模式下记录不一致
- **保证**：Tauri 桌面与浏览器环境输出完全一致

---

## 本地字体

默认使用系统字体（完全离线可用）：

- **等宽字体**：Menlo / Monaco / Courier New
- **UI 字体**：SF Pro / Segoe UI / Ubuntu

可选配置：见 [FONTS.md](FONTS.md) 了解 Web 字体（JetBrains Mono、DM Sans）或打包自定义字体。

---

## Roadmap

- [x] v0.1 — Myers O(ND) 算法统一（Rust + JS）
- [x] v0.2 — 大文件支持（100K+ 行，分块 + 并行）
- [x] v0.3 — 增量 diff 缓存（P2.3）
- [x] v0.4 — 语法高亮（P2.4，highlight.js）
- [x] v0.5 — 单向合并（P3.1，Apply A→B）
- [x] v0.5.1 — GB 级文件支持（P2.2，线性空间 Myers）
- [x] v0.5.2 — Diff 块压缩（P2.5，紧凑格式）
- [x] v0.7 — 文件夹 diff（递归目录比较）
- [x] **v0.8 — 双向合并与冲突检测**
- [ ] **v0.9 — tree-sitter AST diff（7 种语言，模糊匹配）**
- [ ] v1.0 — 每个 DiffBlock 的 AI 解释层

---

## 许可证

MIT
