// Tauri Diff v0.8: Merge algorithms
// Conflict detection, block-level application, three-way merge

use crate::diff::types::{DiffBlock, ChangeType};
use crate::diff::merge::*;
use std::collections::HashMap;

/// Detect conflicts when merging two versions against a base or each other
pub fn detect_conflicts(
    a: &[String],
    b: &[String],
    blocks: &[DiffBlock],
) -> Vec<ConflictInfo> {
    let mut conflicts = Vec::new();

    for (block_id, block) in blocks.iter().enumerate() {
        match block.change_type {
            ChangeType::Add => {
                // Check if both added at same location
                // This is a potential conflict if B also has additions at similar range
                if has_overlap_addition(blocks, block_id) {
                    conflicts.push(ConflictInfo {
                        block_id,
                        line_range_a: (0, 0),
                        line_range_b: (block.start_b, block.end_b),
                        content_a: String::new(),
                        content_b: get_line_range(b, block.start_b, block.end_b),
                        conflict_type: ConflictType::BothAdded,
                    });
                }
            }
            ChangeType::Remove => {
                // Check if A removed but B modified at same location
                if has_overlap_modification(blocks, block_id) {
                    conflicts.push(ConflictInfo {
                        block_id,
                        line_range_a: (block.start_a, block.end_a),
                        line_range_b: (0, 0),
                        content_a: get_line_range(a, block.start_a, block.end_a),
                        content_b: String::new(),
                        conflict_type: ConflictType::DeleteModify,
                    });
                }
            }
            ChangeType::Modify => {
                // Both sides modified the same region
                conflicts.push(ConflictInfo {
                    block_id,
                    line_range_a: (block.start_a, block.end_a),
                    line_range_b: (block.start_b, block.end_b),
                    content_a: get_line_range(a, block.start_a, block.end_a),
                    content_b: get_line_range(b, block.start_b, block.end_b),
                    conflict_type: ConflictType::BothModified,
                });
            }
        }
    }

    conflicts
}

/// Apply selected blocks from source to target text
pub fn apply_blocks(
    source: &[String],
    target: &[String],
    blocks: &[DiffBlock],
    selections: &[BlockSelection],
) -> MergeResult {
    let mut result_lines = target.to_vec();
    let mut applied = 0;
    let mut skipped = 0;
    let mut conflicts = 0;
    let mut conflict_list = Vec::new();

    // Build selection map for quick lookup
    let selection_map: HashMap<usize, &BlockSelection> = selections
        .iter()
        .map(|s| (s.block_id, s))
        .collect();

    // Sort blocks by reverse line number to avoid offset issues
    let mut indexed_blocks: Vec<_> = blocks.iter().enumerate().collect();
    indexed_blocks.sort_by(|a, b| {
        let a_end = a.1.end_a.max(a.1.end_b);
        let b_end = b.1.end_a.max(b.1.end_b);
        b_end.cmp(&a_end) // Reverse order
    });

    for (block_id, block) in indexed_blocks {
        let selection = selection_map.get(&block_id);

        match selection {
            Some(sel) if sel.action == BlockAction::Apply => {
                // Apply this block
                match apply_single_block(&mut result_lines, block, sel.resolution.as_ref()) {
                    Ok(_) => applied += 1,
                    Err(_) => conflicts += 1,
                }
            }
            Some(sel) if sel.action == BlockAction::Skip => {
                skipped += 1;
            }
            Some(sel) if sel.action == BlockAction::Conflict => {
                conflicts += 1;
                if let Ok(conflict) = extract_conflict_info(block_id, block, source, target) {
                    conflict_list.push(conflict);
                }
            }
            Some(_) => {
                // Default for any other selection state (shouldn't happen)
                skipped += 1;
            }
            None => {
                // No selection for this block, skip by default
                skipped += 1;
            }
        }
    }

    let success = conflict_list.is_empty();
    let summary = format!(
        "Applied {}/{} blocks (skipped: {}, conflicts: {})",
        applied,
        blocks.len(),
        skipped,
        conflicts
    );

    MergeResult {
        success,
        total_blocks: blocks.len(),
        applied_count: applied,
        skipped_count: skipped,
        conflict_count: conflicts,
        merged_text: result_lines.join("\n"),
        conflicts: conflict_list,
        summary,
    }
}

