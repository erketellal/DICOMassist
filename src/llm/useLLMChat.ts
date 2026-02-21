import { useState, useCallback, useRef } from 'react';
import type { StudyMetadata } from '../dicom/types';
import type { SelectionPlan, ChatMessage, ProviderConfig, ViewportContext } from './types';
import { createLLMService } from './LLMServiceFactory';
import { selectSlices } from '../filtering/SliceSelector';
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

const MIN_SLICES_IN_RANGE = 40; // Minimum instance range to ensure decent coverage

/**
 * Fix common LLM planning mistakes:
 * - Single-slice range (e.g., [128, 128]) → expand to ±50 around center
 * - Too-narrow range → expand to at least MIN_SLICES_IN_RANGE
 * - Missing samplingParam for uniform → default to 15
 * - "all" strategy on large ranges → switch to uniform
 */
function fixSelectionPlan(plan: SelectionPlan, metadata: StudyMetadata): SelectionPlan {
  const series = metadata.series.find((s) => String(s.seriesNumber) === plan.targetSeries);
  if (!series) return plan;

  const [minInst, maxInst] = series.instanceNumberRange;
  let [rangeStart, rangeEnd] = plan.sliceRange;
  const rangeSize = rangeEnd - rangeStart + 1;

  // Fix: single slice or tiny range → expand around center
  if (rangeSize < MIN_SLICES_IN_RANGE) {
    const center = Math.round((rangeStart + rangeEnd) / 2);
    const halfRange = Math.round(MIN_SLICES_IN_RANGE / 2);
    rangeStart = Math.max(minInst, center - halfRange);
    rangeEnd = Math.min(maxInst, center + halfRange);
    logger.warn(`[PlanFix] Range too narrow (${plan.sliceRange[0]}–${plan.sliceRange[1]}), expanded to ${rangeStart}–${rangeEnd}`);
  }

  // Fix: "all" on a large range → switch to uniform
  let { samplingStrategy, samplingParam } = plan;
  const newRangeSize = rangeEnd - rangeStart + 1;
  if (samplingStrategy === 'all' && newRangeSize > 20) {
    samplingStrategy = 'uniform';
    samplingParam = 15;
    logger.warn(`[PlanFix] "all" on ${newRangeSize} slices → switched to uniform(15)`);
  }

  // Fix: uniform without param → default to 15
  if (samplingStrategy === 'uniform' && (samplingParam == null || samplingParam < 1)) {
    samplingParam = 15;
    logger.warn('[PlanFix] Missing samplingParam for uniform, defaulting to 15');
  }

  return {
    ...plan,
    sliceRange: [rangeStart, rangeEnd],
    samplingStrategy,
    samplingParam,
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

      // Step 2: Select slices
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'select', { status: 'active', detail: `Applying ${adjustedPlan.samplingStrategy} strategy...` }),
      }));
      const selectedSlices = selectSlices(metadata, adjustedPlan);
      logger.log(`Selected ${selectedSlices.length} slices:`, selectedSlices.map((s) => ({
        instance: s.instanceNumber,
        z: s.zPosition.toFixed(1),
      })));

      if (selectedSlices.length === 0) {
        logger.groupEnd();
        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'select', { status: 'error', detail: 'No slices matched' }),
        }));
        throw new Error('No slices matched the selection plan. Try a different prompt.');
      }

      const targetSeries = metadata.series.find((s) => String(s.seriesNumber) === adjustedPlan.targetSeries);
      const totalSlices = targetSeries?.slices.length ?? selectedSlices.length;
      const seriesDesc = targetSeries?.seriesDescription || `Series #${adjustedPlan.targetSeries}`;
      const axisLetter = targetSeries?.anatomicalPlane === 'sagittal' ? 'x'
        : targetSeries?.anatomicalPlane === 'coronal' ? 'y' : 'z';
      const sliceDetail = `${selectedSlices.length} slices (${axisLetter}: ${selectedSlices[0].zPosition.toFixed(0)} to ${selectedSlices[selectedSlices.length - 1].zPosition.toFixed(0)}mm)`;

      setPipeline((p) => p && ({
        ...p,
        sliceCount: selectedSlices.length,
        totalSlices,
        steps: updateStep(p.steps, 'select', { status: 'done', detail: sliceDetail }),
      }));

      // Step 3: Export to JPEG
      setStatus('exporting');
      const t2 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'export', { status: 'active', detail: `Rendering ${selectedSlices.length} slices with W:${adjustedPlan.windowWidth} C:${adjustedPlan.windowCenter}...` }),
      }));

      const exported = await exportSlicesToJpeg(selectedSlices, adjustedPlan.windowCenter, adjustedPlan.windowWidth);
      const t3 = performance.now();
      if (abortRef.current) { logger.groupEnd(); return; }

      // Build mappings from EXPORTED results (not selectedSlices) to stay in sync
      // If any image fails to render, it's excluded from both blobs and labels
      const mappings: SliceMapping[] = exported.map((e, i) => ({
        imageIndex: i + 1,
        instanceNumber: e.instanceNumber,
        imageId: selectedSlices.find((s) => s.instanceNumber === e.instanceNumber)?.imageId ?? '',
        zPosition: e.zPosition,
        label: `${seriesDesc} — Slice ${e.instanceNumber}/${totalSlices} (${axisLetter}=${e.zPosition.toFixed(0)}mm)`,
      }));

      const sizes = exported.map((e) => `${(e.blob.size / 1024).toFixed(0)}KB`);
      const totalSize = exported.reduce((sum, e) => sum + e.blob.size, 0);
      logger.log(`Exported ${exported.length} JPEG images (sizes: ${sizes.join(', ')})`);
      logger.log('Slice mappings:', mappings.map((m) => `${m.label}`));

      if (exported.length < selectedSlices.length) {
        logger.warn(`[Export] ${selectedSlices.length - exported.length} slices failed to render — labels rebuilt from successful exports`);
      }

      setPipeline((p) => p && ({
        ...p,
        exportedSizes: sizes,
        sliceMappings: mappings,
        steps: updateStep(p.steps, 'export', {
          status: 'done',
          detail: `${exported.length} images (${(totalSize / 1024).toFixed(0)}KB total)`,
          durationMs: Math.round(t3 - t2),
        }),
      }));

      // Step 4: Analyze
      setStatus('analyzing');
      const t4 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', { status: 'active', detail: `Sending ${exported.length} images to LLM...` }),
      }));

      const blobs = exported.map((e) => e.blob);
      const sliceLabels = mappings.map((m) => m.label);
      logger.log(`Call 2 — Sending ${blobs.length} images to LLM (${sliceLabels.join(', ')})...`);
      const analysisText = await service.analyzeSlices(blobs, metadata, hint, adjustedPlan, sliceLabels);
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
