import { useState, useCallback, useRef } from 'react';
import type { StudyMetadata } from '../dicom/types';
import type { SelectionPlan, SeriesSelection, ChatMessage, ProviderConfig, ViewportContext } from './types';
import { createLLMService } from './LLMServiceFactory';
import { selectSlicesForSelection } from '../filtering/SliceSelector';
import { exportSlicesToJpeg } from '../filtering/SliceExporter';
import { logger } from '../utils/logger';

export type ChatStatus = 'idle' | 'planning' | 'awaiting-confirmation' | 'exporting' | 'analyzing' | 'following-up' | 'error';

export interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
  durationMs?: number;
}

export interface SliceMapping {
  imageIndex: number;   // 1-based position in the selected subset
  instanceNumber: number;
  imageId: string;
  zPosition: number;
  label: string;        // e.g. "SAG PD FAT SAT — Slice 45/187 (z=-120mm)"
  seriesNumber: string; // Series number for navigation
}

export interface PipelineState {
  steps: PipelineStep[];
  plan: SelectionPlan | null;
  sliceCount: number;
  totalSlices: number;
  exportedSizes: string[];
  sliceMappings: SliceMapping[];
}

interface UseLLMChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  currentPlan: SelectionPlan | null;
  pipeline: PipelineState | null;
  startAnalysis: (hint: string, viewportContext?: ViewportContext) => Promise<void>;
  confirmPlan: (adjustedPlan: SelectionPlan) => Promise<void>;
  cancelPlan: () => void;
  sendFollowUp: (text: string) => Promise<void>;
  clearChat: () => void;
}

const STATUS_LABELS: Record<ChatStatus, string> = {
  idle: '',
  planning: 'Analyzing metadata...',
  'awaiting-confirmation': 'Review selection plan...',
  exporting: 'Preparing images...',
  analyzing: 'Generating analysis...',
  'following-up': 'Thinking...',
  error: 'Error',
};

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function updateStep(
  steps: PipelineStep[],
  id: string,
  updates: Partial<PipelineStep>,
): PipelineStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...updates } : s));
}

/**
 * Fix a single SeriesSelection against its series metadata.
 */
function fixSelection(sel: SeriesSelection, metadata: StudyMetadata, maxBudget: number): SeriesSelection {
  const series = metadata.series.find((s) => String(s.seriesNumber) === sel.seriesNumber);
  if (!series) return sel;

  const [minInst, maxInst] = series.instanceNumberRange;
  let [start, end] = sel.sliceRange;

  if (start > end) [start, end] = [end, start];
  start = Math.max(minInst, start);
  end = Math.min(maxInst, end);

  let { samplingStrategy, samplingParam } = sel;
  const rangeSize = end - start + 1;

  if (samplingStrategy === 'all' && rangeSize > maxBudget) {
    samplingStrategy = 'uniform';
    samplingParam = maxBudget;
    logger.warn(`[PlanFix] "${sel.seriesNumber}" "all" on ${rangeSize} slices → uniform(${maxBudget})`);
  }

  if (samplingStrategy === 'uniform' && (samplingParam == null || samplingParam < 1)) {
    samplingParam = Math.min(maxBudget, rangeSize);
    logger.warn(`[PlanFix] "${sel.seriesNumber}" missing samplingParam → ${samplingParam}`);
  }

  if (samplingStrategy === 'uniform' && samplingParam != null && samplingParam > rangeSize) {
    samplingParam = rangeSize;
  }

  if (samplingStrategy === 'uniform' && samplingParam != null && samplingParam > maxBudget) {
    samplingParam = maxBudget;
  }

  if (start !== sel.sliceRange[0] || end !== sel.sliceRange[1]) {
    logger.warn(`[PlanFix] "${sel.seriesNumber}" clamped: [${sel.sliceRange}] → [${start},${end}]`);
  }

  return { ...sel, sliceRange: [start, end], samplingStrategy, samplingParam };
}

/**
 * Estimate the number of slices a selection will produce.
 */
function estimateSliceCount(sel: SeriesSelection): number {
  const rangeSize = sel.sliceRange[1] - sel.sliceRange[0] + 1;
  if (sel.samplingStrategy === 'uniform' && sel.samplingParam != null) {
    return Math.min(sel.samplingParam, rangeSize);
  }
  if (sel.samplingStrategy === 'every_nth' && sel.samplingParam != null && sel.samplingParam > 0) {
    return Math.ceil(rangeSize / sel.samplingParam);
  }
  return rangeSize;
}