/// Apply a single block with optional conflict resolution
fn apply_single_block(
    target: &mut Vec<String>,
    block: &DiffBlock,
    resolution: Option<&ConflictResolution>,
) -> Result<(), String> {
    match block.change_type {
        ChangeType::Remove => {
            // Remove lines from target
            if block.end_a <= target.len() {
                for _ in 0..(block.end_a - block.start_a) {
                    if block.start_a < target.len() {
                        target.remove(block.start_a);
                    }
                }
                Ok(())
            } else {
                Err("Invalid range for removal".to_string())
            }
        }
        ChangeType::Add => {
            // Insert added lines at the position
            let insert_pos = block.start_b.min(target.len());
            for (i, line) in block.content_b.iter().enumerate() {
                target.insert(insert_pos + i, line.clone());
            }
            Ok(())
        }
        ChangeType::Modify => {
            // Handle conflict resolution
            match resolution {
                Some(ConflictResolution::KeepA) => {
                    // Keep original A version, no change
                    Ok(())
                }
                Some(ConflictResolution::KeepB) => {
                    // Replace with B version
                    if block.end_a <= target.len() {
                        for _ in block.start_a..block.end_a {
                            if block.start_a < target.len() {
                                target.remove(block.start_a);
                            }
                        }
                        for (i, line) in block.content_b.iter().enumerate() {
                            target.insert(block.start_a + i, line.clone());
                        }
                        Ok(())
                    } else {
                        Err("Invalid range for modification".to_string())
                    }
                }
                Some(ConflictResolution::Custom(content)) => {
                    // Replace with custom content
                    if block.end_a <= target.len() {
                        for _ in block.start_a..block.end_a {
                            if block.start_a < target.len() {
                                target.remove(block.start_a);
                            }
                        }
                        let custom_lines: Vec<String> = content.lines().map(String::from).collect();
                        for (i, line) in custom_lines.iter().enumerate() {
                            target.insert(block.start_a + i, line.clone());
                        }
                        Ok(())
                    } else {
                        Err("Invalid range for modification".to_string())
                    }
                }
                None => {
                    // No resolution specified, use B version
                    if block.end_a <= target.len() {
                        for _ in block.start_a..block.end_a {
                            if block.start_a < target.len() {
                                target.remove(block.start_a);
                            }
                        }
                        for (i, line) in block.content_b.iter().enumerate() {
                            target.insert(block.start_a + i, line.clone());
                        }
                        Ok(())
                    } else {
                        Err("Invalid range for modification".to_string())
                    }
                }
            }
        }
    }
}

// Helper functions

fn get_line_range(lines: &[String], start: usize, end: usize) -> String {
    if start >= lines.len() {
        return String::new();
    }
    let end = end.min(lines.len());
    lines[start..end].join("\n")
}

fn has_overlap_addition(blocks: &[DiffBlock], current_id: usize) -> bool {
    // Check if there are other additions nearby
    blocks.iter().enumerate().any(|(id, block)| {
        id != current_id && block.change_type == ChangeType::Add
    })
}

fn has_overlap_modification(blocks: &[DiffBlock], current_id: usize) -> bool {
    // Check if there are modifications at similar lines
    blocks.iter().enumerate().any(|(id, block)| {
        id != current_id && block.change_type == ChangeType::Modify
    })
}

fn extract_conflict_info(
    block_id: usize,
    block: &DiffBlock,
    a: &[String],
    b: &[String],
) -> Result<ConflictInfo, String> {
    if block.change_type == ChangeType::Modify {
        Ok(ConflictInfo {
            block_id,
            line_range_a: (block.start_a, block.end_a),
            line_range_b: (block.start_b, block.end_b),
            content_a: get_line_range(a, block.start_a, block.end_a),
            content_b: get_line_range(b, block.start_b, block.end_b),
            conflict_type: ConflictType::BothModified,
        })
    } else {
        Err("Not a conflict block".to_string())
    }
}

/// Three-way merge conflict detection
/// Compares base, A, and B versions to identify conflicts
/// Priority: if base==A && base!=B then B changed (accept B)
///          if base==B && base!=A then A changed (accept A)
///          if base!=A && base!=B then both changed (conflict)
pub fn three_way_merge_detect_conflicts(
    base: &[String],
    a: &[String],
    b: &[String],
    blocks: &[DiffBlock],
) -> Vec<ConflictInfo> {
    let mut conflicts = Vec::new();

    for (block_id, block) in blocks.iter().enumerate() {
        match block.change_type {
            ChangeType::Modify => {
                let base_content = get_line_range(base, block.start_a, block.end_a);
                let a_content = get_line_range(a, block.start_a, block.end_a);
                let b_content = get_line_range(b, block.start_b, block.end_b);

                let base_eq_a = base_content == a_content;
                let base_eq_b = base_content == b_content;

                // Both sides changed from base -> conflict
                if !base_eq_a && !base_eq_b && a_content != b_content {
                    conflicts.push(ConflictInfo {
                        block_id,
                        line_range_a: (block.start_a, block.end_a),
                        line_range_b: (block.start_b, block.end_b),
                        content_a: a_content,
                        content_b: b_content,
                        conflict_type: ConflictType::BothModified,
                    });
                }
                // Only B changed, A is same as base -> accept B
                // Only A changed, B is same as base -> accept A
                // These are non-conflicting cases
            }
            ChangeType::Add => {
                // Handle additions in three-way merge
                if has_overlap_addition(blocks, block_id) {
                    conflicts.push(ConflictInfo {
                        block_id,
                        line_range_a: (0, 0),
                        line_range_b: (block.start_b, block.end_b),
                        content_a: String::new(),
                        content_b: get_line_range(b, block.start_b, block.end_b),
                        conflict_type: ConflictType::BothAdded,
                    });
                }
            }
            ChangeType::Remove => {
                // Handle removals in three-way merge
                if has_overlap_modification(blocks, block_id) {
                    conflicts.push(ConflictInfo {
                        block_id,
                        line_range_a: (block.start_a, block.end_a),
                        line_range_b: (0, 0),
                        content_a: get_line_range(a, block.start_a, block.end_a),
                        content_b: String::new(),
                        conflict_type: ConflictType::DeleteModify,
                    });
                }
            }
        }
    }

    conflicts
}

