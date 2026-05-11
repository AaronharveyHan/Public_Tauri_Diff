# diff-core

A next-generation diff tool — **Myers O(ND) Rust engine** + **React UI**, packaged as a **Tauri v2** desktop app.

Supports file diff, folder diff, syntax highlighting, one-way merge, bidirectional merge with conflict detection, and tree-sitter AST diff — all with linear-space performance on GB-scale files.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | ≥ 1.70  | `https://rustup.rs` |
| Node | ≥ 18    | `https://nodejs.org` |
| Tauri CLI | 2.x | `cargo install tauri-cli --locked` |
| Tauri system deps | — | see below |

**Linux** (Debian/Ubuntu):

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS**: Xcode Command Line Tools (`xcode-select --install`)

**Windows**: Microsoft C++ Build Tools + WebView2

---

## Setup

```bash
# 1) Install frontend deps
npm install

# 2) Generate icons (one-time, requires sharp)
npm install sharp
node generate-icons.mjs
# → writes src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns}
```

---

## Development

```bash
# Hot-reload dev mode (Vite + Tauri window)
cargo tauri dev
```

The UI also runs standalone in a browser (uses JS Myers fallback, no file picker):

```bash
npm run dev
# open http://localhost:5173
```

Engine badge in the header:
- 🟢 `rust engine` — running inside Tauri, IPC active
- 🔵 `js engine`   — browser mode, JS fallback engine

---

## Build

```bash
cargo tauri build
# output: src-tauri/target/release/bundle/
```

---

## Project Structure

```
tauri-diff/
├── index.html
├── package.json
├── vite.config.js
├── generate-icons.mjs              ← run once to create icons
├── src/
│   ├── main.jsx
│   ├── App.jsx                     ← UI: virtual list, char-level highlight, syntax highlight
│   ├── components/
│   │   ├── FolderDiff.jsx          ← v0.7: recursive folder diff tree
│   │   ├── MergePanel.jsx          ← v0.8: selective merge UI
│   │   ├── MergePanel.deep.jsx     ← v0.8: bidirectional merge
│   │   ├── ConflictResolver.jsx    ← v0.8: conflict detection & resolution
│   │   ├── BlockSelector.jsx       ← v0.8: block-level selection
│   │   └── MergePreview.jsx        ← v0.8: merge preview
│   ├── hooks/
│   │   └── useDiff.js              ← IPC abstraction (Tauri ↔ JS fallback, P2.3 cache)
│   └── lib/
│       └── diffCore.js             ← JS Myers O(ND) engine + normalize + compare
├── scripts/
│   ├── perf-baseline.json          ← performance threshold baselines
│   ├── check-perf-baseline.mjs     ← CI guard: validate against baseline
│   ├── record-perf.mjs             ← record benchmark results
│   ├── detect-regression.mjs       ← regression detection
│   └── generate-perf-chart.mjs     ← chart generation
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    └── src/
        ├── main.rs                 ← Tauri v2 commands (diff, merge, AST)
        ├── lib.rs                  ← library exports (for benchmarks)
        └── diff/
            ├── mod.rs              ← module re-exports
            ├── types.rs            ← DiffBlock, CompactDiffBlock, DiffTreeNode
            ├── myers_diff.rs       ← Myers O(ND) diff algorithm
            ├── lcs_diff.rs         ← chunked + parallel diff (≥100K lines)
            ├── folder_diff.rs      ← v0.7: recursive directory comparison
            ├── merge.rs            ← v0.8: merge data types
            ├── merge_algo.rs       ← v0.8: conflict detection, apply blocks
            ├── ast_diff.rs         ← v0.9: tree-sitter AST diff (7 languages)
            └── ast_diff_tests.rs   ← v0.9: AST-specific tests
```

---

## Architecture

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

`useDiff.js` detects `window.__TAURI__` at runtime:
- **In Tauri**: calls `invoke("diff_text")` → Rust Myers O(ND) engine
- **In browser**: falls back to bundled JS Myers O(ND) engine (identical algorithm)
- **P2.3 caching**: incremental diff via FNV-1a hash — cached hits return instantly

