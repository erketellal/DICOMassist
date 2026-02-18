import type { StudyMetadata } from '../dicom/types';
import type { SelectionPlan, ChatMessage, ProviderConfig, LLMService, ViewportContext } from './types';
import {
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildFollowUpSystemPrompt,
} from './PromptBuilder';

// --- Shared Helpers ---

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text.trim();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseSelectionPlan(raw: string): SelectionPlan {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(
      'The LLM did not return valid JSON. This can happen with smaller models. ' +
      'Try a more specific clinical prompt (e.g., "Evaluate for lung nodules") or switch to Claude.',
    );
  }
  if (!json.targetSeries || !json.sliceRange) {
    throw new Error(
      'The LLM response is missing required fields (targetSeries, sliceRange). ' +
      'Try a more specific clinical prompt or a larger model.',
    );
  }
  return {
    targetSeries: String(json.targetSeries),
    sliceRange: [Number((json.sliceRange as number[])[0]), Number((json.sliceRange as number[])[1])],
    samplingStrategy: (json.samplingStrategy as string) ?? 'uniform',
    samplingParam: json.samplingParam != null ? Number(json.samplingParam) : undefined,
    windowCenter: Number(json.windowCenter),
    windowWidth: Number(json.windowWidth),
    reasoning: String(json.reasoning ?? ''),
  };
}

// --- Claude Service ---

class ClaudeService implements LLMService {
  private apiKey: string;
  private model = 'claude-sonnet-4-5-20250929';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const response = await this.callClaude({
      system: buildSelectionSystemPrompt(),
      messages: [{ role: 'user', content: buildSelectionUserPrompt(metadata, clinicalHint, viewportContext) }],
      temperature: 0.1,
      maxTokens: 1024,
    });
    return parseSelectionPlan(response);
  }

  async analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
  ): Promise<string> {
    const imageContents = await Promise.all(
      images.map(async (blob, i) => [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/jpeg' as const,
            data: await blobToBase64(blob),
          },
        },
        {
          type: 'text' as const,
          text: sliceLabels[i] ?? `Image ${i + 1}`,
        },
      ]),
    );

    const content = [
      ...imageContents.flat(),
      {
        type: 'text' as const,
        text: buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels),
      },
    ];

    return this.callClaude({
      system: buildAnalysisSystemPrompt(),
      messages: [{ role: 'user', content }],
      temperature: 0.5,
      maxTokens: 4096,
    });
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages = conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    return this.callClaude({
      system: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription,
      messages,
      temperature: 0.5,
      maxTokens: 4096,
    });
  }

  private async callClaude(params: {
    system: string;
    messages: Array<{ role: string; content: unknown }>;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: params.system,
        messages: params.messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) throw new Error('Invalid API key. Check your Claude API key.');
      throw new Error(`Claude API error (${res.status}): ${body}`);
    }

    const data = await res.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text ?? '';
  }
}

// --- Ollama Service ---

class OllamaService implements LLMService {
  private baseUrl: string;
  private textModel: string;
  private visionModel: string;

  constructor(textModel: string, visionModel: string, baseUrl: string) {
    this.textModel = textModel;
    this.visionModel = visionModel;
    this.baseUrl = baseUrl;
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const response = await this.callOllama({
      model: this.textModel,
      system: buildSelectionSystemPrompt(),
      userContent: buildSelectionUserPrompt(metadata, clinicalHint, viewportContext),
    });
    return parseSelectionPlan(response);
  }

  async analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
  ): Promise<string> {
    const base64Images = await Promise.all(images.map(blobToBase64));
    const userContent = buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels)
      + `\n\nThe images are labeled in order: ${sliceLabels.join(', ')}.`;

    return this.callOllama({
      model: this.visionModel,
      system: buildAnalysisSystemPrompt(),
      userContent,
      images: base64Images,
    });
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages = [
      { role: 'system' as const, content: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription },
      ...conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.textModel,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }

  private async callOllama(params: {
    model: string;
    system: string;
    userContent: string;
    images?: string[];
  }): Promise<string> {
    const messages = [
      { role: 'system', content: params.system },
      {
        role: 'user',
        content: params.userContent,
        ...(params.images?.length ? { images: params.images } : {}),
      },
    ];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`Ollama request timed out (5min). Model: ${params.model}. Try fewer slices or a smaller model.`);
      }
      throw new Error('Cannot connect to Ollama. Is it running? (ollama serve)');
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }
}

// --- Factory ---

const DEFAULT_TEXT_MODEL = 'alibayram/medgemma:4b';
const DEFAULT_VISION_MODEL = 'gemma3:4b';

export function createLLMService(config: ProviderConfig): LLMService {
  if (config.provider === 'claude') {
    const key = config.apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!key) throw new Error('Claude API key is required. Enter it in Settings.');
    return new ClaudeService(key);
  }
  const baseUrl = config.ollamaUrl || 'http://localhost:11434';
  const textModel = config.ollamaTextModel || DEFAULT_TEXT_MODEL;
  const visionModel = config.ollamaVisionModel || DEFAULT_VISION_MODEL;
  return new OllamaService(textModel, visionModel, baseUrl);
}

// --- Ollama Management API ---

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at: string;
}

export async function fetchOllamaModels(baseUrl = 'http://localhost:11434'): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map((m: { name: string; size: number; modified_at: string }) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));
  } catch {
    return [];
  }
}

export async function pingOllama(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOllamaModel(
  modelName: string,
  onProgress: (status: string, percent: number | null) => void,
  baseUrl = 'http://localhost:11434',
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok || !res.body) {
      onProgress('Failed to start download', null);
      return false;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.error) {
            onProgress(`Error: ${data.error}`, null);
            return false;
          }
          const percent = data.total ? Math.round((data.completed / data.total) * 100) : null;
          onProgress(data.status ?? 'Downloading...', percent);
        } catch { /* skip malformed lines */ }
      }
    }

    onProgress('Complete', 100);
    return true;
  } catch {
    onProgress('Connection failed', null);
    return false;
  }
}
