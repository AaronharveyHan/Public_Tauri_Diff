pub mod myers_diff;
pub mod lcs_diff;
pub mod types;
pub mod folder_diff;
pub mod merge;      // v0.8: Two-way selective merge support
pub mod merge_algo; // v0.8: Merge algorithms
pub mod ast_diff;   // v0.9: AST-level diff with tree-sitter

#[cfg(test)]
mod ast_diff_tests;

pub use myers_diff::diff_lines;
pub use types::{DiffBlock, CompactDiffBlock, DiffTreeNode};
pub use folder_diff::recursive_diff_folders;

#[allow(unused_imports)]
pub use merge::{
    BlockAction, BlockSelection, ConflictInfo, ConflictResolution, ConflictType,
    MergeResult, MergeDirection, ConflictStrategy, MergeOptions,
    ThreeWayMerge, ThreeWayMergeRequest, BidirectionalMergeRequest,
};

#[allow(unused_imports)]
pub use merge_algo::{
    detect_conflicts, apply_blocks,
    three_way_merge_detect_conflicts, apply_blocks_bidirectional,
};

#[allow(unused_imports)]
pub use ast_diff::{
    // v0.9: AST diff — 重构后的公开符号
    diff,            // 原 diff_ast
    SupportedLanguage,
    DiffResult,      // 原 ASTDiffResult
    DiffBlock as ASTDiffBlock,   // 注意：types 里已有 DiffBlock，用别名区分
    NodeSnapshot,    // 原 ASTNodeInfo
    ParserPool,      // 原 ASTParser
};