/**
 * Fix all selections in a plan. Enforce total ≤ 20 (reduce supplementary first).
 * Re-populate legacy fields from selections[0].
 */
function fixSelectionPlan(plan: SelectionPlan, metadata: StudyMetadata): SelectionPlan {
  const MAX_TOTAL = 20;

  // Fix each selection individually with generous per-selection budget first
  let fixedSelections = plan.selections.map((sel) =>
    fixSelection(sel, metadata, MAX_TOTAL),
  );

  // Enforce total ≤ 20: reduce supplementary series first, then primary
  let total = fixedSelections.reduce((sum, s) => sum + estimateSliceCount(s), 0);
  if (total > MAX_TOTAL) {
    // Reduce supplementary selections first (in reverse order)
    for (let i = fixedSelections.length - 1; i >= 0 && total > MAX_TOTAL; i--) {
      if (fixedSelections[i].role !== 'supplementary') continue;
      const current = estimateSliceCount(fixedSelections[i]);
      const excess = total - MAX_TOTAL;
      const newCount = Math.max(2, current - excess);
      fixedSelections[i] = {
        ...fixedSelections[i],
        samplingStrategy: 'uniform',
        samplingParam: newCount,
      };
      total = fixedSelections.reduce((sum, s) => sum + estimateSliceCount(s), 0);
      logger.warn(`[PlanFix] Reduced supplementary series #${fixedSelections[i].seriesNumber} to ${newCount} slices`);
    }

    // If still over, remove supplementary selections entirely
    if (total > MAX_TOTAL) {
      const primaryOnly = fixedSelections.filter((s) => s.role === 'primary');
      if (primaryOnly.length > 0) {
        fixedSelections = primaryOnly;
        total = fixedSelections.reduce((sum, s) => sum + estimateSliceCount(s), 0);
        logger.warn('[PlanFix] Removed all supplementary selections to fit budget');
      }
    }

    // If primary alone exceeds, cap it
    if (total > MAX_TOTAL && fixedSelections.length > 0) {
      fixedSelections[0] = {
        ...fixedSelections[0],
        samplingStrategy: 'uniform',
        samplingParam: MAX_TOTAL,
      };
      logger.warn(`[PlanFix] Capped primary to ${MAX_TOTAL} slices`);
    }
  }

  // Re-populate legacy fields from selections[0]
  const primary = fixedSelections[0];
  return {
    ...plan,
    selections: fixedSelections,
    totalImages: fixedSelections.reduce((sum, s) => sum + estimateSliceCount(s), 0),
    targetSeries: primary.seriesNumber,
    sliceRange: primary.sliceRange,
    windowCenter: primary.windowCenter,
    windowWidth: primary.windowWidth,
    samplingStrategy: primary.samplingStrategy,
    samplingParam: primary.samplingParam,
  };
}

