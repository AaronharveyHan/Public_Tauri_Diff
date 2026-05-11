import { useState, useCallback, useEffect, useRef } from 'react';
import './FolderDiff.css';

// Lazy-load Tauri invoke
let _invoke = null;
async function getInvoke() {
  if (_invoke) return _invoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke;
  } catch (e) {
    console.error("Failed to load Tauri invoke:", e);
    throw new Error("Tauri API not available");
  }
  return _invoke;
}

/**
 * FolderDiff Component - v0.7
 * Displays recursive folder comparison with tree view
 * 
 * Props:
 * - pathA: string - Path to first directory
 * - pathB: string - Path to second directory
 * - onFileSelect: (pathA, pathB) => void - Called when user clicks a file
 */
export function FolderDiff({ pathA, pathB, onFileSelect }) {
  const [treeData, setTreeData] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const previousPathsRef = useRef(null);

  // Load folder diff tree
  const loadFolderDiff = useCallback(async () => {
    if (!pathA || !pathB) return;
    
    setLoading(true);
    setError(null);
    try {
      console.log("FolderDiff loading with paths:", { pathA, pathB });
      const invoke = await getInvoke();
      const result = await invoke('diff_folders', {
        pathA: pathA,
        pathB: pathB,
      });
      console.log("FolderDiff result:", result);
      setTreeData(result);
      // Auto-expand root node
      setExpandedNodes(new Set(['root']));
    } catch (err) {
      console.error("FolderDiff error:", err);
      setError(err.message || 'Failed to load folder diff');
      setTreeData(null);
    } finally {
      setLoading(false);
    }
  }, [pathA, pathB]);

  // Auto-load when paths change, but only once per unique path combination
  useEffect(() => {
    const currentPaths = `${pathA}|${pathB}`;
    if (currentPaths !== previousPathsRef.current) {
      previousPathsRef.current = currentPaths;
      loadFolderDiff();
    }
  }, [pathA, pathB, loadFolderDiff]);

  const toggleNode = useCallback((nodeId) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  if (!treeData) {
    return (
      <div className="folder-diff-container">
        <div className="folder-diff-header">
          <div className="folder-diff-paths">
            <span className="folder-path">📁 {pathA}</span>
            <span className="folder-arrow">→</span>
            <span className="folder-path">📁 {pathB}</span>
          </div>
          <button
            className="btn btn-primary"
            onClick={loadFolderDiff}
            disabled={loading}
          >
            {loading ? 'Comparing...' : 'Compare Folders'}
          </button>
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>
    );
  }

  return (
    <div className="folder-diff-container">
      <div className="folder-diff-header">
        <div className="folder-diff-paths">
          <span className="folder-path">📁 {pathA}</span>
          <span className="folder-arrow">→</span>
          <span className="folder-path">📁 {pathB}</span>
        </div>
        <button
          className="btn btn-secondary"
          onClick={loadFolderDiff}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className="folder-diff-content">
        <TreeNode
          node={treeData}
          nodeId="root"
          expanded={expandedNodes.has('root')}
          expandedNodes={expandedNodes}
          onToggle={toggleNode}
          onFileSelect={onFileSelect}
          depth={0}
        />
      </div>
    </div>
  );
}

/**
 * TreeNode Component - Recursively renders file/directory nodes
 */
function TreeNode({
  node,
  nodeId,
  expanded,
  expandedNodes,
  onToggle,
  onFileSelect,
  depth,
}) {
  const isFile = node.type === 'file';
  const isDirectory = node.type === 'directory';

  if (isFile) {
    const file = node.data;
    const statusClass = `status-${file.status}`;
    const statusLabel = getStatusLabel(file.status);
    const sizeLabel = formatFileSize(file.status === 'removed' ? file.size_a : file.size_b);

    return (
      <div
        className="tree-node file-node"
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        <button
          className="file-link"
          onClick={() => {
            if (file.path_a && file.path_b) {
              onFileSelect(file.path_a, file.path_b);
            }
          }}
        >
          <span className="file-icon">📄</span>
          <span className="file-name">{file.name}</span>
          <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
          {sizeLabel && <span className="file-size">{sizeLabel}</span>}
        </button>
      </div>
    );
  }

  if (isDirectory) {
    const dir = node.data;
    const hasChildren = dir.children && dir.children.length > 0;
    const summary = dir.summary;
    const childCount = formatSummary(summary);

    return (
      <div className="tree-node directory-node">
        <div
          className="directory-header"
          style={{ paddingLeft: `${depth * 20}px` }}
        >
          <button
            className="chevron"
            onClick={() => onToggle(nodeId)}
            disabled={!hasChildren}
          >
            {hasChildren ? (expanded ? '▼' : '▶') : '•'}
          </button>
          <span className="folder-icon">📁</span>
          <span className="folder-name">{dir.name}</span>
          {childCount && <span className="summary-badge">{childCount}</span>}
        </div>

        {expanded && hasChildren && (
          <div className="directory-children">
            {dir.children.map((child, idx) => {
              const childId = `${nodeId}-${idx}`;
              return (
                <TreeNode
                  key={childId}
                  node={child}
                  nodeId={childId}
                  expanded={expandedNodes.has(childId)}
                  expandedNodes={expandedNodes}
                  onToggle={onToggle}
                  onFileSelect={onFileSelect}
                  depth={depth + 1}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
}

/**
 * Helper: Get human-readable status label
 */
function getStatusLabel(status) {
  const labels = {
    identical: '✓',
    modified: '◆',
    added: '+',
    removed: '−',
  };
  return labels[status] || status;
}

/**
 * Helper: Format file size
 */
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Helper: Format directory summary
 */
function formatSummary(summary) {
  const parts = [];
  if (summary.modified_files > 0) parts.push(`${summary.modified_files} modified`);
  if (summary.added_files > 0) parts.push(`${summary.added_files} added`);
  if (summary.removed_files > 0) parts.push(`${summary.removed_files} removed`);
  if (summary.identical_files > 0) parts.push(`${summary.identical_files} identical`);

  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}
