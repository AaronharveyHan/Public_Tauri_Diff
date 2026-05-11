use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::{WalkDir, DirEntry};
use crate::diff::types::*;
use crate::diff::diff_lines;

/// Recursive folder diff comparison
/// 
/// Returns a tree structure showing:
/// - Directory hierarchy
/// - File status (added/removed/modified/identical)
/// - Summary statistics per directory
/// - Compact diff blocks for modified files
pub fn recursive_diff_folders(
    path_a: &str,
    path_b: &str,
) -> Result<DiffTreeNode, String> {
    let path_a = PathBuf::from(path_a);
    let path_b = PathBuf::from(path_b);

    if !path_a.exists() {
        return Err(format!("Path A does not exist: {}", path_a.display()));
    }

    // Handle both directory and file inputs
    if path_a.is_file() && path_b.is_file() {
        // Single file diff (shouldn't happen, but handle gracefully)
        return single_file_diff(&path_a, &path_b);
    }

    if !path_b.exists() {
        return Err(format!("Path B does not exist: {}", path_b.display()));
    }

    if path_a.is_dir() && path_b.is_dir() {
        diff_directories(&path_a, &path_b)
    } else {
        Err("Both paths must be directories or both must be files".to_string())
    }
}

/// Diff two directories recursively
fn diff_directories(path_a: &Path, path_b: &Path) -> Result<DiffTreeNode, String> {
    // Build file maps for each directory
    let files_a = build_file_map(path_a)?;
    let files_b = build_file_map(path_b)?;

    // Get all unique paths
    let mut all_paths = std::collections::HashSet::new();
    all_paths.extend(files_a.keys().cloned());
    all_paths.extend(files_b.keys().cloned());

    let mut children = Vec::new();
    let mut summary = DirectorySummary::new();

    for rel_path in all_paths.iter() {
        let full_path_a = path_a.join(rel_path);
        let full_path_b = path_b.join(rel_path);

        let entry_a = files_a.get(rel_path);
        let entry_b = files_b.get(rel_path);

        match (entry_a, entry_b) {
            (Some(_), Some(_)) => {
                // Both exist: file or directory
                if full_path_a.is_dir() {
                    // Recurse into directory
                    match diff_directories(&full_path_a, &full_path_b) {
                        Ok(DiffTreeNode::Directory(dir_node)) => {
                            // Update summary
                            summary.total_files += dir_node.summary.total_files;
                            summary.modified_files += dir_node.summary.modified_files;
                            summary.added_files += dir_node.summary.added_files;
                            summary.removed_files += dir_node.summary.removed_files;
                            summary.identical_files += dir_node.summary.identical_files;
                            children.push(DiffTreeNode::Directory(dir_node));
                        }
                        Ok(other) => children.push(other),
                        Err(e) => eprintln!("Error diffing directory: {}", e),
                    }
                } else {
                    // File comparison
                    let status = compare_files(&full_path_a, &full_path_b)?;
                    let size_a = fs::metadata(&full_path_a).ok().map(|m| m.len());
                    let size_b = fs::metadata(&full_path_b).ok().map(|m| m.len());

                    summary.add_status(&status);

                    let blocks = if status == FileStatus::Modified {
                        get_file_diff(&full_path_a, &full_path_b).ok()
                    } else {
                        None
                    };

                    let node = FileDiffNode {
                        name: rel_path.clone(),
                        path_a: Some(full_path_a.to_string_lossy().into_owned()),
                        path_b: Some(full_path_b.to_string_lossy().into_owned()),
                        status,
                        size_a,
                        size_b,
                        blocks,
                    };

                    children.push(DiffTreeNode::File(node));
                }
            }
            (Some(_), None) => {
                // Only in A: removed
                let size_a = fs::metadata(&full_path_a).ok().map(|m| m.len());
                summary.add_status(&FileStatus::Removed);

                let node = FileDiffNode {
                    name: rel_path.clone(),
                    path_a: Some(full_path_a.to_string_lossy().into_owned()),
                    path_b: None,
                    status: FileStatus::Removed,
                    size_a,
                    size_b: None,
                    blocks: None,
                };

                children.push(DiffTreeNode::File(node));
            }
            (None, Some(_)) => {
                // Only in B: added
                let size_b = fs::metadata(&full_path_b).ok().map(|m| m.len());
                summary.add_status(&FileStatus::Added);

                let node = FileDiffNode {
                    name: rel_path.clone(),
                    path_a: None,
                    path_b: Some(full_path_b.to_string_lossy().into_owned()),
                    status: FileStatus::Added,
                    size_a: None,
                    size_b,
                    blocks: None,
                };

                children.push(DiffTreeNode::File(node));
            }
            _ => {} // Should not happen
        }
    }

    // Sort children for consistent output
    children.sort_by(|a, b| {
        let a_name = match a {
            DiffTreeNode::File(f) => &f.name,
            DiffTreeNode::Directory(d) => &d.name,
        };
        let b_name = match b {
            DiffTreeNode::File(f) => &f.name,
            DiffTreeNode::Directory(d) => &d.name,
        };
        a_name.cmp(b_name)
    });

    let dir_node = DirectoryDiffNode {
        name: path_a
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("root")
            .to_string(),
        path_a: Some(path_a.to_string_lossy().into_owned()),
        path_b: Some(path_b.to_string_lossy().into_owned()),
        children,
        summary,
    };

    Ok(DiffTreeNode::Directory(dir_node))
}

