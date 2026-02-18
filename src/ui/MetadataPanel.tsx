import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { StudyMetadata } from '../dicom/types';

interface MetadataPanelProps {
  metadata: StudyMetadata;
  onClose: () => void;
}

function formatDate(dateStr?: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr ?? '';
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

export default function MetadataPanel({ metadata, onClose }: MetadataPanelProps) {
  const [studyExpanded, setStudyExpanded] = useState(true);
  const [seriesExpanded, setSeriesExpanded] = useState(true);

  return (
    <div className="w-72 h-full bg-neutral-900 border-l border-neutral-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <span className="text-sm font-medium text-neutral-200">Study Info</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto text-xs">
        {/* Study Section */}
        <button
          onClick={() => setStudyExpanded(!studyExpanded)}
          className="flex items-center gap-1 w-full px-3 py-2 text-left text-neutral-300 hover:bg-neutral-800"
        >
          {studyExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="font-medium">Study</span>
        </button>
        {studyExpanded && (
          <div className="px-3 pb-2 space-y-1">
            <MetaRow label="Description" value={metadata.studyDescription} />
            <MetaRow label="Modality" value={metadata.modality} />
            <MetaRow label="Body Part" value={metadata.bodyPartExamined} />
            <MetaRow label="Patient Age" value={metadata.patientAge} />
            <MetaRow label="Patient Sex" value={metadata.patientSex} />
            <MetaRow label="Study Date" value={formatDate(metadata.studyDate)} />
            <MetaRow label="Institution" value={metadata.institutionName} />
          </div>
        )}

        {/* Series Section */}
        <button
          onClick={() => setSeriesExpanded(!seriesExpanded)}
          className="flex items-center gap-1 w-full px-3 py-2 text-left text-neutral-300 hover:bg-neutral-800 border-t border-neutral-800"
        >
          {seriesExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="font-medium">Series ({metadata.series.length})</span>
        </button>
        {seriesExpanded && (
          <div className="px-3 pb-2 space-y-2">
            {metadata.series.map((s) => (
              <SeriesCard
                key={s.seriesInstanceUID}
                series={s}
                isPrimary={s.seriesInstanceUID === metadata.primarySeriesUID}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className="text-neutral-300 break-words">{value}</span>
    </div>
  );
}

function SeriesCard({ series, isPrimary }: { series: import('../dicom/types').SeriesMetadata; isPrimary: boolean }) {
  const plane = series.anatomicalPlane.charAt(0).toUpperCase() + series.anatomicalPlane.slice(1);
  const [instMin, instMax] = series.instanceNumberRange;
  return (
    <div className={`rounded px-2 py-1.5 space-y-0.5 ${isPrimary ? 'bg-blue-950/50 border border-blue-700' : 'bg-neutral-800'}`}>
      <div className="flex items-center gap-1.5 text-neutral-200 font-medium">
        <span>#{series.seriesNumber} {series.seriesDescription || '(no description)'}</span>
        {isPrimary && (
          <span className="text-[10px] font-semibold text-blue-400 bg-blue-900/60 px-1.5 py-0 rounded">Primary</span>
        )}
      </div>
      <div className="text-neutral-400 space-y-0.5">
        <div>{plane} &middot; {series.slices.length} slices &middot; Inst {instMin}&ndash;{instMax}</div>
        {series.zCoverageInMm > 0 && (
          <div>Coverage: {series.zCoverageInMm.toFixed(1)}mm (z={series.zMin.toFixed(1)} to {series.zMax.toFixed(1)})</div>
        )}
        {series.sliceThickness != null && (
          <div>Thickness: {series.sliceThickness}mm</div>
        )}
        {series.convolutionKernel && (
          <div>Kernel: {series.convolutionKernel}</div>
        )}
        {series.windowCenter != null && series.windowWidth != null && (
          <div>W:{Math.round(series.windowWidth)} C:{Math.round(series.windowCenter)}</div>
        )}
      </div>
    </div>
  );
}
