import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Trash2, AlertCircle, Loader2, CheckCircle, Circle, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import type { ChatMessage } from '../llm/types';
import type { ChatStatus, PipelineState, PipelineStep, SliceMapping } from '../llm/useLLMChat';

interface ChatSidebarProps {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  pipeline: PipelineState | null;
  onSendFollowUp: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
  onNavigateToSlice: (mapping: SliceMapping) => void;
}

export default function ChatSidebar({
  messages,
  status,
  statusText,
  error,
  pipeline,
  onSendFollowUp,
  onClear,
  onClose,
  onNavigateToSlice,
}: ChatSidebarProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status !== 'idle' && status !== 'error';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, pipeline]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSendFollowUp(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-96 h-full bg-neutral-900 border-l border-neutral-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
        <span className="text-sm font-medium text-neutral-200">Analysis Chat</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={onClear}
              title="Clear chat"
              className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !busy && !pipeline && (
          <div className="text-center text-neutral-500 text-xs mt-8">
            <p>No analysis yet.</p>
            <p className="mt-1">Press <kbd className="bg-neutral-700 px-1 rounded">Cmd+K</kbd> to start.</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isFirstUser = msg.role === 'user' && i === 0;
          const showPipeline = isFirstUser && pipeline;
          return (
            <div key={msg.id}>
              <MessageBubble message={msg} />
              {showPipeline && <PipelineView pipeline={pipeline} />}
              {msg.role === 'assistant' && (
                <AssistantMessage
                  content={msg.content}
                  sliceMappings={pipeline?.sliceMappings ?? []}
                  onNavigate={onNavigateToSlice}
                />
              )}
            </div>
          );
        })}

        {busy && statusText && status === 'following-up' && (
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            {statusText}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 bg-red-950/50 border border-red-800 rounded text-xs text-red-300 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Disclaimer */}
      <div className="px-3 py-1 text-[10px] text-neutral-600 text-center shrink-0">
        Not for clinical diagnosis
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-1 border-t border-neutral-800 shrink-0">
        <div className="flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.length > 0 ? 'Ask a follow-up...' : 'Use Cmd+K to start analysis'}
            disabled={busy || messages.length === 0}
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim() || messages.length === 0}
            className="p-1 rounded text-neutral-400 hover:text-blue-400 disabled:opacity-30 disabled:hover:text-neutral-400"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Pipeline Visualization ---