/// Build a map of relative paths to entries for a directory
fn build_file_map(path: &Path) -> Result<HashMap<String, DirEntry>, String> {
    let mut map = HashMap::new();

    // Walk directory, collecting files and directories
    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .skip(1) // Skip root
    {
        // Skip hidden files and common ignore patterns
        if is_ignored(entry.path()) {
            if entry.path().is_dir() {
                // Don't recurse into ignored directories
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_dir() {
                        continue;
                    }
                }
            }
            continue;
        }

        match entry.path().strip_prefix(path) {
            Ok(rel_path) => {
                let key = rel_path.to_string_lossy().into_owned();
                map.insert(key, entry);
            }
            Err(_) => {} // Skip if can't get relative path
        }
    }

    Ok(map)
}

/// Check if path should be ignored
fn is_ignored(path: &Path) -> bool {
    let ignore_patterns = [
        ".git",
        ".gitignore",
        "node_modules",
        "target",
        "dist",
        "build",
        ".DS_Store",
        ".next",
        ".venv",
        "__pycache__",
        "*.o",
        "*.a",
        ".swp",
        ".swo",
    ];

    let path_str = path.to_string_lossy();

    for pattern in &ignore_patterns {
        if pattern.starts_with('*') {
            // Extension pattern
            if path_str.ends_with(&pattern[1..]) {
                return true;
            }
        } else if path_str.contains(&format!("/{}/", pattern)) || path_str.ends_with(&format!("/{}", pattern)) {
            return true;
        }
    }

    false
}

/// Compare two files for equality
fn compare_files(path_a: &Path, path_b: &Path) -> Result<FileStatus, String> {
    // Quick size check
    let meta_a = fs::metadata(path_a).map_err(|e| e.to_string())?;
    let meta_b = fs::metadata(path_b).map_err(|e| e.to_string())?;

    if meta_a.len() != meta_b.len() {
        return Ok(FileStatus::Modified);
    }

    // Read both files (with size limit to avoid OOM)
    const MAX_SIZE_FOR_COMPARE: u64 = 100 * 1024 * 1024; // 100 MB

    if meta_a.len() > MAX_SIZE_FOR_COMPARE {
        // For large files, just compare metadata
        return Ok(if meta_a.modified().map_err(|e| e.to_string())? 
               == meta_b.modified().map_err(|e| e.to_string())? {
            FileStatus::Identical
        } else {
            FileStatus::Modified
        });
    }

    let content_a = fs::read(path_a).map_err(|e| e.to_string())?;
    let content_b = fs::read(path_b).map_err(|e| e.to_string())?;

    Ok(if content_a == content_b {
        FileStatus::Identical
    } else {
        FileStatus::Modified
    })
}

/// Get diff blocks for two files
fn get_file_diff(path_a: &Path, path_b: &Path) -> Result<Vec<CompactDiffBlock>, String> {
    let content_a = fs::read_to_string(path_a)
        .map_err(|e| format!("Failed to read file A: {}", e))?;
    let content_b = fs::read_to_string(path_b)
        .map_err(|e| format!("Failed to read file B: {}", e))?;

    let lines_a: Vec<String> = content_a.lines().map(|s| s.to_string()).collect();
    let lines_b: Vec<String> = content_b.lines().map(|s| s.to_string()).collect();

    let blocks = diff_lines(&lines_a, &lines_b);
    Ok(blocks.iter().map(|b| b.to_compact()).collect())
}

/// Handle single file diff (fallback)
fn single_file_diff(path_a: &Path, path_b: &Path) -> Result<DiffTreeNode, String> {
    let status = compare_files(path_a, path_b)?;
    let size_a = fs::metadata(path_a).ok().map(|m| m.len());
    let size_b = fs::metadata(path_b).ok().map(|m| m.len());

    let blocks = if status == FileStatus::Modified {
        get_file_diff(path_a, path_b).ok()
    } else {
        None
    };

    let node = FileDiffNode {
        name: path_a
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string(),
        path_a: Some(path_a.to_string_lossy().into_owned()),
        path_b: Some(path_b.to_string_lossy().into_owned()),
        status,
        size_a,
        size_b,
        blocks,
    };

    Ok(DiffTreeNode::File(node))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_compare_identical_files() {
        let dir = TempDir::new().unwrap();
        let file_a = dir.path().join("a.txt");
        let file_b = dir.path().join("b.txt");

        fs::write(&file_a, "hello\nworld").unwrap();
        fs::write(&file_b, "hello\nworld").unwrap();

        assert_eq!(compare_files(&file_a, &file_b).unwrap(), FileStatus::Identical);
    }

    #[test]
    fn test_compare_different_files() {
        let dir = TempDir::new().unwrap();
        let file_a = dir.path().join("a.txt");
        let file_b = dir.path().join("b.txt");

        fs::write(&file_a, "hello").unwrap();
        fs::write(&file_b, "world").unwrap();

        assert_eq!(compare_files(&file_a, &file_b).unwrap(), FileStatus::Modified);
    }

    #[test]
    fn test_is_ignored() {
        assert!(is_ignored(Path::new("/path/.git")));
        assert!(is_ignored(Path::new("/path/node_modules/foo")));
        assert!(is_ignored(Path::new("/path/target")));
        assert!(!is_ignored(Path::new("/path/src")));
    }

    #[test]
    fn test_directory_summary() {
        let mut summary = DirectorySummary::new();
        summary.add_status(&FileStatus::Added);
        summary.add_status(&FileStatus::Modified);
        summary.add_status(&FileStatus::Identical);

        assert_eq!(summary.total_files, 3);
        assert_eq!(summary.added_files, 1);
        assert_eq!(summary.modified_files, 1);
        assert_eq!(summary.identical_files, 1);
    }
}
