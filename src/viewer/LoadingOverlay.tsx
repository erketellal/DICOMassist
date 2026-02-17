interface LoadingOverlayProps {
  loaded: number;
  total: number;
}

export default function LoadingOverlay({ loaded, total }: LoadingOverlayProps) {
  if (loaded >= total) return null;

  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center gap-3 bg-neutral-900/90 border border-neutral-700 rounded-lg px-4 py-2 shadow-lg">
      <div className="w-32 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-neutral-400 tabular-nums">
        Caching {loaded}/{total}
      </span>
    </div>
  );
}
