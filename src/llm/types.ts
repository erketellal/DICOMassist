import type { StudyMetadata } from '../dicom/types';

export interface SeriesSelection {
  seriesNumber: string;
  role: 'primary' | 'supplementary';
  rationale: string;
  sliceRange: [number, number];
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
  windowWidth: number;
  windowCenter: number;
}

export interface SelectionPlan {
  reasoning: string;
  selections: SeriesSelection[];
  totalImages: number;
  // Legacy shortcuts from selections[0] — used by App.tsx viewport logic
  targetSeries: string;
  sliceRange: [number, number];
  windowCenter: number;
  windowWidth: number;
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type ProviderType = 'claude' | 'ollama' | 'lmstudio';

export interface ClaudeConfig {
  provider: 'claude';
  apiKey: string;
}

export interface OllamaConfig {
  provider: 'ollama';
  url?: string;            // Base URL override (default http://localhost:11434)
  textModel?: string;      // Call 1 (text-only planning)
  visionModel?: string;    // Call 2 (multimodal analysis)
}

export interface LMStudioConfig {
  provider: 'lmstudio';
  url?: string;            // OpenAI-compatible base URL (default http://localhost:1234/v1)
  textModel?: string;      // Call 1 (text-only planning)
  visionModel?: string;    // Call 2 (multimodal analysis)
}

export type ProviderConfig = ClaudeConfig | OllamaConfig | LMStudioConfig;

export interface ViewportContext {
  currentInstanceNumber: number;
  currentZPosition: number;
  seriesNumber: string;
  totalSlicesInSeries: number;
}

export interface LLMService {
  getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan>;
  analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode?: boolean,
  ): Promise<string>;
  sendFollowUp(
    conversationHistory: ChatMessage[],
    metadata: StudyMetadata,
  ): Promise<string>;
}
