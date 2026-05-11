/**
 * v0.8 P2: Merge Preview Component
 * Shows the result of merge before committing
 */

import React, { useState, useCallback, useEffect } from 'react';
import './MergePreview.css';

/**
 * MergePreview Component
 * 
 * Props:
 *   - result: MergeResult - The merge result object
 *   - isLoading: boolean - Whether merge is in progress
 *   - error: string - Error message if any
 *   - onApplyMerge: () => void - Callback to apply the merge
 *   - onCancelMerge: () => void - Callback to cancel merge
 */
export default function MergePreview({
  result = null,
  isLoading = false,
  error = null,
  onApplyMerge,
  onCancelMerge
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredLines, setFilteredLines] = useState([]);

  // Filter lines by search term
  useEffect(() => {
    if (!result?.merged_text || !searchTerm.trim()) {
      setFilteredLines([]);
      return;
    }

    const lines = result.merged_text.split('\n');
    const term = searchTerm.toLowerCase();
    const filtered = lines
      .map((line, idx) => ({
        line,
        idx,
        lineNum: idx + 1,
        match: line.toLowerCase().includes(term)
      }))
      .filter(item => item.match);
    
    setFilteredLines(filtered);
  }, [result, searchTerm]);

  if (isLoading) {
    return (
      <div className="merge-preview loading">
        <div className="spinner" />
        <p>正在生成合并结果...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="merge-preview error">
        <div className="error-icon">⚠️</div>
        <h3>合并失败</h3>
        <p className="error-message">{error}</p>
        <button className="btn-cancel" onClick={onCancelMerge}>
          返回
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="merge-preview empty">
        <p>未有合并结果</p>
      </div>
    );
  }

  const mergedLines = result.merged_text.split('\n');
  const successRate = result.total_blocks > 0 
    ? Math.round((result.applied_count / result.total_blocks) * 100)
    : 0;

  return (
    <div className="merge-preview">
      {/* Header */}
      <div className="preview-header">
        <h3>合并预览</h3>
        {result.success ? (
          <span className="status success">✓ 成功</span>
        ) : (
          <span className="status conflict">⚠ 有冲突</span>
        )}
      </div>

      {/* Statistics */}
      <div className="preview-stats">
        <div className="stat-item">
          <span className="stat-label">应用块:</span>
          <span className="stat-value">{result.applied_count}/{result.total_blocks}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">跳过块:</span>
          <span className="stat-value">{result.skipped_count}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">冲突块:</span>
          <span className="stat-value">{result.conflict_count}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">成功率:</span>
          <span className="stat-value">{successRate}%</span>
        </div>
      </div>

      {/* Success Rate Bar */}
      <div className="success-bar">
        <div className="bar-fill" style={{ width: `${successRate}%` }} />
      </div>

      {/* Summary */}
      <div className={`preview-summary ${result.success ? 'success' : 'warning'}`}>
        <p>{result.summary}</p>
      </div>

      {/* Conflict Info */}
      {result.conflicts && result.conflicts.length > 0 && (
        <div className="conflicts-info">
          <h4>发现的冲突 ({result.conflicts.length}):</h4>
          <div className="conflicts-list">
            {result.conflicts.map((conflict, idx) => (
              <div key={idx} className="conflict-item">
                <span className="conflict-type">{conflict.conflict_type}</span>
                <span className="conflict-block">块 #{conflict.block_id}</span>
                <span className="conflict-lines">
                  A: {conflict.line_range_a[0] + 1}-{conflict.line_range_a[1]} / 
                  B: {conflict.line_range_b[0] + 1}-{conflict.line_range_b[1]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview Controls */}
      <div className="preview-controls">
        <label className="control-checkbox">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.target.checked)}
          />
          <span>显示完整内容</span>
        </label>
        
        <input
          type="text"
          className="search-input"
          placeholder="搜索合并结果..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Merged Content */}
      <div className="merged-content">
        <div className="content-header">
          <h4>合并后的文本</h4>
          <span className="line-count">{mergedLines.length} 行</span>
        </div>

        <div className="content-area">
          {searchTerm ? (
            // Show search results
            <div className="search-results">
              {filteredLines.length > 0 ? (
                filteredLines.map((item, idx) => (
                  <div key={idx} className="merged-line highlight">
                    <span className="line-num">{item.lineNum}</span>
                    <span className="line-content">
                      {item.line.split(new RegExp(`(${searchTerm})`, 'gi')).map((part, i) => (
                        part.toLowerCase() === searchTerm.toLowerCase() ? (
                          <mark key={i}>{part}</mark>
                        ) : (
                          <span key={i}>{part}</span>
                        )
                      ))}
                    </span>
                  </div>
                ))
              ) : (
                <p className="no-results">未找到匹配项</p>
              )}
            </div>
          ) : showDiff ? (
            // Show all lines
            <div className="all-content">
              {mergedLines.map((line, idx) => (
                <div key={idx} className="merged-line">
                  <span className="line-num">{idx + 1}</span>
                  <span className="line-content">{line || '(空行)'}</span>
                </div>
              ))}
            </div>
          ) : (
            // Show preview (first 20 lines)
            <div className="preview-content">
              {mergedLines.slice(0, 20).map((line, idx) => (
                <div key={idx} className="merged-line">
                  <span className="line-num">{idx + 1}</span>
                  <span className="line-content">{line || '(空行)'}</span>
                </div>
              ))}
              {mergedLines.length > 20 && (
                <div className="preview-more">
                  ... 还有 {mergedLines.length - 20} 行 (勾选"显示完整内容"查看全部)
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Copy Button */}
      <div className="preview-actions">
        <button
          className="btn-copy"
          onClick={() => {
            navigator.clipboard.writeText(result.merged_text);
            alert('已复制到剪贴板');
          }}
        >
          📋 复制结果
        </button>
      </div>

      {/* Action Buttons */}
      <div className="preview-footer">
        <button className="btn-cancel" onClick={onCancelMerge}>
          取消
        </button>
        <button
          className={`btn-apply ${!result.success ? 'warning' : ''}`}
          onClick={onApplyMerge}
        >
          {result.success ? '✓ 应用合并' : '⚠ 应用合并 (有冲突)'}
        </button>
      </div>
    </div>
  );
}
