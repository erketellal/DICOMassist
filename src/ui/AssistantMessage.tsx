import { useCallback } from 'react';
import { Eye } from 'lucide-react';
import type { SliceMapping } from '../llm/useLLMChat';

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

export default function AssistantMessage({
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
