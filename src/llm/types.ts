import type { StudyMetadata } from '../dicom/types';

export interface SelectionPlan {
  targetSeries: string;           // Series Number as string, e.g., "3"
  sliceRange: [number, number];   // Inclusive instance number range [start, end]
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
  windowCenter: number;
  windowWidth: number;
  reasoning: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type ProviderType = 'claude' | 'ollama';

export interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;           // Claude only
  ollamaTextModel?: string;  // Ollama model for Call 1 (text-only planning)
  ollamaVisionModel?: string; // Ollama model for Call 2 (multimodal analysis)
  ollamaUrl?: string;        // Ollama base URL override
}

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
  ): Promise<string>;
  sendFollowUp(
    conversationHistory: ChatMessage[],
    metadata: StudyMetadata,
  ): Promise<string>;
}
