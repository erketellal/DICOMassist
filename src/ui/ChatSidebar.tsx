import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { X, Send, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import type { ChatMessage, SelectionPlan } from '../llm/types';
import type { StudyMetadata } from '../dicom/types';
import type { ChatStatus, PipelineState, SliceMapping } from '../llm/useLLMChat';
import PipelineView from './PipelineView';
import AssistantMessage from './AssistantMessage';
import PlanPreviewCard from './PlanPreviewCard';

export interface ChatSidebarHandle {
  focusInput: () => void;
}

interface ChatSidebarProps {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  pipeline: PipelineState | null;
  currentPlan: SelectionPlan | null;
  studyMetadata: StudyMetadata | null;
  onConfirmPlan: (plan: SelectionPlan) => void;
  onCancelPlan: () => void;
  onStartAnalysis: (hint: string) => void;
  onSendFollowUp: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
  onNavigateToSlice: (mapping: SliceMapping) => void;
}

export default forwardRef<ChatSidebarHandle, ChatSidebarProps>(function ChatSidebar({
  messages,
  status,
  statusText,
  error,
  pipeline,
  currentPlan,
  studyMetadata,
  onConfirmPlan,
  onCancelPlan,
  onStartAnalysis,
  onSendFollowUp,
  onClear,
  onClose,
  onNavigateToSlice,
}, ref) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status !== 'idle' && status !== 'error' && status !== 'awaiting-confirmation';

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, pipeline, currentPlan]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    if (messages.length === 0) {
      // No conversation yet — start a new analysis
      onStartAnalysis(trimmed);
    } else {
      // Existing conversation — send as follow-up
      onSendFollowUp(trimmed);
    }
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
            <p className="mt-1">Describe the clinical context below to start.</p>
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

        {/* Plan preview card — inline, only during awaiting-confirmation */}
        {status === 'awaiting-confirmation' && currentPlan && studyMetadata && (
          <PlanPreviewCard
            plan={currentPlan}
            metadata={studyMetadata}
            onAccept={onConfirmPlan}
            onCancel={onCancelPlan}
          />
        )}

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
            placeholder={messages.length > 0 ? 'Ask a follow-up...' : 'Describe clinical context...'}
            disabled={busy}
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim()}
            className="p-1 rounded text-neutral-400 hover:text-blue-400 disabled:opacity-30 disabled:hover:text-neutral-400"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

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
