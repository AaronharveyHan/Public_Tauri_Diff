/**
 * v0.8 Deep: Enhanced Merge Panel
 * Supports:
 * - Two-way merge (A→B or B→A)
 * - Three-way merge (Base, A, B)
 * - Directional control
 */
// 删掉 getInvoke() 那段，改成顶部静态导入
import { invoke } from '@tauri-apps/api/core';
import React, { useState, useCallback, useEffect } from 'react';
import BlockSelector from './BlockSelector';
import ConflictResolver from './ConflictResolver';
import MergePreview from './MergePreview';
import './MergePanel.deep.css';

// Lazy-load Tauri invoke
let _invoke = null;
// async function getInvoke() {
//   if (_invoke) return _invoke;
//   try {
//     const mod = await import("@tauri-apps/api/core");
//     _invoke = mod.invoke;
//   } catch (e) {
//     console.error("Failed to load Tauri invoke:", e);
//     throw new Error("Tauri API not available");
//   }
//   return _invoke;
// }

const WORKFLOW_STEPS = {
  MODE: 'mode',             // Select merge mode (2-way / 3-way)
  INPUT: 'input',           // Select files/text to merge
  CONFLICTS: 'conflicts',   // Show conflicts
  SELECTIONS: 'selections', // User selects blocks
  PREVIEW: 'preview',       // Show merge preview
  COMPLETE: 'complete'      // Merge complete
};

const MERGE_MODES = {
  TWO_WAY: 'two-way',
  THREE_WAY: 'three-way',
  BIDIRECTIONAL: 'bidirectional'
};

const DIRECTIONS = {
  A_TO_B: 'a_to_b',
  B_TO_A: 'b_to_a'
};

/**
 * Enhanced MergePanel Component
 * 
 * Props:
 *   - sourceText: string - Initial source text
 *   - targetText: string - Initial target text
 *   - onMergeComplete: (result) => void - Callback when merge is complete
 */
