import { X } from 'lucide-react';
import type { StudyMetadata, SeriesMetadata } from '../dicom/types';

interface SeriesBrowserProps {
  metadata: StudyMetadata;
  activeSeriesUID: string;
  onSelectSeries: (seriesUID: string) => void;
  onClose: () => void;
}

export default function SeriesBrowser({ metadata, activeSeriesUID, onSelectSeries, onClose }: SeriesBrowserProps) {
  const clinicalSeries = metadata.series.filter((s) => !s.isScout);
  const scoutSeries = metadata.series.filter((s) => s.isScout);

  return (
    <div className="w-64 h-full bg-neutral-900 border-r border-neutral-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-200">Series</span>
          <span className="text-[10px] font-medium text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
            {metadata.series.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Series list */}
      <div className="flex-1 overflow-y-auto py-1">
        {clinicalSeries.map((series) => (
          <SeriesItem
            key={series.seriesInstanceUID}
            series={series}
            isActive={series.seriesInstanceUID === activeSeriesUID}
            isPrimary={series.seriesInstanceUID === metadata.primarySeriesUID}
            onSelect={() => onSelectSeries(series.seriesInstanceUID)}
          />
        ))}
        {scoutSeries.length > 0 && clinicalSeries.length > 0 && (
          <div className="mx-3 my-1 border-t border-neutral-700/50" />
        )}
        {scoutSeries.map((series) => (
          <SeriesItem
            key={series.seriesInstanceUID}
            series={series}
            isActive={series.seriesInstanceUID === activeSeriesUID}
            isPrimary={series.seriesInstanceUID === metadata.primarySeriesUID}
            onSelect={() => onSelectSeries(series.seriesInstanceUID)}
          />
        ))}
      </div>
    </div>
  );
}

function SeriesItem({
  series,
  isActive,
  isPrimary,
  onSelect,
}: {
  series: SeriesMetadata;
  isActive: boolean;
  isPrimary: boolean;
  onSelect: () => void;
}) {
  const plane = series.anatomicalPlane.charAt(0).toUpperCase() + series.anatomicalPlane.slice(1);
  const thickness = series.sliceThickness != null ? `${series.sliceThickness}mm` : null;
  const matrix = series.rows != null && series.columns != null ? `${series.rows}×${series.columns}` : null;
  // Compact weighting label: "T1", "T2", "PD", "T2 fat-sat" → "T2-FS", etc.
  const weightingBadge = series.estimatedWeighting
    ? series.estimatedWeighting.replace(' fat-sat', '-FS')
    : null;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 transition-colors ${
        isActive
          ? 'bg-blue-950/50 border-l-2 border-blue-500'
          : 'hover:bg-neutral-800 border-l-2 border-transparent'
      } ${series.isScout ? 'opacity-50' : ''}`}
    >
      {/* Line 1: series number + description + badges */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className={`font-medium truncate ${isActive ? 'text-blue-200' : 'text-neutral-200'}`}>
          #{series.seriesNumber} {series.seriesDescription || '(no description)'}
        </span>
        {isPrimary && (
          <span className="shrink-0 w-1.5 h-1.5 bg-green-400 rounded-full" title="Primary series" />
        )}
        {series.isScout && (
          <span className="shrink-0 text-[10px] font-medium text-neutral-400 bg-neutral-700/60 px-1 rounded">
            Scout
          </span>
        )}
      </div>
      {/* Line 2: plane, slice count, thickness, matrix, weighting */}
      <div className="text-[11px] text-neutral-500 mt-0.5">
        {plane} &middot; {series.slices.length} slices{thickness && <> &middot; {thickness}</>}
        {matrix && <> &middot; {matrix}</>}
        {weightingBadge && (
          <span className="ml-1 text-[10px] font-medium text-purple-400 bg-purple-900/40 px-1 rounded">
            {weightingBadge}
          </span>
        )}
      </div>
      {/* Active badge */}
      {isActive && (
        <span className="inline-block mt-1 text-[10px] font-semibold text-blue-400 bg-blue-900/60 px-1.5 py-0 rounded">
          Active
        </span>
      )}
    </button>
  );
}
