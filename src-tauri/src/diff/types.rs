use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Add,
    Remove,
    Modify,
}

/// Full DiffBlock with complete content
/// Used internally for computation
#[derive(Debug, Clone, Serialize)]
pub struct DiffBlock {
    pub start_a: usize,
    pub end_a: usize,
    pub start_b: usize,
    pub end_b: usize,
    pub change_type: ChangeType,
    pub content_a: Vec<String>,
    pub content_b: Vec<String>,
}

/// Compact DiffBlock: only line ranges, no content
/// P2.5: Memory-efficient format for transmission and storage
/// Saves ~50% memory by storing only indices
/// 
/// Typical savings per block:
/// - Full: 2000 lines * 50 bytes/line = 100 KB (x2 for A and B)
/// - Compact: 4 * 8 bytes = 32 bytes
/// - Ratio: 200 KB → 0.1 KB = 99.95% reduction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactDiffBlock {
    pub start_a: usize,
    pub end_a: usize,
    pub start_b: usize,
    pub end_b: usize,
    pub change_type: ChangeType,
}

impl DiffBlock {
    /// Convert full block to compact format (P2.5)
    /// Discards content but preserves all structural information
    pub fn to_compact(&self) -> CompactDiffBlock {
        CompactDiffBlock {
            start_a: self.start_a,
            end_a: self.end_a,
            start_b: self.start_b,
            end_b: self.end_b,
            change_type: self.change_type.clone(),
        }
    }
}

impl CompactDiffBlock {
    /// Get number of lines in file A
    #[allow(dead_code)]
    pub fn len_a(&self) -> usize {
        self.end_a.saturating_sub(self.start_a)
    }

    /// Get number of lines in file B
    #[allow(dead_code)]
    pub fn len_b(&self) -> usize {
        self.end_b.saturating_sub(self.start_b)
    }

    /// Check if block is empty
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len_a() == 0 && self.len_b() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compact_conversion() {
        let full_block = DiffBlock {
            start_a: 10,
            end_a: 20,
            start_b: 15,
            end_b: 30,
            change_type: ChangeType::Modify,
            content_a: vec!["line".to_string(); 10],
            content_b: vec!["line".to_string(); 15],
        };

        let compact = full_block.to_compact();
        assert_eq!(compact.start_a, 10);
        assert_eq!(compact.end_a, 20);
        assert_eq!(compact.start_b, 15);
        assert_eq!(compact.end_b, 30);
        assert_eq!(compact.len_a(), 10);
        assert_eq!(compact.len_b(), 15);
    }

    #[test]
    fn test_compact_memory_savings() {
        // Full block: 10K lines × ~50 bytes = ~500 KB
        let full_block = DiffBlock {
            start_a: 0,
            end_a: 5000,
            start_b: 0,
            end_b: 5000,
            change_type: ChangeType::Modify,
            content_a: (0..5000).map(|i| format!("line {}", i)).collect(),
            content_b: (0..5000).map(|i| format!("line {}", i)).collect(),
        };

        // Measure approximate sizes
        let full_size = std::mem::size_of_val(&full_block)
            + full_block.content_a.iter().map(|s| s.len()).sum::<usize>()
            + full_block.content_b.iter().map(|s| s.len()).sum::<usize>();

        let compact = full_block.to_compact();
        let compact_size = std::mem::size_of_val(&compact);

        // Compact should be < 1% of full size (typically 0.1%)
        assert!(compact_size < full_size / 100);
    }

    #[test]
    fn test_compact_len_a() {
        let compact = CompactDiffBlock {
            start_a: 100,
            end_a: 150,
            start_b: 200,
            end_b: 250,
            change_type: ChangeType::Remove,
        };

        assert_eq!(compact.len_a(), 50);
        assert_eq!(compact.len_b(), 50);
    }

    #[test]
    fn test_compact_len_zero() {
        let compact = CompactDiffBlock {
            start_a: 100,
            end_a: 100,
            start_b: 200,
            end_b: 200,
            change_type: ChangeType::Add,
        };

        assert_eq!(compact.len_a(), 0);
        assert_eq!(compact.len_b(), 0);
        assert!(compact.is_empty());
    }

    #[test]
    fn test_compact_saturation() {
        // Test edge case: end < start
        let compact = CompactDiffBlock {
            start_a: 100,
            end_a: 50,  // Invalid, end < start
            start_b: 200,
            end_b: 150,
            change_type: ChangeType::Modify,
        };

        // saturating_sub should return 0
        assert_eq!(compact.len_a(), 0);
        assert_eq!(compact.len_b(), 0);
    }
}

// ============ Folder Diff Types (v0.7) ============

/// File status in folder comparison
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    #[serde(rename = "added")]
    Added,          // Only in B
    #[serde(rename = "removed")]
    Removed,        // Only in A
    #[serde(rename = "modified")]
    Modified,       // In both but different
    #[serde(rename = "identical")]
    Identical,      // In both and same
}

/// File node in diff tree
#[derive(Debug, Clone, Serialize)]
pub struct FileDiffNode {
    pub name: String,
    pub path_a: Option<String>,
    pub path_b: Option<String>,
    pub status: FileStatus,
    pub size_a: Option<u64>,
    pub size_b: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<CompactDiffBlock>>,
}

/// Directory summary statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectorySummary {
    pub total_files: usize,
    pub modified_files: usize,
    pub added_files: usize,
    pub removed_files: usize,
    pub identical_files: usize,
}

impl DirectorySummary {
    pub fn new() -> Self {
        DirectorySummary {
            total_files: 0,
            modified_files: 0,
            added_files: 0,
            removed_files: 0,
            identical_files: 0,
        }
    }

    pub fn add_status(&mut self, status: &FileStatus) {
        self.total_files += 1;
        match status {
            FileStatus::Added => self.added_files += 1,
            FileStatus::Removed => self.removed_files += 1,
            FileStatus::Modified => self.modified_files += 1,
            FileStatus::Identical => self.identical_files += 1,
        }
    }
}

/// Directory node in diff tree
#[derive(Debug, Clone, Serialize)]
pub struct DirectoryDiffNode {
    pub name: String,
    pub path_a: Option<String>,
    pub path_b: Option<String>,
    pub children: Vec<DiffTreeNode>,
    pub summary: DirectorySummary,
}

/// Tree node: either file or directory
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum DiffTreeNode {
    #[serde(rename = "file")]
    File(FileDiffNode),
    #[serde(rename = "directory")]
    Directory(DirectoryDiffNode),
}