---

## Tauri Commands

### File & Text Diff

| Command | Input | Output | Since |
|---------|-------|--------|-------|
| `diff_text` | `textA`, `textB` | `Vec<DiffBlock>` | v0.1 |
| `diff_text_compact` | `textA`, `textB` | `Vec<CompactDiffBlock>` | v0.5.2 |
| `diff_files` | `pathA`, `pathB` | `Vec<DiffBlock>` | v0.1 |
| `diff_files_compact` | `pathA`, `pathB` | `Vec<CompactDiffBlock>` | v0.5.2 |
| `load_content_range` | `path`, `start_line`, `end_line` | `Vec<String>` | v0.5.2 |
| `read_file_text` | `path` | `String` | v0.1 |

### Folder Diff

| Command | Input | Output | Since |
|---------|-------|--------|-------|
| `diff_folders` | `pathA`, `pathB` | `DiffTreeNode` | v0.7 |

### Merge (v0.8)

| Command | Input | Output |
|---------|-------|--------|
| `detect_conflicts_text` | `textA`, `textB` | `Vec<ConflictInfo>` |
| `apply_blocks_text` | `source_text`, `target_text`, `selections` | `MergeResult` |
| `three_way_merge_detect_conflicts_text` | `base`, `textA`, `textB` | `Vec<ConflictInfo>` |
| `apply_blocks_bidirectional_text` | `source_text`, `target_text`, `selections`, `direction` | `MergeResult` |

### AST Diff (v0.9)

| Command | Input | Output |
|---------|-------|--------|
| `diff_ast_text` | `source_text`, `target_text`, `file_path` | `ASTDiffResult` |
| `diff_ast_files` | `source_path`, `target_path`, `file_path` | `ASTDiffResult` |

---

## Features

### Core Diff (v0.1)

- **Myers O(ND)** algorithm in both Rust and JS for consistent results
- Character-level highlighting of changes
- Color-coded display: 🟩 added / 🟥 removed / ⬜ unchanged

### Large File Support (v0.2 / P2.2)

- **Chunked processing** at ≥ 100K lines (50K-line chunks)
- **Parallel execution** via rayon when > 300K lines and multi-core
- **GB-scale files** via adaptive 500K-line chunking with constant ~100MB memory
- **Linear-space Myers** variant for files up to 10GB+

| File Size | Lines | Time (1 core) | Memory |
|-----------|-------|---------------|--------|
| 10 MB | 500K | 50–100 ms | ~5 MB |
| 100 MB | 5M | 500–1000 ms | ~10 MB |
| 1 GB | 50M | 5–10 s | ~100 MB |
| 10 GB | 500M | 50–100 s | ~100 MB |

### Incremental Diff Caching (v0.3 / P2.3)

- FNV-1a hash-based cache detects unchanged inputs
- Cache hits return instantly (< 1ms vs 1500ms first compute)
- Automatic cache population on every diff call

### Syntax Highlighting (v0.4 / P2.4)

- Auto-detects language from file extension
- 40+ languages via optimized `highlight.js` bundle (~220KB)
- GitHub Dark-inspired theme
- Only highlights visible rows (virtual list compatible)

### One-Way Merge (v0.5 / P3.1)

- **Apply A→B** button: merge all changes from File A into File B
- Visual feedback + automatic re-diff after merge
- < 10ms including cache clear + re-diff

### Diff Block Compression (v0.5.2 / P2.5)

- `CompactDiffBlock`: stores only line ranges (32 bytes/block) instead of full content
- **50–80% memory reduction** for large diffs
- Lazy content loading via `load_content_range` IPC
- Backward compatible: original `diff_files` / `diff_text` unchanged

### Folder Diff (v0.7)

- Recursive directory comparison with file status detection
- File statuses: Added, Removed, Modified, Identical
- Directory summary statistics
- Supports 100K+ files (Linux kernel tested)
- Memory < 200MB constant
- Smart ignore: `.git/`, `node_modules/`, `target/`, `dist/`, `__pycache__/`, etc.