/// Apply blocks with bidirectional support
/// Can apply from A→B or B→A depending on direction
pub fn apply_blocks_bidirectional(
    source: &[String],
    target: &[String],
    blocks: &[DiffBlock],
    selections: &[BlockSelection],
    direction: &str,
) -> MergeResult {
    match direction {
        "b_to_a" => {
            // Reverse: treat target as source and source as target
            let reversed_blocks = reverse_blocks(blocks);
            let mut result_lines = source.to_vec();
            apply_blocks_to_target(&mut result_lines, source, target, &reversed_blocks, selections)
        }
        _ => {
            // Default: a_to_b (normal direction)
            apply_blocks(source, target, blocks, selections)
        }
    }
}

/// Reverse diff blocks for bidirectional application
fn reverse_blocks(blocks: &[DiffBlock]) -> Vec<DiffBlock> {
    blocks.iter().map(|block| {
        DiffBlock {
            start_a: block.start_b,
            end_a: block.end_b,
            start_b: block.start_a,
            end_b: block.end_a,
            change_type: match block.change_type {
                ChangeType::Add => ChangeType::Remove,
                ChangeType::Remove => ChangeType::Add,
                ChangeType::Modify => ChangeType::Modify,
            },
            content_a: block.content_b.clone(),
            content_b: block.content_a.clone(),
        }
    }).collect()
}

