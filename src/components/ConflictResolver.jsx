/**
 * v0.8 P2: Conflict Resolver Component
 * Handles conflict resolution with visual diff and merge strategies
 */

import React, { useState, useCallback } from 'react';
import './ConflictResolver.css';

/**
 * ConflictResolver Component
 * 
 * Props:
 *   - conflicts: ConflictInfo[] - List of conflicts to resolve
 *   - onResolutionChange: (blockId, resolution) => void - Callback when resolution changes
 *   - sourceText: string - Source text for context
 *   - targetText: string - Target text for context
 */
export default function ConflictResolver({
  conflicts = [],
  onResolutionChange,
  sourceText = '',
  targetText = ''
}) {
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [resolutions, setResolutions] = useState({});
  const [customContent, setCustomContent] = useState({});

  const currentConflict = conflicts[currentConflictIndex];

  // Handle resolution selection
  const handleResolutionSelect = useCallback((blockId, resolution) => {
    setResolutions(prev => ({
      ...prev,
      [blockId]: resolution
    }));

    if (onResolutionChange) {
      onResolutionChange(blockId, resolution);
    }
  }, [onResolutionChange]);

  // Handle custom content
  const handleCustomContentChange = useCallback((blockId, content) => {
    setCustomContent(prev => ({
      ...prev,
      [blockId]: content
    }));
  }, []);

  // Apply custom content
  const applyCustomContent = useCallback((blockId) => {
    const content = customContent[blockId];
    if (content) {
      handleResolutionSelect(blockId, {
        type: 'custom',
        content
      });
    }
  }, [customContent, handleResolutionSelect]);

  // Navigate to next conflict
  const nextConflict = useCallback(() => {
    if (currentConflictIndex < conflicts.length - 1) {
      setCurrentConflictIndex(currentConflictIndex + 1);
    }
  }, [currentConflictIndex, conflicts.length]);

  // Navigate to previous conflict
  const prevConflict = useCallback(() => {
    if (currentConflictIndex > 0) {
      setCurrentConflictIndex(currentConflictIndex - 1);
    }
  }, [currentConflictIndex]);

  // Get conflict type description
  const getConflictTypeDescription = (conflictType) => {
    const descriptions = {
      'both_modified': '两边都修改了',
      'delete_modify': '一边删除，一边修改',
      'modify_delete': '一边修改，一边删除',
      'both_added': '两边都添加了'
    };
    return descriptions[conflictType.toLowerCase()] || conflictType;
  };

  // Highlight differences in text
  const highlightDifferences = (text, highlight = true) => {
    if (!highlight) return text;
    
    // Simple highlighting - can be enhanced with more sophisticated diff
    const lines = text.split('\n');
    return lines.map((line, idx) => (
      <div key={idx} className="diff-line">
        <span className="line-num">{idx + 1}</span>
        <span className="line-content">{line || '(空行)'}</span>
      </div>
    ));
  };

  if (conflicts.length === 0) {
    return (
      <div className="conflict-resolver empty">
        <div className="empty-state">
          <p>✓ 没有冲突</p>
          <p className="hint">所有差异块都可以自动合并</p>
        </div>
      </div>
    );
  }

  return (
    <div className="conflict-resolver">
      {/* Header */}
      <div className="resolver-header">
        <h3>冲突解决</h3>
        <span className="conflict-count">
          {currentConflictIndex + 1} / {conflicts.length}
        </span>
      </div>

      {currentConflict && (
        <>
          {/* Conflict Info */}
          <div className="conflict-info-panel">
            <div className="conflict-type">
              <strong>冲突类型:</strong>
              <span className="type-badge">
                {getConflictTypeDescription(currentConflict.conflict_type)}
              </span>
            </div>
            <div className="block-location">
              <strong>位置:</strong>
              <span>块 #{currentConflict.block_id}</span>
            </div>
          </div>

          {/* Side-by-side Comparison */}
          <div className="conflict-comparison">
            <div className="conflict-side version-a">
              <div className="side-header">
                <h4>版本 A</h4>
                <span className="line-count">
                  {currentConflict.line_range_a[0] + 1}-{currentConflict.line_range_a[1]} 行
                </span>
              </div>
              <div className="side-content">
                {currentConflict.content_a ? (
                  highlightDifferences(currentConflict.content_a)
                ) : (
                  <p className="empty-content">(已删除)</p>
                )}
              </div>
            </div>

            <div className="conflict-side version-b">
              <div className="side-header">
                <h4>版本 B</h4>
                <span className="line-count">
                  {currentConflict.line_range_b[0] + 1}-{currentConflict.line_range_b[1]} 行
                </span>
              </div>
              <div className="side-content">
                {currentConflict.content_b ? (
                  highlightDifferences(currentConflict.content_b)
                ) : (
                  <p className="empty-content">(已删除)</p>
                )}
              </div>
            </div>
          </div>

          {/* Resolution Options */}
          <div className="resolution-options">
            <h4>选择解决方案:</h4>

            <div className="option-buttons">
              <button
                className={`resolution-btn keep-a ${
                  resolutions[currentConflict.block_id]?.type === 'keep_a' ? 'active' : ''
                }`}
                onClick={() => handleResolutionSelect(currentConflict.block_id, { type: 'keep_a' })}
              >
                <span className="option-icon">←</span>
                <span className="option-label">保留 A</span>
                <span className="option-desc">使用版本 A</span>
              </button>

              <button
                className={`resolution-btn keep-b ${
                  resolutions[currentConflict.block_id]?.type === 'keep_b' ? 'active' : ''
                }`}
                onClick={() => handleResolutionSelect(currentConflict.block_id, { type: 'keep_b' })}
              >
                <span className="option-icon">→</span>
                <span className="option-label">保留 B</span>
                <span className="option-desc">使用版本 B</span>
              </button>

              <button
                className={`resolution-btn combine ${
                  resolutions[currentConflict.block_id]?.type === 'combine' ? 'active' : ''
                }`}
                onClick={() => handleResolutionSelect(currentConflict.block_id, { type: 'combine' })}
              >
                <span className="option-icon">⊕</span>
                <span className="option-label">合并</span>
                <span className="option-desc">合并两个版本</span>
              </button>
            </div>

            {/* Custom Content */}
            <div className="custom-resolution">
              <label htmlFor={`custom-${currentConflict.block_id}`}>
                或输入自定义内容:
              </label>
              <textarea
                id={`custom-${currentConflict.block_id}`}
                className="custom-input"
                value={customContent[currentConflict.block_id] || ''}
                onChange={(e) => handleCustomContentChange(currentConflict.block_id, e.target.value)}
                placeholder="输入您想要的内容..."
                rows="6"
              />
              <button
                className="apply-custom-btn"
                onClick={() => applyCustomContent(currentConflict.block_id)}
              >
                应用自定义内容
              </button>
            </div>
          </div>

          {/* Navigation */}
          <div className="resolver-navigation">
            <button
              className="nav-btn prev"
              onClick={prevConflict}
              disabled={currentConflictIndex === 0}
            >
              ← 上一个
            </button>

            <span className="progress">
              {currentConflictIndex + 1} / {conflicts.length}
            </span>

            <button
              className="nav-btn next"
              onClick={nextConflict}
              disabled={currentConflictIndex === conflicts.length - 1}
            >
              下一个 →
            </button>
          </div>

          {/* Resolution Status */}
          <div className="resolution-status">
            <strong>已解决:</strong> {Object.keys(resolutions).length} / {conflicts.length}
            <div className="status-bar">
              <div
                className="status-fill"
                style={{
                  width: `${(Object.keys(resolutions).length / conflicts.length) * 100}%`
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
