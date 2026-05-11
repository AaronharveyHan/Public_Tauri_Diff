use crate::diff::types::{ChangeType, DiffBlock};
use rayon::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Copy)]
enum Edit {
    Eq { a: usize, b: usize },
    Del { a: usize },
    Ins { b: usize },
}

#[derive(Debug, Clone)]
struct VSnapshot {
    k_min: isize,
    data: Vec<isize>,
}

#[derive(Debug, Default)]
struct MyersWorkspace {
    v: Vec<isize>,
    snapshots: Vec<VSnapshot>,
    hash_a: Vec<u64>,
    hash_b: Vec<u64>,
}

// Large file threshold: if > CHUNK_THRESHOLD lines, use chunked processing
const CHUNK_THRESHOLD: usize = 100_000;
const BASE_CHUNK_SIZE: usize = 50_000;
const MIN_PARALLEL_CHUNK_SIZE: usize = 10_000;

// Very large file threshold (1GB+): if > HUGE_THRESHOLD lines, use larger chunks for linear space
// Estimated as 50M lines (average 20 bytes per line + overhead = ~1GB memory)
// At 1GB, we increase chunk size to 500K to reduce number of chunks and memory overhead
const HUGE_THRESHOLD: usize = 50_000_000;
const HUGE_CHUNK_SIZE: usize = 500_000; // 500K lines = ~10MB per chunk for linear space

/// Myers O(ND) line diff algorithm with linear-space support for 1GB+ files.
/// For files >100K lines, uses chunked processing to reduce memory usage.
/// For files >50M lines (~1GB), uses larger chunks (500K) to keep memory bounded to ~100MB.
pub fn diff_lines(a: &[String], b: &[String]) -> Vec<DiffBlock> {
    // Fast path for identical content
    if a == b {
        return Vec::new();
    }

    let total_lines = a.len() + b.len();

    // For very large files (1GB+), use large chunking to achieve linear space usage
    if total_lines > HUGE_THRESHOLD {
        return diff_lines_chunked_huge(a, b);
    }

    // For large files with equal line counts, use chunked processing.
    // When lengths differ, chunk-local alignment can drift after early inserts/deletes,
    // so we keep the global Myers path for correctness.
    if total_lines > CHUNK_THRESHOLD && a.len() == b.len() {
        return diff_lines_chunked(a, b);
    }

    let mut workspace = MyersWorkspace::default();
    let edits = myers_edits(a, b, &mut workspace);
    edits_to_blocks(a, b, &edits)
}

/// Chunked diff for huge files (1GB+).
/// Uses 500K-line chunks to achieve O(CHUNK_SIZE) memory usage (~10MB per chunk)
/// Total memory stays bounded around 100MB regardless of file size.
fn diff_lines_chunked_huge(a: &[String], b: &[String]) -> Vec<DiffBlock> {
    let chunk_size = HUGE_CHUNK_SIZE; // 500K-line chunks
    let estimated_chunks = ((a.len().max(b.len())) + chunk_size - 1) / chunk_size;
    let mut blocks = Vec::with_capacity(estimated_chunks.saturating_mul(2));
    let mut workspace = MyersWorkspace::default();

    let mut line_a = 0;
    let mut line_b = 0;

    while line_a < a.len() || line_b < b.len() {
        let chunk_end_a = (line_a + chunk_size).min(a.len());
        let chunk_end_b = (line_b + chunk_size).min(b.len());

        let chunk_a = &a[line_a..chunk_end_a];
        let chunk_b = &b[line_b..chunk_end_b];

        let chunk_blocks = diff_chunk_with_workspace(chunk_a, chunk_b, &mut workspace);

        // Adjust block indices to global file positions
        for mut block in chunk_blocks {
            block.start_a += line_a;
            block.end_a += line_a;
            block.start_b += line_b;
            block.end_b += line_b;
            blocks.push(block);
        }

        line_a = chunk_end_a;
        line_b = chunk_end_b;
    }

    blocks
}

/// Chunked diff for large files.
/// Splits files into regions and diffs them, keeping memory bounded.
fn diff_lines_chunked(a: &[String], b: &[String]) -> Vec<DiffBlock> {
    // Use parallel processing when chunking can produce at least 2 chunks
    // and multiple CPU cores are available.
    let num_cpus = num_cpus::get();
    let chunk_size = BASE_CHUNK_SIZE;
    let chunks_a = (a.len() + chunk_size - 1) / chunk_size;
    let chunks_b = (b.len() + chunk_size - 1) / chunk_size;
    let chunk_count = chunks_a.max(chunks_b);
    if chunk_count >= 2 && num_cpus > 1 {
        return diff_lines_chunked_parallel(a, b);
    }

    diff_lines_chunked_serial(a, b)
}