/// Helper: apply blocks to a specific target (internal use for bidirectional)
fn apply_blocks_to_target(
    result: &mut Vec<String>,
    _source: &[String],
    _target: &[String],
    blocks: &[DiffBlock],
    selections: &[BlockSelection],
) -> MergeResult {
    let mut applied = 0;
    let mut skipped = 0;
    let mut conflicts = 0;
    let conflict_list = Vec::new();

    let selection_map: HashMap<usize, &BlockSelection> = selections
        .iter()
        .map(|s| (s.block_id, s))
        .collect();

    let mut indexed_blocks: Vec<_> = blocks.iter().enumerate().collect();
    indexed_blocks.sort_by(|a, b| {
        let a_end = a.1.end_a.max(a.1.end_b);
        let b_end = b.1.end_a.max(b.1.end_b);
        b_end.cmp(&a_end)
    });

    for (block_id, block) in indexed_blocks {
        if let Some(sel) = selection_map.get(&block_id) {
            if sel.action == BlockAction::Apply {
                match apply_single_block(result, block, sel.resolution.as_ref()) {
                    Ok(_) => applied += 1,
                    Err(_) => conflicts += 1,
                }
            } else if sel.action == BlockAction::Skip {
                skipped += 1;
            } else {
                conflicts += 1;
            }
        } else {
            skipped += 1;
        }
    }

    let success = conflict_list.is_empty();
    let summary = format!(
        "Applied {}/{} blocks (skipped: {}, conflicts: {})",
        applied,
        blocks.len(),
        skipped,
        conflicts
    );

    MergeResult {
        success,
        total_blocks: blocks.len(),
        applied_count: applied,
        skipped_count: skipped,
        conflict_count: conflicts,
        merged_text: result.join("\n"),
        conflicts: conflict_list,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_blocks_simple() {
        let source = vec!["new line 1".to_string(), "new line 2".to_string()];
        let target = vec!["old line 1".to_string(), "old line 2".to_string()];
        let blocks = vec![DiffBlock {
            start_a: 0,
            end_a: 2,
            start_b: 0,
            end_b: 2,
            change_type: ChangeType::Modify,
            content_a: target.clone(),
            content_b: source.clone(),
        }];

        let selections = vec![BlockSelection {
            block_id: 0,
            action: BlockAction::Apply,
            resolution: Some(ConflictResolution::KeepB),
        }];

        let result = apply_blocks(&source, &target, &blocks, &selections);
        assert_eq!(result.applied_count, 1);
        assert!(result.success);
    }

    #[test]
    fn test_detect_conflicts() {
        let a = vec!["line 1".to_string(), "line 2".to_string()];
        let b = vec!["line 1".to_string(), "modified line 2".to_string()];
        let blocks = vec![DiffBlock {
            start_a: 1,
            end_a: 2,
            start_b: 1,
            end_b: 2,
            change_type: ChangeType::Modify,
            content_a: vec!["line 2".to_string()],
            content_b: vec!["modified line 2".to_string()],
        }];

        let conflicts = detect_conflicts(&a, &b, &blocks);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, ConflictType::BothModified);
    }

    #[test]
    fn test_apply_blocks_skip() {
        let source = vec!["new".to_string()];
        let target = vec!["old".to_string()];
        let blocks = vec![DiffBlock {
            start_a: 0,
            end_a: 1,
            start_b: 0,
            end_b: 1,
            change_type: ChangeType::Modify,
            content_a: target.clone(),
            content_b: source.clone(),
        }];

        let selections = vec![BlockSelection {
            block_id: 0,
            action: BlockAction::Skip,
            resolution: None,
        }];

        let result = apply_blocks(&source, &target, &blocks, &selections);
        assert_eq!(result.skipped_count, 1);
    }

    #[test]
    fn test_three_way_merge_no_conflict() {
        // Base: "line 1\nline 2\nline 3"
        // A:    "line 1\nline 2 modified\nline 3"  (A modified line 2)
        // B:    "line 1\nline 2\nline 3"           (B same as base)
        // Expected: No conflict (only A changed)
        let base = vec!["line 1".to_string(), "line 2".to_string(), "line 3".to_string()];
        let a = vec!["line 1".to_string(), "line 2 modified".to_string(), "line 3".to_string()];
        let b = base.clone();
        
        let blocks = vec![DiffBlock {
            start_a: 1,
            end_a: 2,
            start_b: 1,
            end_b: 2,
            change_type: ChangeType::Modify,
            content_a: vec!["line 2".to_string()],
            content_b: vec!["line 2 modified".to_string()],
        }];

        let conflicts = three_way_merge_detect_conflicts(&base, &a, &b, &blocks);
        // Should have no conflicts because B didn't change from base
        assert_eq!(conflicts.len(), 0);
    }

    #[test]
    fn test_three_way_merge_with_conflict() {
        // Base: "line 1\nline 2\nline 3"
        // A:    "line 1\nline 2 modified by A\nline 3"
        // B:    "line 1\nline 2 modified by B\nline 3"
        // Expected: Conflict (both modified same line differently)
        let base = vec!["line 1".to_string(), "line 2".to_string(), "line 3".to_string()];
        let a = vec!["line 1".to_string(), "line 2 modified by A".to_string(), "line 3".to_string()];
        let b = vec!["line 1".to_string(), "line 2 modified by B".to_string(), "line 3".to_string()];
        
        let blocks = vec![DiffBlock {
            start_a: 1,
            end_a: 2,
            start_b: 1,
            end_b: 2,
            change_type: ChangeType::Modify,
            content_a: vec!["line 2".to_string()],
            content_b: vec!["line 2 modified by B".to_string()],
        }];

        let conflicts = three_way_merge_detect_conflicts(&base, &a, &b, &blocks);
        // Should have conflict because both A and B changed from base
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, ConflictType::BothModified);
    }

    #[test]
    fn test_bidirectional_merge_a_to_b() {
        let a = vec!["new".to_string()];
        let b = vec!["old".to_string()];
        let blocks = vec![DiffBlock {
            start_a: 0,
            end_a: 1,
            start_b: 0,
            end_b: 1,
            change_type: ChangeType::Modify,
            content_a: b.clone(),
            content_b: a.clone(),
        }];

        let selections = vec![BlockSelection {
            block_id: 0,
            action: BlockAction::Apply,
            resolution: Some(ConflictResolution::KeepB),
        }];

        // A to B (default)
        let result = apply_blocks_bidirectional(&a, &b, &blocks, &selections, "a_to_b");
        assert_eq!(result.applied_count, 1);
    }

    #[test]
    fn test_bidirectional_merge_b_to_a() {
        let a = vec!["old".to_string()];
        let b = vec!["new".to_string()];
        let blocks = vec![DiffBlock {
            start_a: 0,
            end_a: 1,
            start_b: 0,
            end_b: 1,
            change_type: ChangeType::Modify,
            content_a: a.clone(),
            content_b: b.clone(),
        }];

        let selections = vec![BlockSelection {
            block_id: 0,
            action: BlockAction::Apply,
            resolution: Some(ConflictResolution::KeepB),
        }];

        // B to A (reversed)
        let result = apply_blocks_bidirectional(&a, &b, &blocks, &selections, "b_to_a");
        assert_eq!(result.applied_count, 1);
    }
}

