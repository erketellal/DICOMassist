import { useState, useRef, useEffect } from 'react';
import { X, Send, Trash2, AlertCircle, Loader2, CheckCircle, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChatMessage } from '../llm/types';
import type { ChatStatus, PipelineState, PipelineStep } from '../llm/useLLMChat';

interface ChatSidebarProps {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  pipeline: PipelineState | null;
  onSendFollowUp: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
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
}: ChatSidebarProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status !== 'idle' && status !== 'error';

  // Auto-scroll to bottom on new messages or pipeline updates
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
    <div className="w-80 h-full bg-neutral-900 border-l border-neutral-700 flex flex-col overflow-hidden">
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

        {messages.map((msg, i) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {/* Show pipeline after the first user message */}
            {msg.role === 'user' && i === messages.length - 1 && pipeline && (
              <PipelineView pipeline={pipeline} />
            )}
            {msg.role === 'user' && i < messages.length - 1 && pipeline && messages[i + 1]?.role === 'assistant' && i === 0 && (
              <PipelineView pipeline={pipeline} />
            )}
          </div>
        ))}

        {/* Show pipeline when only user message exists (still processing) */}
        {messages.length === 1 && messages[0].role === 'user' && pipeline && busy && null /* already shown above */}

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

// --- Message Components ---

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

  return (
    <div className="max-w-[95%]">
      <div className="text-sm text-neutral-200 space-y-1">
        <FormattedText text={message.content} />
      </div>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={key++} className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mt-3 mb-1">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={key++} className="flex gap-1.5 ml-1">
          <span className="text-neutral-500 shrink-0">&bull;</span>
          <span>{line.slice(2)}</span>
        </div>
      );
    } else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(
        <p key={key++} className="font-medium text-neutral-100 mt-2">{line.slice(2, -2)}</p>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1" />);
    } else {
      elements.push(<p key={key++}>{line}</p>);
    }
  }

  return <>{elements}</>;
}
