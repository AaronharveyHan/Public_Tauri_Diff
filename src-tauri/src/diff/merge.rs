// Tauri Diff v0.8: Two-way selective merge support
// Conflict detection, block-level application, three-way merge

use serde::{Deserialize, Serialize};

/// Selection action for a diff block
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum BlockAction {
    /// Apply this block to the target
    #[serde(rename = "apply")]
    Apply,
    /// Skip this block
    #[serde(rename = "skip")]
    Skip,
    /// This block conflicts, needs resolution
    #[serde(rename = "conflict")]
    Conflict,
}

/// Resolution strategy for conflicts
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ConflictResolution {
    /// Keep version A
    #[serde(rename = "keep_a")]
    KeepA,
    /// Keep version B
    #[serde(rename = "keep_b")]
    KeepB,
    /// Use custom content
    #[serde(rename = "custom")]
    Custom(String),
}

/// User's selection for a single diff block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSelection {
    /// Block index in diff result
    pub block_id: usize,
    /// What to do with this block
    pub action: BlockAction,
    /// How to resolve if conflict
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<ConflictResolution>,
}

/// Detected conflict information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    /// Block ID where conflict occurs
    pub block_id: usize,
    /// Line numbers in file A
    pub line_range_a: (usize, usize),
    /// Line numbers in file B
    pub line_range_b: (usize, usize),
    /// Content from A
    pub content_a: String,
    /// Content from B
    pub content_b: String,
    /// Conflict type
    pub conflict_type: ConflictType,
}

/// Types of conflicts
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ConflictType {
    /// Both sides modified the same lines
    #[serde(rename = "both_modified")]
    BothModified,
    /// A deleted, B modified
    #[serde(rename = "delete_modify")]
    DeleteModify,
    /// A modified, B deleted
    #[serde(rename = "modify_delete")]
    ModifyDelete,
    /// A added, B also added (different content)
    #[serde(rename = "both_added")]
    BothAdded,
}

/// Result of applying blocks to target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    /// Whether merge succeeded without errors
    pub success: bool,
    /// Total blocks in diff
    pub total_blocks: usize,
    /// Blocks that were applied
    pub applied_count: usize,
    /// Blocks that were skipped
    pub skipped_count: usize,
    /// Blocks that had conflicts
    pub conflict_count: usize,
    /// Merged text content
    pub merged_text: String,
    /// Conflicts that couldn't be auto-resolved
    pub conflicts: Vec<ConflictInfo>,
    /// Summary message
    pub summary: String,
}

/// Options for merge operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct MergeOptions {
    /// Apply direction: "a_to_b" or "b_to_a"
    pub direction: MergeDirection,
    /// Conflict resolution strategy
    pub conflict_strategy: ConflictStrategy,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[allow(dead_code)]
pub enum MergeDirection {
    #[serde(rename = "a_to_b")]
    AToB,
    #[serde(rename = "b_to_a")]
    BToA,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[allow(dead_code)]
pub enum ConflictStrategy {
    /// Fail on first conflict
    #[serde(rename = "fail")]
    Fail,
    /// Skip conflicting blocks
    #[serde(rename = "skip")]
    Skip,
    /// Prefer A version
    #[serde(rename = "prefer_a")]
    PreferA,
    /// Prefer B version
    #[serde(rename = "prefer_b")]
    PreferB,
}

/// Three-way merge base
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ThreeWayMerge {
    /// Original base content
    pub base: String,
    /// Version A
    pub a: String,
    /// Version B
    pub b: String,
}

/// Request for three-way merge with base version
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ThreeWayMergeRequest {
    /// Base version (original)
    pub base_text: String,
    /// Version A
    pub text_a: String,
    /// Version B
    pub text_b: String,
}

/// Request for bidirectional merge with direction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidirectionalMergeRequest {
    /// Source text (A or B depending on direction)
    pub source_text: String,
    /// Target text (B or A depending on direction)
    pub target_text: String,
    /// User's block selections
    pub selections: Vec<BlockSelection>,
    /// Apply direction: "a_to_b" or "b_to_a"
    #[serde(default = "default_direction")]
    pub direction: String,
}

fn default_direction() -> String {
    "a_to_b".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_block_selection_serialization() {
        let sel = BlockSelection {
            block_id: 1,
            action: BlockAction::Apply,
            resolution: None,
        };
        
        let json = serde_json::to_string(&sel).unwrap();
        let deserialized: BlockSelection = serde_json::from_str(&json).unwrap();
        
        assert_eq!(sel.block_id, deserialized.block_id);
        assert_eq!(sel.action, deserialized.action);
    }

    #[test]
    fn test_conflict_resolution_variants() {
        assert_eq!(
            serde_json::to_string(&ConflictResolution::KeepA).unwrap(),
            r#""keep_a""#
        );
        
        let custom = ConflictResolution::Custom("custom content".to_string());
        let json = serde_json::to_string(&custom).unwrap();
        assert!(json.contains("custom content"));
    }

    #[test]
    fn test_merge_result() {
        let result = MergeResult {
            success: true,
            total_blocks: 5,
            applied_count: 3,
            skipped_count: 1,
            conflict_count: 1,
            merged_text: "result".to_string(),
            conflicts: vec![],
            summary: "Applied 3/5 blocks".to_string(),
        };

        assert!(result.success);
        assert_eq!(result.applied_count + result.skipped_count + result.conflict_count, 5);
    }
}
