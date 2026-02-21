import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { SelectionPlan } from '../llm/types';
import type { StudyMetadata } from '../dicom/types';

interface PlanPreviewModalProps {
  open: boolean;
  plan: SelectionPlan;
  metadata: StudyMetadata;
  onAccept: (plan: SelectionPlan) => void;
  onCancel: () => void;
}

function deriveNumSlices(plan: SelectionPlan): number {
  const rangeSize = plan.sliceRange[1] - plan.sliceRange[0] + 1;
  if (plan.samplingStrategy === 'uniform' && plan.samplingParam != null) {
    return Math.min(plan.samplingParam, rangeSize, 20);
  }
  if (plan.samplingStrategy === 'every_nth' && plan.samplingParam != null && plan.samplingParam > 0) {
    return Math.min(Math.ceil(rangeSize / plan.samplingParam), 20);
  }
  return Math.min(rangeSize, 20);
}

export default function PlanPreviewModal({ open, plan, metadata, onAccept, onCancel }: PlanPreviewModalProps) {
  const [expanded, setExpanded] = useState(false);
  const [targetSeries, setTargetSeries] = useState(plan.targetSeries);
  const [rangeStart, setRangeStart] = useState(plan.sliceRange[0]);
  const [rangeEnd, setRangeEnd] = useState(plan.sliceRange[1]);
  const [numSlices, setNumSlices] = useState(() => deriveNumSlices(plan));
  const [windowCenter, setWindowCenter] = useState(plan.windowCenter);
  const [windowWidth, setWindowWidth] = useState(plan.windowWidth);

  // Reset local state when plan changes (new Call 1 result)
  useEffect(() => {
    setTargetSeries(plan.targetSeries);
    setRangeStart(plan.sliceRange[0]);
    setRangeEnd(plan.sliceRange[1]);
    setNumSlices(deriveNumSlices(plan));
    setWindowCenter(plan.windowCenter);
    setWindowWidth(plan.windowWidth);
    setExpanded(false);
  }, [plan]);

  const handleSeriesChange = useCallback((newSeriesNum: string) => {
    setTargetSeries(newSeriesNum);
    const series = metadata.series.find((s) => String(s.seriesNumber) === newSeriesNum);
    if (series) {
      const [minInst, maxInst] = series.instanceNumberRange;
      setRangeStart(minInst);
      setRangeEnd(maxInst);
      const rangeSize = maxInst - minInst + 1;
      setNumSlices(Math.min(15, rangeSize, 20));
      if (series.windowCenter != null && series.windowWidth != null) {
        setWindowCenter(series.windowCenter);
        setWindowWidth(series.windowWidth);
      }
    }
  }, [metadata]);

  const handleAccept = useCallback(() => {
    const rangeSize = rangeEnd - rangeStart + 1;
    const clampedSlices = Math.min(Math.max(numSlices, 1), rangeSize, 20);
    const adjustedPlan: SelectionPlan = {
      targetSeries,
      sliceRange: [rangeStart, rangeEnd],
      samplingStrategy: clampedSlices >= rangeSize ? 'all' : 'uniform',
      samplingParam: clampedSlices >= rangeSize ? undefined : clampedSlices,
      windowCenter,
      windowWidth,
      reasoning: plan.reasoning,
    };
    onAccept(adjustedPlan);
  }, [targetSeries, rangeStart, rangeEnd, numSlices, windowCenter, windowWidth, plan.reasoning, onAccept]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  const currentSeries = metadata.series.find((s) => String(s.seriesNumber) === targetSeries);
  const seriesRange = currentSeries?.instanceNumberRange ?? [1, 999];
  const seriesDesc = currentSeries
    ? `#${currentSeries.seriesNumber} ${currentSeries.seriesDescription || ''}`
    : `#${targetSeries}`;
  const rangeSize = rangeEnd - rangeStart + 1;

  return (
    // pointer-events-none container — clicks pass through to viewport
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-2xl mx-4 bg-neutral-800/95 backdrop-blur-sm border border-neutral-600 rounded-xl shadow-2xl overflow-hidden">
        {/* Collapsed bar — always visible */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
            title={expanded ? 'Collapse' : 'Expand to edit'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          <span className="text-xs text-neutral-300 truncate flex-1">
            <span className="text-neutral-500">Plan:</span>{' '}
            {seriesDesc} &middot; slices {rangeStart}&ndash;{rangeEnd} &middot; {numSlices} samples &middot; W:{windowWidth} C:{windowCenter}
          </span>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200 rounded hover:bg-neutral-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAccept}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
            >
              Accept &amp; Analyze
            </button>
          </div>
        </div>

        {/* Expanded fields */}
        {expanded && (
          <div className="px-4 pb-3 pt-1 border-t border-neutral-700/50 space-y-2.5">
            {/* Reasoning */}
            <p className="text-[11px] text-neutral-500 leading-relaxed italic">
              {plan.reasoning}
            </p>

            {/* Series */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-neutral-400 w-14 shrink-0">Series</label>
              <select
                value={targetSeries}
                onChange={(e) => handleSeriesChange(e.target.value)}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
              >
                {metadata.series.map((s) => (
                  <option key={s.seriesInstanceUID} value={String(s.seriesNumber)}>
                    #{s.seriesNumber} — {s.seriesDescription || 'No description'} ({s.slices.length} slices, {s.anatomicalPlane})
                  </option>
                ))}
              </select>
            </div>

            {/* Range + Slices + Window — compact row */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-neutral-400 w-14 shrink-0">Range</label>
                <input
                  type="number"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(Math.max(seriesRange[0], parseInt(e.target.value) || seriesRange[0]))}
                  min={seriesRange[0]}
                  max={rangeEnd}
                  className="w-16 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
                />
                <span className="text-neutral-500 text-xs">&mdash;</span>
                <input
                  type="number"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(Math.min(seriesRange[1], parseInt(e.target.value) || seriesRange[1]))}
                  min={rangeStart}
                  max={seriesRange[1]}
                  className="w-16 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-neutral-500">of {seriesRange[0]}&ndash;{seriesRange[1]}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-xs text-neutral-400">Slices</label>
                <input
                  type="number"
                  value={numSlices}
                  onChange={(e) => setNumSlices(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={20}
                  className="w-12 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-neutral-500">/ {Math.min(rangeSize, 20)}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-xs text-neutral-400">C:</label>
                <input
                  type="number"
                  value={windowCenter}
                  onChange={(e) => setWindowCenter(parseInt(e.target.value) || 0)}
                  className="w-16 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
                />
                <label className="text-xs text-neutral-400 ml-1">W:</label>
                <input
                  type="number"
                  value={windowWidth}
                  onChange={(e) => setWindowWidth(parseInt(e.target.value) || 1)}
                  min={1}
                  className="w-16 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