export default function MergePanel({
  sourceText: initialSourceText = '',
  targetText: initialTargetText = '',
  onMergeComplete
}) {
  // Workflow state
  const [step, setStep] = useState(WORKFLOW_STEPS.INPUT);
  const [mergeMode, setMergeMode] = useState(MERGE_MODES.TWO_WAY);
  const [direction, setDirection] = useState(DIRECTIONS.A_TO_B);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Input state - Two-way merge
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [targetText, setTargetText] = useState(initialTargetText);

  // Input state - Three-way merge
  const [baseText, setBaseText] = useState('');

  // Diff/Merge state
  const [diffBlocks, setDiffBlocks] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [selections, setSelections] = useState([]);
  const [mergeResult, setMergeResult] = useState(null);

  // Initialize with provided texts
  useEffect(() => {
    if (initialSourceText && initialTargetText) {
      setSourceText(initialSourceText);
      setTargetText(initialTargetText);
    }
  }, [initialSourceText, initialTargetText]);

  // Step 1: Generate diff blocks
  const handleGenerateDiff = useCallback(async (source, target) => {
    try {
      setIsLoading(true);
      setError(null);

      // Call backend to generate diff
      // const invoke = await getInvoke();
      const blocks = await invoke('diff_text', {
        textA: source,
        textB: target
      });

      setSourceText(source);
      setTargetText(target);
      setDiffBlocks(blocks);
      setStep(WORKFLOW_STEPS.CONFLICTS);

      // Automatically detect conflicts
      if (mergeMode === MERGE_MODES.THREE_WAY) {
        handleDetectConflictsThreeWay(blocks);
      } else {
        handleDetectConflicts(blocks);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate diff');
    } finally {
      setIsLoading(false);
    }
  }, [mergeMode]);

  // Step 2a: Detect conflicts (Two-way)
  const handleDetectConflicts = useCallback(async (blocks) => {
    try {
      setIsLoading(true);
      setError(null);

      // const invoke = await getInvoke();
      const detectedConflicts = await invoke('detect_conflicts_text', {
        textA: sourceText,
        textB: targetText
      });

      setConflicts(detectedConflicts);

      if (detectedConflicts.length === 0) {
        const autoSelections = blocks.map((_, idx) => ({
          blockId: idx,
          action: 'apply',
          resolution: undefined
        }));
        setSelections(autoSelections);
        setStep(WORKFLOW_STEPS.PREVIEW);
        handleApplyMerge(autoSelections);
      } else {
        setStep(WORKFLOW_STEPS.SELECTIONS);
      }
    } catch (err) {
      setError(err.message || 'Failed to detect conflicts');
    } finally {
      setIsLoading(false);
    }
  }, [sourceText, targetText]);

  // Step 2b: Detect conflicts (Three-way)
  const handleDetectConflictsThreeWay = useCallback(async (blocks) => {
    try {
      setIsLoading(true);
      setError(null);

      // const invoke = await getInvoke();
      const detectedConflicts = await invoke('three_way_merge_detect_conflicts_text', {
        baseText: baseText,
        textA: sourceText,
        textB: targetText
      });

      setConflicts(detectedConflicts);

      if (detectedConflicts.length === 0) {
        const autoSelections = blocks.map((_, idx) => ({
          blockId: idx,
          action: 'apply',
          resolution: undefined
        }));
        setSelections(autoSelections);
        setStep(WORKFLOW_STEPS.PREVIEW);
        handleApplyMergeThreeWay(autoSelections);
      } else {
        setStep(WORKFLOW_STEPS.SELECTIONS);
      }
    } catch (err) {
      setError(err.message || 'Failed to detect conflicts');
    } finally {
      setIsLoading(false);
    }
  }, [baseText, sourceText, targetText]);

  // Step 3: Handle block selections
  const handleSelectionsChange = useCallback((newSelections) => {
    setSelections(newSelections);
  }, []);

  // Step 4: Handle conflict resolutions
  const handleConflictResolution = useCallback((blockId, resolution) => {
    setSelections(prev => {
      const existing = prev.findIndex(s => s.block_id === blockId);
      const updated = {
        blockId: blockId,
        action: 'apply',
        resolution
      };

      if (existing >= 0) {
        const newSelections = [...prev];
        newSelections[existing] = updated;
        return newSelections;
      } else {
        return [...prev, updated];
      }
    });
  }, []);

  // Step 5a: Apply merge (Two-way)
  const handleApplyMerge = useCallback(async (selectionsToApply = selections) => {
    try {
      setIsLoading(true);
      setError(null);

      // const invoke = await getInvoke();
      let result;
      if (mergeMode === MERGE_MODES.BIDIRECTIONAL) {
        // Use bidirectional apply with direction
        result = await invoke('apply_blocks_bidirectional_text', {
          req: {
            source_text: direction === DIRECTIONS.A_TO_B ? sourceText : targetText,
            target_text: direction === DIRECTIONS.A_TO_B ? targetText : sourceText,
            selections: selectionsToApply.map(s => ({ block_id: s.blockId ?? s.block_id, action: s.action, resolution: s.resolution })),
            direction
          }
        });
      } else {
        // Regular two-way apply
        result = await invoke('apply_blocks_text', {
          req: {
            source_text: sourceText,
            target_text: targetText,
            selections: selectionsToApply.map(s => ({ block_id: s.blockId ?? s.block_id, action: s.action, resolution: s.resolution }))
          }
        });
      }

      setMergeResult(result);
      setStep(WORKFLOW_STEPS.PREVIEW);
    } catch (err) {
      setError(err.message || 'Failed to apply merge');
    } finally {
      setIsLoading(false);
    }
  }, [sourceText, targetText, selections, direction, mergeMode]);

  // Step 5b: Apply merge (Three-way)
  const handleApplyMergeThreeWay = useCallback(async (selectionsToApply = selections) => {
    try {
      setIsLoading(true);
      setError(null);

      // const invoke = await getInvoke();
      
      // For three-way, use the regular apply (logic already in backend)
      const result = await invoke('apply_blocks_text', {
        req: {
          source_text: sourceText,
          target_text: targetText,
          selections: selectionsToApply.map(s => ({ block_id: s.blockId ?? s.block_id, action: s.action, resolution: s.resolution }))
        }
      });

      setMergeResult(result);
      setStep(WORKFLOW_STEPS.PREVIEW);
    } catch (err) {
      setError(err.message || 'Failed to apply merge');
    } finally {
      setIsLoading(false);
    }
  }, [sourceText, targetText, selections]);

  // Proceed to preview
  const handleProceedToPreview = useCallback(() => {
    if (mergeMode === MERGE_MODES.THREE_WAY) {
      handleApplyMergeThreeWay();
    } else {
      handleApplyMerge();
    }
  }, [handleApplyMerge, handleApplyMergeThreeWay, mergeMode]);

  // Complete merge
  const handleCompleteMerge = useCallback(() => {
    setStep(WORKFLOW_STEPS.COMPLETE);
    if (onMergeComplete) {
      onMergeComplete(mergeResult);
    }
  }, [mergeResult, onMergeComplete]);

  // Cancel/Reset
  const handleCancel = useCallback(() => {
    setStep(WORKFLOW_STEPS.INPUT);
    setSourceText('');
    setTargetText('');
    setBaseText('');
    setDiffBlocks([]);
    setConflicts([]);
    setSelections([]);
    setMergeResult(null);
    setError(null);
  }, []);

  // Render mode selection
  const renderModeSelection = () => (
    <div className="step-mode">
      <h2>选择合并模式</h2>
      <div className="mode-selector">
        <button
          className={`mode-btn ${mergeMode === MERGE_MODES.TWO_WAY ? 'active' : ''}`}
          onClick={() => {
            setMergeMode(MERGE_MODES.TWO_WAY);
            setStep(WORKFLOW_STEPS.INPUT);
          }}
        >
          <span className="icon">↔</span>
          <span>两路合并</span>
          <span className="desc">A ↔ B</span>
        </button>

        <button
          className={`mode-btn ${mergeMode === MERGE_MODES.THREE_WAY ? 'active' : ''}`}
          onClick={() => {
            setMergeMode(MERGE_MODES.THREE_WAY);
            setStep(WORKFLOW_STEPS.INPUT);
          }}
        >
          <span className="icon">⊕</span>
          <span>三路合并</span>
          <span className="desc">Base + A + B</span>
        </button>

        <button
          className={`mode-btn ${mergeMode === MERGE_MODES.BIDIRECTIONAL ? 'active' : ''}`}
          onClick={() => {
            setMergeMode(MERGE_MODES.BIDIRECTIONAL);
            setStep(WORKFLOW_STEPS.INPUT);
          }}
        >
          <span className="icon">⇄</span>
          <span>双向合并</span>
          <span className="desc">A → B 或 B → A</span>
        </button>
      </div>
    </div>
  );

  // Render input step
  const renderInputStep = () => {
    const isReadyForTwoWay = sourceText && targetText;
    const isReadyForThreeWay = baseText && sourceText && targetText;
    const isReady =
      mergeMode === MERGE_MODES.THREE_WAY
        ? isReadyForThreeWay
        : isReadyForTwoWay;

    return (
      <div className="step-input">
        <div className="input-header">
          <h2>
            {mergeMode === MERGE_MODES.THREE_WAY
              ? '输入三个版本'
              : mergeMode === MERGE_MODES.BIDIRECTIONAL
              ? '输入两个版本（选择方向）'
              : '输入两个版本'}
          </h2>
          <button className="mode-switch-btn" onClick={() => setStep(WORKFLOW_STEPS.MODE)}>
            切换模式
          </button>
        </div>

        <div className="input-container">
          {mergeMode === MERGE_MODES.THREE_WAY && (
            <div className="input-group">
              <label>基础版本 (Base)</label>
              <textarea
                value={baseText}
                onChange={(e) => setBaseText(e.target.value)}
                placeholder="输入基础版本文本..."
                rows="8"
              />
            </div>
          )}

          <div className="input-group">
            <label>版本 A {mergeMode === MERGE_MODES.BIDIRECTIONAL && '(源)'}</label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="输入版本 A 文本..."
              rows="8"
            />
          </div>

          <div className="input-group">
            <label>版本 B {mergeMode === MERGE_MODES.BIDIRECTIONAL && '(目标)'}</label>
            <textarea
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="输入版本 B 文本..."
              rows="8"
            />
          </div>
        </div>

        {mergeMode === MERGE_MODES.BIDIRECTIONAL && (
          <div className="direction-selector">
            <label>应用方向:</label>
            <button
              className={`direction-btn ${direction === DIRECTIONS.A_TO_B ? 'active' : ''}`}
              onClick={() => setDirection(DIRECTIONS.A_TO_B)}
            >
              A → B (A 应用到 B)
            </button>
            <button
              className={`direction-btn ${direction === DIRECTIONS.B_TO_A ? 'active' : ''}`}
              onClick={() => setDirection(DIRECTIONS.B_TO_A)}
            >
              B → A (B 应用到 A)
            </button>
          </div>
        )}

        <div className="button-group">
          <button
            className="btn-primary"
            onClick={() => handleGenerateDiff(sourceText, targetText)}
            disabled={!isReady || isLoading}
          >
            {isLoading ? '处理中...' : '开始比较'}
          </button>
          <button className="btn-secondary" onClick={handleCancel}>
            取消
          </button>
        </div>
      </div>
    );
  };

  // Render based on current step
  const renderStep = () => {
    switch (step) {
      case WORKFLOW_STEPS.MODE:
        return renderModeSelection();
      case WORKFLOW_STEPS.INPUT:
        return renderInputStep();
      case WORKFLOW_STEPS.CONFLICTS:
        return (
          <div className="step-conflicts">
            <h2>检测冲突中...</h2>
            <p>正在分析差异和冲突...</p>
          </div>
        );
      case WORKFLOW_STEPS.SELECTIONS:
        return (
          <div className="step-selections">
            <div className="selections-container">
              <BlockSelector
                blocks={diffBlocks}
                conflicts={conflicts}
                onSelectionsChange={handleSelectionsChange}
                sourceText={sourceText}
                targetText={targetText}
              />
              {conflicts.length > 0 && (
                <ConflictResolver
                  conflicts={conflicts}
                  onResolutionChange={handleConflictResolution}
                  sourceText={sourceText}
                  targetText={targetText}
                />
              )}
            </div>
            <div className="button-group">
              <button
                className="btn-primary"
                onClick={handleProceedToPreview}
                disabled={isLoading}
              >
                预览合并结果
              </button>
              <button className="btn-secondary" onClick={() => setStep(WORKFLOW_STEPS.INPUT)}>
                返回
              </button>
            </div>
          </div>
        );
      case WORKFLOW_STEPS.PREVIEW:
        return (
          <div className="step-preview">
            {mergeResult && (
              <MergePreview
                result={mergeResult}
                isLoading={isLoading}
                error={error}
                onApplyMerge={handleCompleteMerge}
                onCancelMerge={() => setStep(WORKFLOW_STEPS.SELECTIONS)}
              />
            )}
          </div>
        );
      case WORKFLOW_STEPS.COMPLETE:
        return (
          <div className="step-complete">
            <h2>✓ 合并完成！</h2>
            {mergeResult && (
              <div className="complete-info">
                <p>成功率: {((mergeResult.applied_count / mergeResult.total_blocks) * 100).toFixed(1)}%</p>
                <p>应用: {mergeResult.applied_count} 块</p>
                {mergeResult.conflict_count > 0 && (
                  <p>未解决冲突: {mergeResult.conflict_count}</p>
                )}
              </div>
            )}
            <div className="button-group">
              <button className="btn-primary" onClick={handleCancel}>
                新建合并
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="merge-panel">
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {isLoading && <div className="loading-overlay">处理中...</div>}

      {renderStep()}
    </div>
  );
}
