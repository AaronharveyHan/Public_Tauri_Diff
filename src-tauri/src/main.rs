// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod diff;
use diff::{diff_lines, DiffBlock, CompactDiffBlock, DiffTreeNode, recursive_diff_folders};
use diff::{BlockSelection, ConflictInfo, MergeResult, BidirectionalMergeRequest};  // v0.8: Merge types
use diff::merge_algo::{detect_conflicts, apply_blocks, three_way_merge_detect_conflicts, apply_blocks_bidirectional};  // v0.8: Merge algorithms
use diff::{SupportedLanguage, DiffResult as ASTDiffResult, diff as diff_ast};  // v0.9: diff_ast/ASTDiffResult 是别名，业务代码无需改动
use std::fs;
use serde::Deserialize;

// ---------------------------------------------------------------------------
// Request structs
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Deserialize)]
struct DiffFilesRequest {
    path_a: String,
    path_b: String,
}

#[derive(Deserialize)]
struct DiffFoldersRequest {
    path_a: String,
    path_b: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct DetectConflictsRequest {
    text_a: String,
    text_b: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct ApplyBlocksRequest {
    source_text: String,
    target_text: String,
    selections: Vec<BlockSelection>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct ThreeWayDetectConflictsRequest {
    base_text: String,
    text_a: String,
    text_b: String,
}

/// v0.9: supports both snake_case and camelCase from the frontend
#[allow(dead_code)]
#[derive(Deserialize)]
struct AstDiffRequest {
    #[serde(alias = "sourceText")]
    source_text: String,
    #[serde(alias = "targetText")]
    target_text: String,
    #[serde(alias = "filePath")]
    file_path: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct AstDiffFilesRequest {
    #[serde(alias = "sourcePath")]
    source_path: String,
    #[serde(alias = "targetPath")]
    target_path: String,
    #[serde(alias = "filePath")]
    file_path: String,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn diff_files(path_a: String, path_b: String) -> Result<Vec<DiffBlock>, String> {
    let a = read_lines(&path_a).map_err(|e| format!("Cannot read {}: {}", path_a, e))?;
    let b = read_lines(&path_b).map_err(|e| format!("Cannot read {}: {}", path_b, e))?;
    Ok(diff_lines(&a, &b))
}

#[tauri::command]
fn diff_files_compact(path_a: String, path_b: String) -> Result<Vec<CompactDiffBlock>, String> {
    let a = read_lines(&path_a).map_err(|e| format!("Cannot read {}: {}", path_a, e))?;
    let b = read_lines(&path_b).map_err(|e| format!("Cannot read {}: {}", path_b, e))?;
    let blocks = diff_lines(&a, &b);
    Ok(blocks.iter().map(|b| b.to_compact()).collect())
}

#[tauri::command]
fn diff_text(text_a: String, text_b: String) -> Vec<DiffBlock> {
    let a: Vec<String> = text_a.lines().map(|s| s.to_string()).collect();
    let b: Vec<String> = text_b.lines().map(|s| s.to_string()).collect();
    diff_lines(&a, &b)
}

#[tauri::command]
fn diff_text_compact(text_a: String, text_b: String) -> Vec<CompactDiffBlock> {
    let a: Vec<String> = text_a.lines().map(|s| s.to_string()).collect();
    let b: Vec<String> = text_b.lines().map(|s| s.to_string()).collect();
    let blocks = diff_lines(&a, &b);
    blocks.iter().map(|b| b.to_compact()).collect()
}

#[tauri::command]
fn load_content_range(path: String, start_line: usize, end_line: usize) -> Result<Vec<String>, String> {
    let lines = read_lines(&path).map_err(|e| format!("Cannot read {}: {}", path, e))?;
    let start = start_line.min(lines.len());
    let end = end_line.min(lines.len());
    Ok(lines.get(start..end).map(|s| s.to_vec()).unwrap_or_default())
}

#[tauri::command]
fn diff_folders(req: DiffFoldersRequest) -> Result<DiffTreeNode, String> {
    recursive_diff_folders(&req.path_a, &req.path_b)
}

// v0.8 -----------------------------------------------------------------------

#[tauri::command]
fn detect_conflicts_text(text_a: String, text_b: String) -> Result<Vec<ConflictInfo>, String> {
    let a: Vec<String> = text_a.lines().map(|s| s.to_string()).collect();
    let b: Vec<String> = text_b.lines().map(|s| s.to_string()).collect();
    let blocks = diff_lines(&a, &b);
    Ok(detect_conflicts(&a, &b, &blocks))
}

#[tauri::command]
fn apply_blocks_text(req: ApplyBlocksRequest) -> Result<MergeResult, String> {
    let source: Vec<String> = req.source_text.lines().map(|s| s.to_string()).collect();
    let target: Vec<String> = req.target_text.lines().map(|s| s.to_string()).collect();
    let blocks = diff_lines(&source, &target);
    Ok(apply_blocks(&source, &target, &blocks, &req.selections))
}

#[tauri::command]
fn three_way_merge_detect_conflicts_text(req: ThreeWayDetectConflictsRequest) -> Result<Vec<ConflictInfo>, String> {
    let base: Vec<String> = req.base_text.lines().map(|s| s.to_string()).collect();
    let a: Vec<String> = req.text_a.lines().map(|s| s.to_string()).collect();
    let b: Vec<String> = req.text_b.lines().map(|s| s.to_string()).collect();
    let blocks = diff_lines(&base, &b);
    Ok(three_way_merge_detect_conflicts(&base, &a, &b, &blocks))
}

#[tauri::command]
fn apply_blocks_bidirectional_text(req: BidirectionalMergeRequest) -> Result<MergeResult, String> {
    let source: Vec<String> = req.source_text.lines().map(|s| s.to_string()).collect();
    let target: Vec<String> = req.target_text.lines().map(|s| s.to_string()).collect();
    let blocks = diff_lines(&source, &target);
    Ok(apply_blocks_bidirectional(&source, &target, &blocks, &req.selections, &req.direction))
}

// v0.9 -----------------------------------------------------------------------

/// AST diff on raw text.
/// `from_file_extension` 已改名为 `from_path`（重构后）。
#[tauri::command]
fn diff_ast_text(req: AstDiffRequest) -> Result<ASTDiffResult, String> {
    let language = SupportedLanguage::from_path(&req.file_path)
        .ok_or_else(|| format!("Unsupported file type for AST diff: {}", req.file_path))?;
    diff_ast(&req.source_text, &req.target_text, language)
}

/// AST diff on files read from disk.
#[tauri::command]
fn diff_ast_files(req: AstDiffFilesRequest) -> Result<ASTDiffResult, String> {
    let language = SupportedLanguage::from_path(&req.file_path)
        .ok_or_else(|| format!("Unsupported file type for AST diff: {}", req.file_path))?;
    let source = fs::read_to_string(&req.source_path)
        .map_err(|e| format!("Cannot read {}: {}", req.source_path, e))?;
    let target = fs::read_to_string(&req.target_path)
        .map_err(|e| format!("Cannot read {}: {}", req.target_path, e))?;
    diff_ast(&source, &target, language)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Cannot read {}: {}", path, e))
}

fn read_lines(path: &str) -> std::io::Result<Vec<String>> {
    Ok(fs::read_to_string(path)?
        .lines()
        .map(|s| s.to_string())
        .collect())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            diff_files,
            diff_files_compact,
            diff_text,
            diff_text_compact,
            load_content_range,
            read_file_text,
            diff_folders,
            detect_conflicts_text,                 // v0.8
            apply_blocks_text,                     // v0.8
            three_way_merge_detect_conflicts_text, // v0.8 deep
            apply_blocks_bidirectional_text,       // v0.8 deep
            diff_ast_text,                         // v0.9
            diff_ast_files,                        // v0.9
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}