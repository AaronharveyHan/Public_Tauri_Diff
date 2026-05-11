/**
 * v0.8 P2: Block-level selector for two-way merge
 * Allows users to select Apply/Skip/Conflict for each diff block
 */

import React, { useState, useCallback } from 'react';
import './BlockSelector.css';

/**
 * BlockSelector Component
 * 
 * Props:
 *   - blocks: DiffBlock[] - List of diff blocks
 *   - conflicts: ConflictInfo[] - Detected conflicts
 *   - onSelectionsChange: (selections: BlockSelection[]) => void - Callback when selections change
 *   - sourceText: string - Source text for preview
 *   - targetText: string - Target text for preview
 */
export default function BlockSelector({
  blocks = [],
  conflicts = [],
  onSelectionsChange,
  sourceText = '',
  targetText = ''
}) {
  const [selections, setSelections] = useState([]);
  const [expandedBlocks, setExpandedBlocks] = useState(new Set());
  const [selectedConflictId, setSelectedConflictId] = useState(null);

  // Build conflict map for quick lookup
  const conflictMap = new Map(conflicts.map(c => [c.block_id, c]));

  // Get the action for a block
  const getBlockAction = useCallback((blockId) => {
    const sel = selections.find(s => s.block_id === blockId);
    return sel?.action || 'skip'; // Default to skip
  }, [selections]);

  // Get the resolution for a block (if conflict)
  const getBlockResolution = useCallback((blockId) => {
    const sel = selections.find(s => s.block_id === blockId);
    return sel?.resolution || null;
  }, [selections]);

  // Handle action change
  const handleActionChange = useCallback((blockId, action) => {
    setSelections(prev => {
      const existing = prev.findIndex(s => s.block_id === blockId);
      const newSelection = {
        block_id: blockId,
        action,
        resolution: undefined
      };

      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = newSelection;
        return updated;
      } else {
        return [...prev, newSelection];
      }
    });

    // Notify parent
    if (onSelectionsChange) {
      setTimeout(() => {
        const updated = selections.map(s => 
          s.block_id === blockId ? { ...s, action } : s
        );
        onSelectionsChange(updated);
      }, 0);
    }
  }, [selections, onSelectionsChange]);

  // Handle resolution change (for conflicts)
  const handleResolutionChange = useCallback((blockId, resolution) => {
    setSelections(prev => {
      const existing = prev.findIndex(s => s.block_id === blockId);
      const newSelection = {
        block_id: blockId,
        action: 'apply',
        resolution
      };

      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = newSelection;
        return updated;
      } else {
        return [...prev, newSelection];
      }
    });

    // Notify parent
    if (onSelectionsChange) {
      setTimeout(() => {
        const updated = selections.map(s => 
          s.block_id === blockId 
            ? { ...s, action: 'apply', resolution } 
            : s
        );
        onSelectionsChange(updated);
      }, 0);
    }
  }, [selections, onSelectionsChange]);

  // Toggle block expansion
  const toggleBlockExpansion = useCallback((blockId) => {
    setExpandedBlocks(prev => {
      const updated = new Set(prev);
      if (updated.has(blockId)) {
        updated.delete(blockId);
      } else {
        updated.add(blockId);
      }
      return updated;
    });
  }, []);

  // Get change type display name
  const getChangeTypeName = (changeType) => {
    const names = {
      'add': '添加',
      'remove': '删除',
      'modify': '修改'
    };
    return names[changeType] || changeType;
  };

  // Get change type color class
  const getChangeTypeClass = (changeType) => {
    const classes = {
      'add': 'change-add',
      'remove': 'change-remove',
      'modify': 'change-modify'
    };
    return classes[changeType] || '';
  };

  // Format line range display
  const formatLineRange = (start, end) => {
    return `${start + 1}-${end}`;
  };

  // Get preview content
  const getPreviewContent = (content, maxLines = 3) => {
    if (!content) return '(空)';
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n... 还有 ${lines.length - maxLines} 行`;
    }
    return content;
  };

  if (blocks.length === 0) {
    return (
      <div className="block-selector empty">
        <p>没有差异块</p>
      </div>
    );
  }

  return (
    <div className="block-selector">
      <div className="selector-header">
        <h3>差异块选择器 ({blocks.length} 个块{conflicts.length > 0 ? `, ${conflicts.length} 个冲突` : ''})</h3>
        <div className="selector-stats">
          <span className="stat">
            应用: <strong>{selections.filter(s => s.action === 'apply').length}</strong>
          </span>
          <span className="stat">
            跳过: <strong>{selections.filter(s => s.action === 'skip').length}</strong>
          </span>
          <span className="stat">
            冲突: <strong>{selections.filter(s => s.action === 'conflict').length}</strong>
          </span>
        </div>
      </div>

      <div className="blocks-list">
        {blocks.map((block, index) => {
          const conflict = conflictMap.get(index);
          const isExpanded = expandedBlocks.has(index);
          const action = getBlockAction(index);
          const resolution = getBlockResolution(index);

          return (
            <div
              key={index}
              className={`block-item ${getChangeTypeClass(block.change_type)} ${conflict ? 'has-conflict' : ''}`}
            >
              {/* Block Header */}
              <div className="block-header" onClick={() => toggleBlockExpansion(index)}>
                <button className="expand-btn">
                  {isExpanded ? '▼' : '▶'}
                </button>
                
                <div className="block-info">
                  <span className="block-id">块 #{index}</span>
                  <span className={`change-badge ${getChangeTypeClass(block.change_type)}`}>
                    {getChangeTypeName(block.change_type)}
                  </span>
                  
                  {block.change_type === 'add' && (
                    <span className="line-range">
                      添加到 {formatLineRange(block.start_b, block.end_b)}
                    </span>
                  )}
                  {block.change_type === 'remove' && (
                    <span className="line-range">
                      从 {formatLineRange(block.start_a, block.end_a)} 删除
                    </span>
                  )}
                  {block.change_type === 'modify' && (
                    <span className="line-range">
                      修改 {formatLineRange(block.start_a, block.end_a)} → {formatLineRange(block.start_b, block.end_b)}
                    </span>
                  )}
                </div>

                {conflict && (
                  <span className="conflict-badge" title="这个块有冲突">
                    ⚠️ 冲突
                  </span>
                )}
              </div>

              {/* Block Actions */}
              <div className="block-actions">
                <button
                  className={`action-btn apply-btn ${action === 'apply' ? 'active' : ''}`}
                  onClick={() => handleActionChange(index, 'apply')}
                  title="应用这个块"
                >
                  ✓ 应用
                </button>
                <button
                  className={`action-btn skip-btn ${action === 'skip' ? 'active' : ''}`}
                  onClick={() => handleActionChange(index, 'skip')}
                  title="跳过这个块"
                >
                  ✕ 跳过
                </button>
                <button
                  className={`action-btn conflict-btn ${action === 'conflict' ? 'active' : ''}`}
                  onClick={() => handleActionChange(index, 'conflict')}
                  title="标记为冲突"
                >
                  ⚠ 冲突
                </button>
              </div>

              {/* Conflict Resolution (if applicable) */}
              {conflict && action === 'apply' && (
                <div className="conflict-resolution">
                  <label>冲突解决:</label>
                  <select
                    value={resolution?.type || 'keep_a'}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        // Prompt for custom content
                        const custom = window.prompt('输入自定义内容:');
                        if (custom !== null) {
                          handleResolutionChange(index, { type: 'custom', content: custom });
                        }
                      } else {
                        handleResolutionChange(index, { type: e.target.value });
                      }
                    }}
                  >
                    <option value="keep_a">保留版本 A</option>
                    <option value="keep_b">保留版本 B</option>
                    <option value="custom">自定义内容</option>
                  </select>
                </div>
              )}

              {/* Expanded Details */}
              {isExpanded && (
                <div className="block-details">
                  <div className="detail-section">
                    <h4>版本 A ({block.content_a?.length || 0} 行):</h4>
                    <pre className="content-preview">
                      {getPreviewContent((block.content_a || []).join('\n'))}
                    </pre>
                  </div>

                  <div className="detail-section">
                    <h4>版本 B ({block.content_b?.length || 0} 行):</h4>
                    <pre className="content-preview">
                      {getPreviewContent((block.content_b || []).join('\n'))}
                    </pre>
                  </div>

                  {conflict && (
                    <div className="detail-section conflict-info">
                      <h4>冲突信息:</h4>
                      <p><strong>冲突类型:</strong> {conflict.conflict_type}</p>
                      <p><strong>位置 A:</strong> 行 {conflict.line_range_a[0] + 1}-{conflict.line_range_a[1]}</p>
                      <p><strong>位置 B:</strong> 行 {conflict.line_range_b[0] + 1}-{conflict.line_range_b[1]}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