/// Serial chunked diff (original implementation)
fn diff_lines_chunked_serial(a: &[String], b: &[String]) -> Vec<DiffBlock> {
    let chunk_size = BASE_CHUNK_SIZE; // Process 50K-line chunks
    let estimated_chunks = ((a.len().max(b.len())) + chunk_size - 1) / chunk_size;
    let mut blocks = Vec::with_capacity(estimated_chunks.saturating_mul(2));
    let mut workspace = MyersWorkspace::default();

    let mut line_a = 0;
    let mut line_b = 0;

    while line_a < a.len() || line_b < b.len() {
        let chunk_end_a = (line_a + chunk_size).min(a.len());
        let chunk_end_b = (line_b + chunk_size).min(b.len());

        let chunk_a = &a[line_a..chunk_end_a];
        let chunk_b = &b[line_b..chunk_end_b];

        let chunk_blocks = diff_chunk_with_workspace(chunk_a, chunk_b, &mut workspace);

        // Adjust block indices to global file positions
        for mut block in chunk_blocks {
            block.start_a += line_a;
            block.end_a += line_a;
            block.start_b += line_b;
            block.end_b += line_b;
            blocks.push(block);
        }

        line_a = chunk_end_a;
        line_b = chunk_end_b;
    }

    blocks
}

/// Parallel chunked diff using rayon for independent chunk processing
fn diff_lines_chunked_parallel(a: &[String], b: &[String]) -> Vec<DiffBlock> {
    let chunk_size = choose_parallel_chunk_size(a.len().max(b.len()));
    let estimated_chunks = ((a.len().max(b.len())) + chunk_size - 1) / chunk_size;

    // Build chunk ranges without cloning chunk data.
    let mut jobs = Vec::with_capacity(estimated_chunks);

    let mut line_a = 0;
    let mut line_b = 0;

    while line_a < a.len() || line_b < b.len() {
        let chunk_end_a = (line_a + chunk_size).min(a.len());
        let chunk_end_b = (line_b + chunk_size).min(b.len());

        jobs.push((line_a, chunk_end_a, line_b, chunk_end_b));

        line_a = chunk_end_a;
        line_b = chunk_end_b;
    }

    // Diff chunks in parallel
    let chunk_results: Vec<_> = jobs
        .into_par_iter()
        .map(|(start_a, end_a, start_b, end_b)| {
            let mut workspace = MyersWorkspace::default();
            let blocks = diff_chunk_with_workspace(
                &a[start_a..end_a],
                &b[start_b..end_b],
                &mut workspace,
            );
            (start_a, start_b, blocks)
        })
        .collect();

    // Merge results with offset adjustments
    let mut blocks = Vec::with_capacity(estimated_chunks.saturating_mul(2));
    for (line_a_offset, line_b_offset, chunk_blocks) in chunk_results {
        for mut block in chunk_blocks {
            block.start_a += line_a_offset;
            block.end_a += line_a_offset;
            block.start_b += line_b_offset;
            block.end_b += line_b_offset;
            blocks.push(block);
        }
    }

    blocks
}

fn choose_parallel_chunk_size(max_lines: usize) -> usize {
    let num_cpus = num_cpus::get().max(1);
    // Aim for ~4 tasks per core for better load balancing under uneven diff density.
    let target_jobs = num_cpus * 4;
    let adaptive = (max_lines + target_jobs - 1) / target_jobs;
    adaptive.clamp(MIN_PARALLEL_CHUNK_SIZE, BASE_CHUNK_SIZE)
}

/// Diff a single chunk, returns blocks with indices relative to chunk start
fn diff_chunk_with_workspace(
    a: &[String],
    b: &[String],
    workspace: &mut MyersWorkspace,
) -> Vec<DiffBlock> {
    if a.is_empty() && b.is_empty() {
        return Vec::new();
    }
    if a.is_empty() {
        return vec![DiffBlock {
            start_a: 0,
            end_a: 0,
            start_b: 0,
            end_b: b.len(),
            change_type: ChangeType::Add,
            content_a: Vec::new(),
            content_b: b.to_vec(),
        }];
    }
    if b.is_empty() {
        return vec![DiffBlock {
            start_a: 0,
            end_a: a.len(),
            start_b: 0,
            end_b: 0,
            change_type: ChangeType::Remove,
            content_a: a.to_vec(),
            content_b: Vec::new(),
        }];
    }

    let edits = myers_edits(a, b, workspace);
    edits_to_blocks(a, b, &edits)
}