export function useLLMChat(
  metadata: StudyMetadata | null,
  providerConfig: ProviderConfig,
): UseLLMChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SelectionPlan | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const abortRef = useRef(false);
  const hintRef = useRef<string>('');
  const planTimingRef = useRef<{ t0: number; t1: number }>({ t0: 0, t1: 0 });

  const startAnalysis = useCallback(async (hint: string, viewportContext?: ViewportContext) => {
    if (!metadata) return;
    abortRef.current = false;
    setError(null);

    // Initialize pipeline
    const textModel = providerConfig.provider === 'ollama' ? (providerConfig.ollamaTextModel || 'alibayram/medgemma:4b') : 'claude';
    const visionModel = providerConfig.provider === 'ollama' ? (providerConfig.ollamaVisionModel || 'llava:7b') : 'claude';
    const initialSteps: PipelineStep[] = [
      { id: 'plan', label: `Selection planning (${textModel})`, status: 'pending' },
      { id: 'select', label: 'Selecting slices', status: 'pending' },
      { id: 'export', label: 'Exporting images', status: 'pending' },
      { id: 'analyze', label: `Analyzing images (${visionModel})`, status: 'pending' },
    ];
    setPipeline({ steps: initialSteps, plan: null, sliceCount: 0, totalSlices: 0, exportedSizes: [], sliceMappings: [] });

    const userMsg: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: hint,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const service = createLLMService(providerConfig);

      // Step 1: Selection planning
      setStatus('planning');
      const t0 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'plan', { status: 'active', detail: 'Sending metadata to LLM...' }),
      }));

      logger.group('[DICOMassist] Analysis Pipeline');
      logger.log('Clinical hint:', hint);
      logger.log('Study metadata:', {
        study: metadata.studyDescription,
        modality: metadata.modality,
        series: metadata.series.map((s) => ({
          '#': s.seriesNumber,
          desc: s.seriesDescription,
          plane: s.anatomicalPlane,
          slices: s.slices.length,
        })),
      });

      const rawPlan = await service.getSelectionPlan(metadata, hint, viewportContext);
      const t1 = performance.now();
      if (abortRef.current) { logger.groupEnd(); return; }

      logger.log('Call 1 — Raw plan:', rawPlan);
      const plan = fixSelectionPlan(rawPlan, metadata);
      if (plan.sliceRange[0] !== rawPlan.sliceRange[0] || plan.sliceRange[1] !== rawPlan.sliceRange[1]) {
        logger.log('Plan fixed:', `[${rawPlan.sliceRange}] → [${plan.sliceRange}]`);
      }

      setCurrentPlan(plan);
      const planDetail = `Series #${plan.targetSeries}, instances ${plan.sliceRange[0]}–${plan.sliceRange[1]}, W:${plan.windowWidth} C:${plan.windowCenter}`;
      setPipeline((p) => p && ({
        ...p,
        plan,
        steps: updateStep(p.steps, 'plan', {
          status: 'done',
          detail: planDetail,
          durationMs: Math.round(t1 - t0),
        }),
      }));

      // Store context for continuation after user confirms
      hintRef.current = hint;
      planTimingRef.current = { t0, t1 };
      setStatus('awaiting-confirmation');
      logger.log('Awaiting user confirmation of selection plan');
      logger.groupEnd();
    } catch (err) {
      logger.groupEnd();
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig]);

  const confirmPlan = useCallback(async (adjustedPlan: SelectionPlan) => {
    if (!metadata) return;
    abortRef.current = false;
    setError(null);

    const hint = hintRef.current;

    // Update plan and pipeline with adjusted values
    setCurrentPlan(adjustedPlan);
    const planDetail = `Series #${adjustedPlan.targetSeries}, instances ${adjustedPlan.sliceRange[0]}–${adjustedPlan.sliceRange[1]}, W:${adjustedPlan.windowWidth} C:${adjustedPlan.windowCenter}`;
    setPipeline((p) => p && ({
      ...p,
      plan: adjustedPlan,
      steps: updateStep(p.steps, 'plan', {
        status: 'done',
        detail: planDetail,
        durationMs: Math.round(planTimingRef.current.t1 - planTimingRef.current.t0),
      }),
    }));

    try {
      const service = createLLMService(providerConfig);

      logger.group('[DICOMassist] Analysis Pipeline (continued)');
      logger.log('Confirmed plan:', adjustedPlan);

      // Step 2: Select slices across all series
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'select', { status: 'active', detail: `Selecting from ${adjustedPlan.selections.length} series...` }),
      }));

      const allMappings: SliceMapping[] = [];
      const allBlobs: Blob[] = [];
      let totalSelectedCount = 0;
      let grandTotalSlices = 0;

      // Step 3: Export to JPEG (per-selection with per-selection W/L)
      setStatus('exporting');
      const t2 = performance.now();

      for (const sel of adjustedPlan.selections) {
        const selectedSlices = selectSlicesForSelection(metadata, sel);
        logger.log(`[${sel.role}] Series #${sel.seriesNumber}: selected ${selectedSlices.length} slices`);

        if (selectedSlices.length === 0) continue;

        const series = metadata.series.find((s) => String(s.seriesNumber) === sel.seriesNumber);
        const totalSlicesInSeries = series?.slices.length ?? selectedSlices.length;
        const seriesDesc = series?.seriesDescription || `Series #${sel.seriesNumber}`;
        const axisLetter = series?.anatomicalPlane === 'sagittal' ? 'x'
          : series?.anatomicalPlane === 'coronal' ? 'y' : 'z';

        totalSelectedCount += selectedSlices.length;
        grandTotalSlices += totalSlicesInSeries;

        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'export', { status: 'active', detail: `Rendering Series #${sel.seriesNumber} (${selectedSlices.length} slices, W:${sel.windowWidth} C:${sel.windowCenter})...` }),
        }));

        const exported = await exportSlicesToJpeg(selectedSlices, sel.windowCenter, sel.windowWidth);
        if (abortRef.current) { logger.groupEnd(); return; }

        for (const e of exported) {
          const globalIdx = allBlobs.length + 1;
          allBlobs.push(e.blob);
          allMappings.push({
            imageIndex: globalIdx,
            instanceNumber: e.instanceNumber,
            imageId: selectedSlices.find((s) => s.instanceNumber === e.instanceNumber)?.imageId ?? '',
            zPosition: e.zPosition,
            label: `${seriesDesc} — Slice ${e.instanceNumber}/${totalSlicesInSeries} (${axisLetter}=${e.zPosition.toFixed(0)}mm)`,
            seriesNumber: sel.seriesNumber,
          });
        }

        if (exported.length < selectedSlices.length) {
          logger.warn(`[Export] Series #${sel.seriesNumber}: ${selectedSlices.length - exported.length} slices failed to render`);
        }
      }

      const t3 = performance.now();

      if (allBlobs.length === 0) {
        logger.groupEnd();
        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'select', { status: 'error', detail: 'No slices matched' }),
        }));
        throw new Error('No slices matched the selection plan. Try a different prompt.');
      }

      const sliceDetail = `${totalSelectedCount} slices from ${adjustedPlan.selections.length} series`;
      setPipeline((p) => p && ({
        ...p,
        sliceCount: totalSelectedCount,
        totalSlices: grandTotalSlices,
        steps: updateStep(p.steps, 'select', { status: 'done', detail: sliceDetail }),
      }));

      const sizes = allBlobs.map((b) => `${(b.size / 1024).toFixed(0)}KB`);
      const totalSize = allBlobs.reduce((sum, b) => sum + b.size, 0);
      logger.log(`Exported ${allBlobs.length} JPEG images (sizes: ${sizes.join(', ')})`);
      logger.log('Slice mappings:', allMappings.map((m) => m.label));

      setPipeline((p) => p && ({
        ...p,
        exportedSizes: sizes,
        sliceMappings: allMappings,
        steps: updateStep(p.steps, 'export', {
          status: 'done',
          detail: `${allBlobs.length} images (${(totalSize / 1024).toFixed(0)}KB total)`,
          durationMs: Math.round(t3 - t2),
        }),
      }));

      // Step 4: Analyze
      setStatus('analyzing');
      const t4 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', { status: 'active', detail: `Sending ${allBlobs.length} images to LLM...` }),
      }));

      const sliceLabels = allMappings.map((m) => m.label);
      logger.log(`Call 2 — Sending ${allBlobs.length} images to LLM (${sliceLabels.join(', ')})...`);
      const analysisText = await service.analyzeSlices(allBlobs, metadata, hint, adjustedPlan, sliceLabels);
      const t5 = performance.now();
      if (abortRef.current) { logger.groupEnd(); return; }

      logger.log('Call 2 — Analysis response:', analysisText.slice(0, 200) + '...');
      logger.groupEnd();

      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', {
          status: 'done',
          detail: `Response received`,
          durationMs: Math.round(t5 - t4),
        }),
      }));

      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: analysisText,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStatus('idle');
    } catch (err) {
      logger.groupEnd();
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig]);

  const cancelPlan = useCallback(() => {
    abortRef.current = true;
    setStatus('idle');
    setCurrentPlan(null);
    setPipeline(null);
    // Remove the last user message (the hint that was added)
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'user') return prev.slice(0, -1);
      return prev;
    });
  }, []);

  const sendFollowUp = useCallback(async (text: string) => {
    if (!metadata) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      const service = createLLMService(providerConfig);
      setStatus('following-up');

      const response = await service.sendFollowUp(updatedMessages, metadata);

      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStatus('idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig, messages]);

  const clearChat = useCallback(() => {
    abortRef.current = true;
    setMessages([]);
    setStatus('idle');
    setError(null);
    setCurrentPlan(null);
    setPipeline(null);
  }, []);

  return {
    messages,
    status,
    statusText: STATUS_LABELS[status],
    error,
    currentPlan,
    pipeline,
    startAnalysis,
    confirmPlan,
    cancelPlan,
    sendFollowUp,
    clearChat,
  };
}
