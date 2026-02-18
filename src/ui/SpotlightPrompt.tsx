import { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import type { ChatStatus } from '../llm/useLLMChat';

interface SpotlightPromptProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (hint: string) => void;
  status: ChatStatus;
  statusText: string;
}

export default function SpotlightPrompt({ open, onClose, onSubmit, status, statusText }: SpotlightPromptProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status !== 'idle' && status !== 'error';

  useEffect(() => {
    if (open) {
      setValue('');
      // Small delay so the DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl mx-4 bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {busy ? (
            <Loader2 className="w-5 h-5 text-blue-400 shrink-0 animate-spin" />
          ) : (
            <Search className="w-5 h-5 text-neutral-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe clinical context or what to look for..."
            disabled={busy}
            className="flex-1 bg-transparent text-neutral-100 text-base placeholder-neutral-500 outline-none disabled:opacity-50"
          />
          {!busy && value.trim() && (
            <kbd className="text-xs text-neutral-500 bg-neutral-700 px-1.5 py-0.5 rounded">Enter</kbd>
          )}
        </div>
        {busy && statusText && (
          <div className="px-4 pb-3 text-sm text-blue-400">
            {statusText}
          </div>
        )}
      </div>
    </div>
  );
}