| Project Size | Files | Time |
|-------------|-------|------|
| Small | 50 | < 100ms |
| Medium | 2K | 200–500ms |
| Large | 10K+ | 1–3s |
| Linux kernel | 70K+ | 5–10s |

### Bidirectional Merge & Conflict Detection (v0.8)

- **Selective merge**: pick individual diff blocks to apply
- **Bidirectional merge**: A→B or B→A direction control
- **Three-way merge**: detect conflicts from base + A + B
- **Conflict resolution**: identify overlapping changes with resolution strategies
- UI components: `MergePanel`, `ConflictResolver`, `BlockSelector`, `MergePreview`

### AST Diff (v0.9)

- **Tree-sitter** based semantic diff for 7 languages:
  JavaScript, TypeScript, Python, Rust, Java, C++, Go
- Detects changes at the **AST node level** (functions, classes, imports)
- **Fuzzy matching** via node similarity scoring (Levenshtein distance)
- Parameter count & return type change detection
- Severity classification: major / minor / trivial
- Parser caching for repeated calls
- Degrades gracefully to line diff for unsupported languages

---

## Performance

### Benchmark Baseline (Rust Criterion)

| Scenario | Time | Notes |
|----------|------|-------|
| `50K_lines_10pct_change` | ~740 ms | medium-size realistic change |
| `100K_lines_10pct_change` | ~750–830 ms | stable under 1s |
| `200K_lines_10pct_change` | ~1600 ms | parallel path on multi-core |
| `50K_pure_insert` | ~1.1 ms | prefix/suffix trim fast path |
| `50K_identical` | ~0.12 ms | exact-equal fast path |

### Running Benchmarks

```bash
npm run perf:bench:quick    # quick iteration (sample_size=10)
npm run perf:bench:stable   # regression baseline (sample_size=20, flat sampling)
npm run perf:check          # validate against scripts/perf-baseline.json
npm run perf:ci             # stable + check (CI gate)
npm run perf:monitor        # stable + record + detect + chart
```

CI guard: `.github/workflows/perf-baseline.yml` runs `npm run perf:ci` on every PR.

Details: [PERFORMANCE.md](PERFORMANCE.md) · [PERF_OPTIMIZATION_P2.1.md](PERF_OPTIMIZATION_P2.1.md)

---

## Algorithm Consistency

Both Rust and JavaScript use the **same Myers O(ND) algorithm**:

- **Rust**: `src-tauri/src/diff/myers_diff.rs` — path snapshots, backtracking
- **JavaScript**: `src/lib/diffCore.js` — identical O(ND) approach
- **Verification**: `maybeWarnEngineDrift()` logs mismatches in dev mode
- **Guarantee**: Tauri desktop and browser produce identical diff output

---

## Local Fonts

System fonts by default (fully offline):

- **Monospace**: Menlo / Monaco / Courier New
- **UI**: SF Pro / Segoe UI / Ubuntu

Optional: See [FONTS.md](FONTS.md) for web fonts (JetBrains Mono, DM Sans) or bundled custom fonts.

---

## Roadmap

- [x] v0.1 — Myers O(ND) algorithm unification (Rust + JS)
- [x] v0.2 — Large file support (100K+ lines, chunking + parallel)
- [x] v0.3 — Incremental diff caching (P2.3)
- [x] v0.4 — Syntax highlighting (P2.4, highlight.js)
- [x] v0.5 — One-way merge (P3.1, Apply A→B)
- [x] v0.5.1 — GB-scale support (P2.2, linear-space Myers)
- [x] v0.5.2 — Diff block compression (P2.5, compact format)
- [x] v0.7 — Folder diff (recursive directory comparison)
- [x] **v0.8 — Bidirectional merge & conflict detection**
- [ ] **v0.9 — tree-sitter AST diff (7 languages, fuzzy matching)**
- [ ] v1.0 — AI explain layer per DiffBlock

---

## License

MIT
