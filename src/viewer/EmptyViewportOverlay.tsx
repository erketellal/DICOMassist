import type { SeriesMetadata } from '../dicom/types';

interface EmptyViewportOverlayProps {
  availableSeries: SeriesMetadata[];
  onSelect: (seriesUID: string) => void;
  onClose?: () => void;
}

export default function EmptyViewportOverlay({ availableSeries, onSelect, onClose }: EmptyViewportOverlayProps) {
  // Filter out scouts
  const clinical = availableSeries.filter((s) => !s.isScout);

  if (clinical.length === 0) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/90">
        <span className="text-xs text-neutral-500">No series available</span>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/90">
      <div className="w-56 max-h-[80%] overflow-y-auto rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl">
        <div className="px-3 py-2 border-b border-neutral-700 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-300">
            {onClose ? 'Switch series' : 'Load series'}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300 text-xs leading-none"
            >
              &times;
            </button>
          )}
        </div>
        <div className="py-1">
          {clinical.map((s) => {
            const plane = s.anatomicalPlane.charAt(0).toUpperCase() + s.anatomicalPlane.slice(1);
            return (
              <button
                key={s.seriesInstanceUID}
                onClick={() => onSelect(s.seriesInstanceUID)}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-700 transition-colors"
              >
                <div className="text-xs text-neutral-200 truncate">
                  #{s.seriesNumber} {s.seriesDescription || 'Unnamed'}
                </div>
                <div className="text-[10px] text-neutral-500">
                  {plane} &middot; {s.slices.length} slices
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
