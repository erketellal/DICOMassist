import { useState, useCallback, useRef } from 'react';
import type { StudyMetadata } from '../dicom/types';
import type { SelectionPlan, ChatMessage, ProviderConfig } from './types';
import { createLLMService } from './LLMServiceFactory';
import { selectSlices } from '../filtering/SliceSelector';
import { exportSlicesToJpeg } from '../filtering/SliceExporter';

export type ChatStatus = 'idle' | 'planning' | 'exporting' | 'analyzing' | 'following-up' | 'error';

export interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
  durationMs?: number;
}

export interface PipelineState {
  steps: PipelineStep[];
  plan: SelectionPlan | null;
  sliceCount: number;
  exportedSizes: string[];
}

interface UseLLMChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  currentPlan: SelectionPlan | null;
  pipeline: PipelineState | null;
  startAnalysis: (hint: string) => Promise<void>;
  sendFollowUp: (text: string) => Promise<void>;
  clearChat: () => void;
}

const STATUS_LABELS: Record<ChatStatus, string> = {
  idle: '',
  planning: 'Analyzing metadata...',
  exporting: 'Preparing images...',
  analyzing: 'Generating analysis...',
  'following-up': 'Thinking...',
  error: 'Error',
};

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const INITIAL_STEPS: PipelineStep[] = [
  { id: 'plan', label: 'Selection planning', status: 'pending' },
  { id: 'select', label: 'Selecting slices', status: 'pending' },
  { id: 'export', label: 'Exporting images', status: 'pending' },
  { id: 'analyze', label: 'Analyzing images', status: 'pending' },
];

function updateStep(
  steps: PipelineStep[],
  id: string,
  updates: Partial<PipelineStep>,
): PipelineStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...updates } : s));
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

  const startAnalysis = useCallback(async (hint: string) => {
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
    setPipeline({ steps: initialSteps, plan: null, sliceCount: 0, exportedSizes: [] });

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

      console.group('[DICOMassist] Analysis Pipeline');
      console.log('📋 Clinical hint:', hint);
      console.log('📊 Study metadata:', {
        study: metadata.studyDescription,
        modality: metadata.modality,
        series: metadata.series.map((s) => ({
          '#': s.seriesNumber,
          desc: s.seriesDescription,
          plane: s.anatomicalPlane,
          slices: s.slices.length,
        })),
      });

      const plan = await service.getSelectionPlan(metadata, hint);
      const t1 = performance.now();
      if (abortRef.current) { console.groupEnd(); return; }

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
      console.log('🎯 Call 1 — Selection Plan:', plan);

      // Step 2: Select slices
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'select', { status: 'active', detail: `Applying ${plan.samplingStrategy} strategy...` }),
      }));
      const selectedSlices = selectSlices(metadata, plan);
      console.log(`🔍 Selected ${selectedSlices.length} slices:`, selectedSlices.map((s) => ({
        instance: s.instanceNumber,
        z: s.zPosition.toFixed(1),
      })));

      if (selectedSlices.length === 0) {
        console.groupEnd();
        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'select', { status: 'error', detail: 'No slices matched' }),
        }));
        throw new Error('No slices matched the selection plan. Try a different prompt.');
      }

      const sliceDetail = `${selectedSlices.length} slices (z: ${selectedSlices[0].zPosition.toFixed(0)} to ${selectedSlices[selectedSlices.length - 1].zPosition.toFixed(0)}mm)`;
      setPipeline((p) => p && ({
        ...p,
        sliceCount: selectedSlices.length,
        steps: updateStep(p.steps, 'select', { status: 'done', detail: sliceDetail }),
      }));

      // Step 3: Export to JPEG
      setStatus('exporting');
      const t2 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'export', { status: 'active', detail: `Rendering ${selectedSlices.length} slices with W:${plan.windowWidth} C:${plan.windowCenter}...` }),
      }));

      const exported = await exportSlicesToJpeg(selectedSlices, plan.windowCenter, plan.windowWidth);
      const t3 = performance.now();
      if (abortRef.current) { console.groupEnd(); return; }

      const sizes = exported.map((e) => `${(e.blob.size / 1024).toFixed(0)}KB`);
      const totalSize = exported.reduce((sum, e) => sum + e.blob.size, 0);
      console.log(`🖼️ Exported ${exported.length} JPEG images (sizes: ${sizes.join(', ')})`);

      setPipeline((p) => p && ({
        ...p,
        exportedSizes: sizes,
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
      console.log(`📡 Call 2 — Sending ${blobs.length} images to LLM...`);
      const analysisText = await service.analyzeSlices(blobs, metadata, hint, plan);
      const t5 = performance.now();
      if (abortRef.current) { console.groupEnd(); return; }

      console.log('✅ Call 2 — Analysis response:', analysisText.slice(0, 200) + '...');
      console.groupEnd();

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
      console.groupEnd();
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig]);

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
    sendFollowUp,
    clearChat,
  };
}
