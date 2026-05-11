/**
 * v0.8 P2: Merge Panel Main Container
 * Orchestrates the complete merge workflow:
 * 1. Load texts
 * 2. Generate diff blocks
 * 3. Detect conflicts
 * 4. User selections (BlockSelector)
 * 5. Conflict resolution (ConflictResolver)
 * 6. Apply merge (MergePreview)
 * 
 * DEPRECATED: Use MergePanel.deep.jsx instead
 */

import React, { useState, useCallback, useEffect } from 'react';
import BlockSelector from './BlockSelector';
import ConflictResolver from './ConflictResolver';
import MergePreview from './MergePreview';
import './MergePanel.css';

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
  INPUT: 'input',           // Select files/text to merge
  CONFLICTS: 'conflicts',   // Show conflicts
  SELECTIONS: 'selections', // User selects blocks
  PREVIEW: 'preview',       // Show merge preview
  COMPLETE: 'complete'      // Merge complete
};

/**
 * MergePanel Component
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Input state
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [targetText, setTargetText] = useState(initialTargetText);

  // Diff/Merge state
  const [diffBlocks, setDiffBlocks] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [selections, setSelections] = useState([]);
  const [mergeResult, setMergeResult] = useState(null);

  // Initialize with provided texts
  useEffect(() => {
    if (initialSourceText && initialTargetText) {
      handleGenerateDiff(initialSourceText, initialTargetText);
    }
  }, [initialSourceText, initialTargetText]);

  // Step 1: Generate diff blocks
  const handleGenerateDiff = useCallback(async (source, target) => {
    try {
      setIsLoading(true);
      setError(null);

      // Call backend to generate diff
      const invoke = await getInvoke();
      const blocks = await invoke('diff_text', {
        text_a: source,
        text_b: target
      });

      setSourceText(source);
      setTargetText(target);
      setDiffBlocks(blocks);
      setStep(WORKFLOW_STEPS.CONFLICTS);

      // Automatically detect conflicts
      handleDetectConflicts(blocks);
    } catch (err) {
      setError(err.message || 'Failed to generate diff');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Step 2: Detect conflicts
  const handleDetectConflicts = useCallback(async (blocks) => {
    try {
      setIsLoading(true);
      setError(null);

      const invoke = await getInvoke();
      const detectedConflicts = await invoke('detect_conflicts_text', {
        text_a: sourceText,
        text_b: targetText
      });

      setConflicts(detectedConflicts);

      // If no conflicts, skip to preview
      if (detectedConflicts.length === 0) {
        // Auto-select all blocks to apply
        const autoSelections = blocks.map((_, idx) => ({
          block_id: idx,
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

  // Step 3: Handle block selections
  const handleSelectionsChange = useCallback((newSelections) => {
    setSelections(newSelections);
  }, []);

  // Step 4: Handle conflict resolutions
  const handleConflictResolution = useCallback((blockId, resolution) => {
    setSelections(prev => {
      const existing = prev.findIndex(s => s.block_id === blockId);
      const updated = {
        block_id: blockId,
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

  // Step 5: Apply merge
  const handleApplyMerge = useCallback(async (selectionsToApply = selections) => {
    try {
      setIsLoading(true);
      setError(null);

      const invoke = await getInvoke();
      const req = {
        source_text: sourceText,
        target_text: targetText,
        selections: selectionsToApply
      };

      const result = await invoke('apply_blocks_text', { req });
      
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
    handleApplyMerge();
  }, [handleApplyMerge]);

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
    setDiffBlocks([]);
    setConflicts([]);
    setSelections([]);
    setMergeResult(null);
    setError(null);
  }, []);

  // Render based on current step
  const renderStep = () => {
    switch (step) {
      case WORKFLOW_STEPS.INPUT:
        return (
          <div className="step-input">
            <h3>选择合并方式</h3>
            <div className="input-options">
              <div className="option-group">
                <label htmlFor="source-input">源文本 (A 版本):</label>
                <textarea
                  id="source-input"
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="输入或粘贴源文本..."
                  rows="8"
                />
              </div>

              <div className="option-group">
                <label htmlFor="target-input">目标文本 (B 版本):</label>
                <textarea
                  id="target-input"
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  placeholder="输入或粘贴目标文本..."
                  rows="8"
                />
              </div>

              <div className="input-actions">
                <button
                  className="btn-start"
                  onClick={() => handleGenerateDiff(sourceText, targetText)}
                  disabled={!sourceText.trim() || !targetText.trim()}
                >
                  开始对比 →
                </button>
              </div>
            </div>
          </div>
        );

      case WORKFLOW_STEPS.CONFLICTS:
        return (
          <div className="step-conflicts">
            <h3>已检测到 {conflicts.length} 个冲突</h3>
            {conflicts.length > 0 ? (
              <p className="step-hint">请选择如何解决这些冲突</p>
            ) : (
              <p className="step-hint">没有冲突，可以进行合并</p>
            )}
          </div>
        );

      case WORKFLOW_STEPS.SELECTIONS:
        return (
          <div className="step-selections">
            <div className="selectors-container">
              <div className="selector-panel">
                <h3>差异块选择</h3>
                <BlockSelector
                  blocks={diffBlocks}
                  conflicts={conflicts}
                  onSelectionsChange={handleSelectionsChange}
                  sourceText={sourceText}
                  targetText={targetText}
                />
              </div>

              {conflicts.length > 0 && (
                <div className="resolver-panel">
                  <h3>冲突解决</h3>
                  <ConflictResolver
                    conflicts={conflicts}
                    onResolutionChange={handleConflictResolution}
                    sourceText={sourceText}
                    targetText={targetText}
                  />
                </div>
              )}
            </div>

            <div className="selections-actions">
              <button className="btn-back" onClick={handleCancel}>
                ← 返回
              </button>
              <button
                className="btn-preview"
                onClick={handleProceedToPreview}
                disabled={selections.length === 0}
              >
                查看预览 →
              </button>
            </div>
          </div>
        );

      case WORKFLOW_STEPS.PREVIEW:
        return (
          <div className="step-preview">
            <MergePreview
              result={mergeResult}
              isLoading={isLoading}
              error={error}
              onApplyMerge={handleCompleteMerge}
              onCancelMerge={() => setStep(WORKFLOW_STEPS.SELECTIONS)}
            />
          </div>
        );

      case WORKFLOW_STEPS.COMPLETE:
        return (
          <div className="step-complete">
            <div className="complete-message">
              <div className="complete-icon">✓</div>
              <h3>合并完成!</h3>
              <p>已成功生成合并后的文本</p>
              <p className="merged-content-preview">
                {mergeResult?.merged_text.split('\n').slice(0, 3).join('\n')}
                {mergeResult?.merged_text.split('\n').length > 3 && '...'}
              </p>
              <button className="btn-new-merge" onClick={handleCancel}>
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
      {/* Error Message */}
      {error && (
        <div className="error-banner">
          <span className="error-close" onClick={() => setError(null)}>×</span>
          <strong>错误:</strong> {error}
        </div>
      )}

      {/* Progress Indicator */}
      <div className="progress-indicator">
        <div className={`step-dot ${step === WORKFLOW_STEPS.INPUT ? 'active' : 'completed'}`}>1</div>
        <div className="step-line" />
        <div className={`step-dot ${step === WORKFLOW_STEPS.CONFLICTS ? 'active' : step === WORKFLOW_STEPS.SELECTIONS || step === WORKFLOW_STEPS.PREVIEW || step === WORKFLOW_STEPS.COMPLETE ? 'completed' : ''}`}>2</div>
        <div className="step-line" />
        <div className={`step-dot ${step === WORKFLOW_STEPS.SELECTIONS ? 'active' : step === WORKFLOW_STEPS.PREVIEW || step === WORKFLOW_STEPS.COMPLETE ? 'completed' : ''}`}>3</div>
        <div className="step-line" />
        <div className={`step-dot ${step === WORKFLOW_STEPS.PREVIEW ? 'active' : step === WORKFLOW_STEPS.COMPLETE ? 'completed' : ''}`}>4</div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>处理中...</p>
        </div>
      )}

      {/* Step Content */}
      <div className="step-content">
        {renderStep()}
      </div>
    </div>
  );
}