function PipelineView({ pipeline }: { pipeline: PipelineState }) {
  const [expanded, setExpanded] = useState(true);
  const allDone = pipeline.steps.every((s) => s.status === 'done');

  return (
    <div className="my-2 bg-neutral-800/60 border border-neutral-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs font-medium text-neutral-300 hover:bg-neutral-700/50"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Pipeline {allDone ? '(complete)' : ''}</span>
        {!allDone && <Loader2 className="w-3 h-3 animate-spin text-blue-400 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {pipeline.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {pipeline.plan && (
            <PlanDetail plan={pipeline.plan} />
          )}
          {pipeline.sliceMappings.length > 0 && (
            <SliceMappingDetail mappings={pipeline.sliceMappings} totalSlices={pipeline.totalSlices} />
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: PipelineStep }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0">
        {step.status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
        {step.status === 'active' && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
        {step.status === 'pending' && <Circle className="w-3.5 h-3.5 text-neutral-600" />}
        {step.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${step.status === 'done' ? 'text-neutral-300' : step.status === 'active' ? 'text-blue-300' : 'text-neutral-500'}`}>
            {step.label}
          </span>
          {step.durationMs != null && (
            <span className="text-[10px] text-neutral-600">{(step.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        {step.detail && (
          <p className={`text-[10px] mt-0.5 ${step.status === 'error' ? 'text-red-400' : 'text-neutral-500'}`}>
            {step.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function PlanDetail({ plan }: { plan: import('../llm/types').SelectionPlan }) {
  return (
    <div className="mt-1.5 ml-5.5 pl-2 border-l border-neutral-700 text-[10px] text-neutral-500 space-y-0.5">
      <p className="text-neutral-400 font-medium">LLM reasoning:</p>
      <p className="italic">{plan.reasoning}</p>
    </div>
  );
}

function SliceMappingDetail({ mappings, totalSlices }: { mappings: SliceMapping[]; totalSlices: number }) {
  const [showAll, setShowAll] = useState(false);
  const labels = mappings.map((m) => m.label);
  const preview = showAll ? labels : labels.slice(0, 6);
  const hasMore = labels.length > 6;

  return (
    <div className="mt-1.5 ml-5.5 pl-2 border-l border-neutral-700 text-[10px] text-neutral-500 space-y-0.5">
      <p className="text-neutral-400 font-medium">
        Sent to vision model: {mappings.length} of {totalSlices} slices
      </p>
      <div className="flex flex-wrap gap-1">
        {preview.map((label, i) => (
          <span key={i} className="px-1.5 py-0.5 bg-neutral-700/50 rounded text-neutral-400">
            {label}
          </span>
        ))}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="px-1.5 py-0.5 text-blue-400 hover:text-blue-300"
          >
            +{labels.length - 6} more
          </button>
        )}
      </div>
    </div>
  );
}

// --- Assistant Message with Interactive Slice References ---

// Matches: "Slice 45/187", "Slices 45-66/187", "Slice 45", "Slices 45–66"
// Also matches legacy "Image N" format as fallback
const SLICE_REF_PATTERN = /\b[Ss]lices?\s+(\d+)(?:\s*[-–]\s*(\d+))?(?:\/(\d+))?\b/g;
const IMAGE_REF_PATTERN = /\b[Ii]mages?\s+(\d+)(?:\s*[-–]\s*(\d+))?\b/g;

interface ParsedSegment {
  type: 'text' | 'slice-ref';
  content: string;
  fromInstance?: number;
  toInstance?: number;
  total?: number;
  isLegacyImageRef?: boolean;
}

function parseSliceRefs(text: string): ParsedSegment[] {
  // Collect all matches from both patterns with their positions
  const allMatches: { index: number; length: number; from: number; to: number; total?: number; content: string; isLegacy: boolean }[] = [];

  for (const match of text.matchAll(SLICE_REF_PATTERN)) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      from: parseInt(match[1], 10),
      to: match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10),
      total: match[3] ? parseInt(match[3], 10) : undefined,
      content: match[0],
      isLegacy: false,
    });
  }

  for (const match of text.matchAll(IMAGE_REF_PATTERN)) {
    // Only add if not overlapping with a slice ref
    const overlaps = allMatches.some(
      (m) => match.index < m.index + m.length && match.index + match[0].length > m.index,
    );
    if (!overlaps) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        from: parseInt(match[1], 10),
        to: match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10),
        content: match[0],
        isLegacy: true,
      });
    }
  }

  // Sort by position
  allMatches.sort((a, b) => a.index - b.index);

  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  for (const match of allMatches) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'slice-ref',
      content: match.content,
      fromInstance: match.from,
      toInstance: match.to,
      total: match.total,
      isLegacyImageRef: match.isLegacy,
    });
    lastIndex = match.index + match.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

function AssistantMessage({
  content,
  sliceMappings,
  onNavigate,
}: {
  content: string;
  sliceMappings: SliceMapping[];
  onNavigate: (mapping: SliceMapping) => void;
}) {
  const handleSliceClick = useCallback((fromInstance: number, toInstance: number, isLegacy: boolean) => {
    let mapping: SliceMapping | undefined;

    if (isLegacy) {
      // Legacy "Image N" — fromInstance/toInstance are 1-based image indices
      const midImage = Math.round((fromInstance + toInstance) / 2);
      mapping = sliceMappings.find((m) => m.imageIndex === midImage)
        ?? sliceMappings.find((m) => m.imageIndex >= fromInstance && m.imageIndex <= toInstance);
    } else {
      // New "Slice X/Y" — fromInstance/toInstance are actual instance numbers
      const midInstance = Math.round((fromInstance + toInstance) / 2);
      // Find closest mapping to midInstance
      mapping = sliceMappings.reduce<SliceMapping | undefined>((best, m) => {
        if (m.instanceNumber < fromInstance || m.instanceNumber > toInstance) return best;
        if (!best) return m;
        return Math.abs(m.instanceNumber - midInstance) < Math.abs(best.instanceNumber - midInstance) ? m : best;
      }, undefined);
      // If no exact range match, find the nearest slice
      if (!mapping) {
        mapping = sliceMappings.reduce<SliceMapping | undefined>((best, m) => {
          if (!best) return m;
          return Math.abs(m.instanceNumber - midInstance) < Math.abs(best.instanceNumber - midInstance) ? m : best;
        }, undefined);
      }
    }

    if (mapping) {
      onNavigate(mapping);
    }
  }, [sliceMappings, onNavigate]);

  const lines = content.split('\n');

  return (
    <div className="mt-1 text-sm text-neutral-200 space-y-0.5">
      {lines.map((line, i) => (
        <FormattedLine
          key={i}
          line={line}
          sliceMappings={sliceMappings}
          onSliceClick={handleSliceClick}
        />
      ))}
    </div>
  );
}

function FormattedLine({
  line,
  sliceMappings,
  onSliceClick,
}: {
  line: string;
  sliceMappings: SliceMapping[];
  onSliceClick: (from: number, to: number, isLegacy: boolean) => void;
}) {
  // Empty line
  if (line.trim() === '') {
    return <div className="h-1.5" />;
  }

  // Headers: ## or **Header:**
  if (line.startsWith('## ')) {
    return (
      <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wide mt-3 mb-1 border-b border-neutral-800 pb-1">
        {line.slice(3)}
      </h3>
    );
  }

  // Bold-only lines (section titles like **Overall Impression:**)
  const boldLineMatch = line.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (boldLineMatch) {
    return (
      <p className="font-semibold text-neutral-100 mt-2.5 mb-0.5">{boldLineMatch[1]}</p>
    );
  }

  // Bullet points
  const bulletMatch = line.match(/^(\s*)[-•*]\s+(.*)/);
  if (bulletMatch) {
    const indent = bulletMatch[1].length > 0;
    return (
      <div className={`flex gap-1.5 ${indent ? 'ml-4' : 'ml-1'} my-0.5`}>
        <span className="text-neutral-600 shrink-0 mt-0.5">&#x2022;</span>
        <span className="text-neutral-300">
          <InlineContent text={bulletMatch[2]} sliceMappings={sliceMappings} onSliceClick={onSliceClick} />
        </span>
      </div>
    );
  }

  // Numbered list
  const numberedMatch = line.match(/^(\d+)\.\s+(.*)/);
  if (numberedMatch) {
    return (
      <div className="flex gap-2 ml-1 my-0.5">
        <span className="text-blue-400 shrink-0 text-xs font-medium mt-0.5">{numberedMatch[1]}.</span>
        <span className="text-neutral-300">
          <InlineContent text={numberedMatch[2]} sliceMappings={sliceMappings} onSliceClick={onSliceClick} />
        </span>
      </div>
    );
  }

  // Regular paragraph
  return (
    <p className="text-neutral-300 my-0.5">
      <InlineContent text={line} sliceMappings={sliceMappings} onSliceClick={onSliceClick} />
    </p>
  );
}

function InlineContent({
  text,
  sliceMappings,
  onSliceClick,
}: {
  text: string;
  sliceMappings: SliceMapping[];
  onSliceClick: (from: number, to: number, isLegacy: boolean) => void;
}) {
  const segments = parseSliceRefs(text);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'slice-ref' && seg.fromInstance != null && seg.toInstance != null) {
          const isLegacy = seg.isLegacyImageRef ?? false;
          // Check if we have a mapping for this reference
          const hasMapping = isLegacy
            ? sliceMappings.some((m) => m.imageIndex >= seg.fromInstance! && m.imageIndex <= seg.toInstance!)
            : sliceMappings.some((m) => m.instanceNumber >= seg.fromInstance! && m.instanceNumber <= seg.toInstance!)
              || sliceMappings.length > 0; // For slice refs, always show as clickable if we have any mappings (will navigate to nearest)
          if (hasMapping) {
            return (
              <button
                key={i}
                onClick={() => onSliceClick(seg.fromInstance!, seg.toInstance!, isLegacy)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded bg-blue-900/40 border border-blue-700/50 text-blue-300 hover:bg-blue-800/50 hover:text-blue-200 transition-colors text-xs font-medium mx-0.5 cursor-pointer"
                title={`Go to ${seg.content} in viewer`}
              >
                <Eye className="w-3 h-3" />
                {seg.content}
              </button>
            );
          }
        }
        // Handle inline bold: **text**
        return <BoldText key={i} text={seg.content} />;
      })}
    </>
  );
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="text-neutral-100 font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// --- Message Bubble (user only — assistant handled by AssistantMessage) ---

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-br-sm">
          {message.content}
        </div>
      </div>
    );
  }
  // Assistant messages are rendered by AssistantMessage
  return null;
}