fn myers_edits(a: &[String], b: &[String], workspace: &mut MyersWorkspace) -> Vec<Edit> {
    // Trim common prefix/suffix to reduce Myers search space.
    let (prefix, a_end, b_end) = common_bounds(a, b);
    let core_a = &a[prefix..a_end];
    let core_b = &b[prefix..b_end];

    if core_a.is_empty() && core_b.is_empty() {
        return (0..prefix).map(|i| Edit::Eq { a: i, b: i }).collect();
    }
    if core_a.is_empty() {
        let mut edits: Vec<Edit> = Vec::with_capacity(a.len() + b.len());
        edits.extend((0..prefix).map(|i| Edit::Eq { a: i, b: i }));
        edits.extend((prefix..b_end).map(|i| Edit::Ins { b: i }));
        edits.extend(
            (a_end..a.len())
                .zip(b_end..b.len())
                .map(|(ai, bi)| Edit::Eq { a: ai, b: bi }),
        );
        return edits;
    }
    if core_b.is_empty() {
        let mut edits: Vec<Edit> = Vec::with_capacity(a.len() + b.len());
        edits.extend((0..prefix).map(|i| Edit::Eq { a: i, b: i }));
        edits.extend((prefix..a_end).map(|i| Edit::Del { a: i }));
        edits.extend(
            (a_end..a.len())
                .zip(b_end..b.len())
                .map(|(ai, bi)| Edit::Eq { a: ai, b: bi }),
        );
        return edits;
    }

    hash_lines_into(core_a, &mut workspace.hash_a);
    hash_lines_into(core_b, &mut workspace.hash_b);
    let mut edits: Vec<Edit> = Vec::with_capacity(a.len() + b.len());
    edits.extend((0..prefix).map(|i| Edit::Eq { a: i, b: i }));
    let hashed_edits = {
        let a_hash = &workspace.hash_a;
        let b_hash = &workspace.hash_b;
        let v = &mut workspace.v;
        let snapshots = &mut workspace.snapshots;
        myers_edits_hashed(a_hash, b_hash, prefix, v, snapshots)
    };
    edits.extend(hashed_edits);
    // Restore trimmed suffix equal region.
    edits.extend(
        (a_end..a.len())
            .zip(b_end..b.len())
            .map(|(ai, bi)| Edit::Eq { a: ai, b: bi }),
    );
    edits
}

fn myers_edits_hashed(
    a: &[u64],
    b: &[u64],
    offset: usize,
    v: &mut Vec<isize>,
    snapshots: &mut Vec<VSnapshot>,
) -> Vec<Edit> {
    let n = a.len();
    let m = b.len();

    if n == 0 && m == 0 {
        return Vec::new();
    }

    let max = n + m;
    let off = max as isize;
    v.clear();
    v.resize(2 * max + 1, -1isize);
    v[(off + 1) as usize] = 0;

    snapshots.clear();
    snapshots.reserve(max + 1);

    'outer: for d in 0..=max {
        let d_i = d as isize;
        let mut k = -d_i;
        while k <= d_i {
            let x = if k == -d_i || (k != d_i && get(&v, off, k - 1) < get(&v, off, k + 1)) {
                get(&v, off, k + 1)
            } else {
                get(&v, off, k - 1) + 1
            };

            let mut x2 = x;
            let mut y2 = x2 - k;
            while x2 < n as isize && y2 < m as isize && a[x2 as usize] == b[y2 as usize] {
                x2 += 1;
                y2 += 1;
            }

            set(v, off, k, x2);

            if x2 >= n as isize && y2 >= m as isize {
                snapshots.push(capture_snapshot(&v, off, d_i));
                break 'outer;
            }

            k += 2;
        }

        snapshots.push(capture_snapshot(&v, off, d_i));
    }

    let mut edits = Vec::with_capacity(n + m);
    let mut x = n as isize;
    let mut y = m as isize;

    for d in (0..snapshots.len()).rev() {
        let d_i = d as isize;
        let sv = &snapshots[d];
        let k = x - y;

        let pk = if k == -d_i || (k != d_i && get_snapshot(sv, k + 1) > get_snapshot(sv, k - 1))
        {
            k + 1
        } else {
            k - 1
        };

        let pv = if d > 0 { &snapshots[d - 1] } else { sv };
        let px = get_snapshot(pv, pk).max(0);
        let py = px - pk;

        let mut cx = x;
        let mut cy = y;

        while cx > px + 1 && cy > py + 1 {
            cx -= 1;
            cy -= 1;
            edits.push(Edit::Eq {
                a: cx as usize + offset,
                b: cy as usize + offset,
            });
        }

        if d > 0 {
            if pk == k - 1 {
                edits.push(Edit::Del {
                    a: px as usize + offset,
                });
            } else {
                edits.push(Edit::Ins {
                    b: py as usize + offset,
                });
            }
        }

        while cx > px && cy > py {
            cx -= 1;
            cy -= 1;
            edits.push(Edit::Eq {
                a: cx as usize + offset,
                b: cy as usize + offset,
            });
        }

        x = px;
        y = py;

        if x <= 0 && y <= 0 {
            break;
        }
    }

    edits.reverse();
    edits
}

