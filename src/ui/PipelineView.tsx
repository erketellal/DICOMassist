import { useState } from 'react';
import { CheckCircle, Loader2, Circle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { SelectionPlan } from '../llm/types';
import type { PipelineState, PipelineStep, SliceMapping } from '../llm/useLLMChat';

export default function PipelineView({ pipeline }: { pipeline: PipelineState }) {
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

function PlanDetail({ plan }: { plan: SelectionPlan }) {
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