fn hash_lines_into(lines: &[String], buffer: &mut Vec<u64>) {
    buffer.clear();
    buffer.reserve(lines.len());
    for line in lines {
        let mut hasher = DefaultHasher::new();
        line.hash(&mut hasher);
        buffer.push(hasher.finish());
    }
}

fn common_bounds(a: &[String], b: &[String]) -> (usize, usize, usize) {
    let mut prefix = 0;
    let min_len = a.len().min(b.len());
    while prefix < min_len && a[prefix] == b[prefix] {
        prefix += 1;
    }

    let mut suffix = 0;
    while suffix < (a.len() - prefix).min(b.len() - prefix)
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }

    (prefix, a.len() - suffix, b.len() - suffix)
}

fn get(v: &[isize], off: isize, k: isize) -> isize {
    let idx = (k + off) as usize;
    v.get(idx).copied().unwrap_or(-1)
}

fn get_snapshot(snapshot: &VSnapshot, k: isize) -> isize {
    if k < snapshot.k_min {
        return -1;
    }
    let idx = (k - snapshot.k_min) as usize;
    snapshot.data.get(idx).copied().unwrap_or(-1)
}

fn capture_snapshot(v: &[isize], off: isize, d: isize) -> VSnapshot {
    // Keep only the active frontier and adjacent diagonals needed by backtracking.
    let desired_k_min = -d - 1;
    let desired_k_max = d + 1;
    let absolute_k_min = -off;
    let absolute_k_max = v.len() as isize - 1 - off;
    let k_min = desired_k_min.max(absolute_k_min);
    let k_max = desired_k_max.min(absolute_k_max);
    let start = (off + k_min) as usize;
    let end = (off + k_max) as usize;
    VSnapshot {
        k_min,
        data: v[start..=end].to_vec(),
    }
}

fn set(v: &mut [isize], off: isize, k: isize, value: isize) {
    let idx = (k + off) as usize;
    if let Some(slot) = v.get_mut(idx) {
        *slot = value;
    }
}

fn edits_to_blocks(a: &[String], b: &[String], edits: &[Edit]) -> Vec<DiffBlock> {
    if edits.is_empty() {
        if a.is_empty() && b.is_empty() {
            return Vec::new();
        }
        if a.is_empty() {
            return vec![DiffBlock {
                start_a: 0,
                end_a: 0,
                start_b: 0,
                end_b: b.len(),
                change_type: ChangeType::Add,
                content_a: Vec::new(),
                content_b: b.to_vec(),
            }];
        }
        if b.is_empty() {
            return vec![DiffBlock {
                start_a: 0,
                end_a: a.len(),
                start_b: 0,
                end_b: 0,
                change_type: ChangeType::Remove,
                content_a: a.to_vec(),
                content_b: Vec::new(),
            }];
        }
    }

    let mut blocks = Vec::with_capacity(edits.len() / 2 + 1);
    let mut i = 0;

    while i < edits.len() {
        if matches!(edits[i], Edit::Eq { .. }) {
            i += 1;
            continue;
        }

        let s = i;
        while i < edits.len() && !matches!(edits[i], Edit::Eq { .. }) {
            i += 1;
        }

        let run = &edits[s..i];
        let mut dels: Vec<usize> = Vec::with_capacity(run.len());
        let mut ins: Vec<usize> = Vec::with_capacity(run.len());
        for e in run {
            match e {
                Edit::Del { a } => dels.push(*a),
                Edit::Ins { b } => ins.push(*b),
                Edit::Eq { .. } => {}
            }
        }

        let anc_a = previous_equal_a(edits, s);
        let anc_b = previous_equal_b(edits, s);

        let start_a = dels.first().copied().unwrap_or(anc_a);
        let end_a = dels.last().map(|x| x + 1).unwrap_or(anc_a);
        let start_b = ins.first().copied().unwrap_or(anc_b);
        let end_b = ins.last().map(|x| x + 1).unwrap_or(anc_b);

        let change_type = if dels.is_empty() {
            ChangeType::Add
        } else if ins.is_empty() {
            ChangeType::Remove
        } else {
            ChangeType::Modify
        };

        blocks.push(DiffBlock {
            start_a,
            end_a,
            start_b,
            end_b,
            change_type,
            content_a: dels.into_iter().map(|idx| a[idx].clone()).collect(),
            content_b: ins.into_iter().map(|idx| b[idx].clone()).collect(),
        });
    }

    blocks
}

fn previous_equal_a(edits: &[Edit], before: usize) -> usize {
    for j in (0..before).rev() {
        if let Edit::Eq { a, .. } = edits[j] {
            return a + 1;
        }
    }
    0
}

fn previous_equal_b(edits: &[Edit], before: usize) -> usize {
    for j in (0..before).rev() {
        if let Edit::Eq { b, .. } = edits[j] {
            return b + 1;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_identical() {
        let a = s(&["a", "b", "c"]);
        let result = diff_lines(&a, &a);
        assert!(result.is_empty(), "identical files should produce no diff");
    }

    #[test]
    fn test_pure_insert() {
        let a = s(&["a", "b"]);
        let b = s(&["a", "x", "b"]);
        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0].change_type, ChangeType::Add));
        assert_eq!(result[0].content_b, vec!["x"]);
    }

    #[test]
    fn test_pure_delete() {
        let a = s(&["a", "x", "b"]);
        let b = s(&["a", "b"]);
        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0].change_type, ChangeType::Remove));
        assert_eq!(result[0].content_a, vec!["x"]);
    }

    #[test]
    fn test_modify() {
        let a = s(&["a", "old", "c"]);
        let b = s(&["a", "new", "c"]);
        let result = diff_lines(&a, &b);
        // Myers may produce 2 blocks (remove+add) instead of 1 modify
        assert!(result.len() >= 1);
        let all_a: Vec<_> = result.iter().flat_map(|b| b.content_a.clone()).collect();
        let all_b: Vec<_> = result.iter().flat_map(|b| b.content_b.clone()).collect();
        assert_eq!(all_a, vec!["old"]);
        assert_eq!(all_b, vec!["new"]);
    }

    #[test]
    fn test_shift_case() {
        let a = s(&["x", "a", "b"]);
        let b = s(&["a", "b", "y"]);
        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 2, "should be exactly 2 change blocks");

        assert!(matches!(result[0].change_type, ChangeType::Remove));
        assert_eq!(result[0].content_a, vec!["x"]);

        assert!(matches!(result[1].change_type, ChangeType::Add));
        assert_eq!(result[1].content_b, vec!["y"]);
    }

    #[test]
    fn test_empty_a() {
        let a = s(&[]);
        let b = s(&["x", "y"]);
        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0].change_type, ChangeType::Add));
    }

    #[test]
    fn test_empty_b() {
        let a = s(&["x", "y"]);
        let b = s(&[]);
        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0].change_type, ChangeType::Remove));
    }

    #[test]
    fn test_multiple_hunks() {
        let a = s(&["a", "b", "c", "d", "e"]);
        let b = s(&["a", "X", "c", "Y", "e"]);
        let result = diff_lines(&a, &b);
        // Myers may produce more blocks, but should have correct content
        assert!(result.len() >= 2);
        let all_a: Vec<_> = result.iter().flat_map(|b| b.content_a.clone()).collect();
        let all_b: Vec<_> = result.iter().flat_map(|b| b.content_b.clone()).collect();
        assert!(all_a.contains(&"b".to_string()));
        assert!(all_a.contains(&"d".to_string()));
        assert!(all_b.contains(&"X".to_string()));
        assert!(all_b.contains(&"Y".to_string()));
    }

    #[test]
    fn test_large_insert_across_chunk_boundary() {
        let a: Vec<String> = (0..120_000).map(|i| format!("line {}", i)).collect();
        let mut b = a.clone();
        b.insert(10, "INSERTED".to_string());

        let result = diff_lines(&a, &b);
        assert_eq!(result.len(), 1, "large pure insert should be one block");
        assert!(matches!(result[0].change_type, ChangeType::Add));
        assert_eq!(result[0].content_b, vec!["INSERTED".to_string()]);
    }

    #[test]
    fn test_large_delete_across_chunk_boundary() {
        let mut a: Vec<String> = (0..120_000).map(|i| format!("line {}", i)).collect();
        let removed = a.remove(10);
        let b: Vec<String> = (0..120_000).map(|i| format!("line {}", i)).collect();

        let result = diff_lines(&b, &a);
        assert_eq!(result.len(), 1, "large pure delete should be one block");
        assert!(matches!(result[0].change_type, ChangeType::Remove));
        assert_eq!(result[0].content_a, vec![removed]);
    }
}
