import {
  SunDim,
  Move,
  ZoomIn,
  Ruler,
  RotateCcw,
  LayoutGrid,
  Square,
  Grid2x2,
  Info,
  Search,
  Settings,
  Compass,
  Layers,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ActiveToolName, LayoutType, OrientationMarkerType } from './ViewportGrid';
import type { AnatomicalPlane } from '../dicom/orientationUtils';

interface ToolbarProps {
  activeTool: ActiveToolName;
  onToolChange: (tool: ActiveToolName) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  orientation: AnatomicalPlane;
  onOrientationChange: (orientation: AnatomicalPlane) => void;
  primaryAxis: AnatomicalPlane;
  onReset: () => void;
  showSeriesBrowser?: boolean;
  onToggleSeriesBrowser?: () => void;
  showMetadata?: boolean;
  onToggleMetadata?: () => void;
  onOpenSpotlight?: () => void;
  onOpenSettings?: () => void;
  orientationMarkerType?: OrientationMarkerType;
  onOrientationMarkerTypeChange?: (type: OrientationMarkerType) => void;
}

const tools: { name: ActiveToolName; label: string; icon: React.ReactNode }[] = [
  { name: 'WindowLevel', label: 'W/L', icon: <SunDim className="w-5 h-5" /> },
  { name: 'Zoom', label: 'Zoom', icon: <ZoomIn className="w-5 h-5" /> },
  { name: 'Pan', label: 'Pan', icon: <Move className="w-5 h-5" /> },
  { name: 'Length', label: 'Length', icon: <Ruler className="w-5 h-5" /> },
];

const layouts: { name: LayoutType; label: string; icon: React.ReactNode }[] = [
  { name: 'stack', label: 'Stack (1×1)', icon: <Square className="w-4 h-4" /> },
  { name: 'mpr', label: 'MPR (2×2)', icon: <Grid2x2 className="w-4 h-4" /> },
];

const markerTypes: { name: OrientationMarkerType; label: string }[] = [
  { name: 'cube', label: 'Annotated Cube' },
  { name: 'axes', label: 'Axes' },
  { name: 'custom', label: 'Human Model' },
];

const orientations: { name: AnatomicalPlane; label: string; short: string }[] = [
  { name: 'axial', label: 'Axial', short: 'Ax' },
  { name: 'sagittal', label: 'Sagittal', short: 'Sag' },
  { name: 'coronal', label: 'Coronal', short: 'Cor' },
];

export default function Toolbar({
  activeTool, onToolChange,
  layout, onLayoutChange,
  orientation, onOrientationChange,
  primaryAxis,
  onReset,
  showSeriesBrowser, onToggleSeriesBrowser,
  showMetadata, onToggleMetadata,
  onOpenSpotlight, onOpenSettings,
  orientationMarkerType = 'cube', onOrientationMarkerTypeChange,
}: ToolbarProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const markerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layoutOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLayoutOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [layoutOpen]);

  useEffect(() => {
    if (!markerOpen) return;
    function handleClick(e: MouseEvent) {
      if (markerDropdownRef.current && !markerDropdownRef.current.contains(e.target as Node)) {
        setMarkerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [markerOpen]);

  const btnClass = (active?: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
    }`;

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-neutral-900 border-b border-neutral-800">
      {/* Series browser toggle — far left */}
      {onToggleSeriesBrowser && (
        <>
          <button
            onClick={onToggleSeriesBrowser}
            title="Series browser"
            className={btnClass(showSeriesBrowser)}
          >
            <Layers className="w-5 h-5" />
            <span className="hidden sm:inline">Series</span>
          </button>
          <div className="w-px h-6 bg-neutral-700 mx-1" />
        </>
      )}

      {tools.map((tool) => (
        <button
          key={tool.name}
          onClick={() => onToolChange(activeTool === tool.name && tool.name !== 'WindowLevel' ? 'WindowLevel' : tool.name)}
          title={tool.label}
          className={btnClass(activeTool === tool.name)}
        >
          {tool.icon}
          <span className="hidden sm:inline">{tool.label}</span>
        </button>
      ))}

      <div className="w-px h-6 bg-neutral-700 mx-1" />

      <button
        onClick={onReset}
        title="Reset viewport"
        className={btnClass()}
      >
        <RotateCcw className="w-5 h-5" />
        <span className="hidden sm:inline">Reset</span>
      </button>

      <div className="w-px h-6 bg-neutral-700 mx-1" />

      {/* Orientation buttons — only in stack mode */}
      {layout === 'stack' && (
        <>
          <div className="flex items-center bg-neutral-800 rounded p-0.5">
            {orientations.map((o) => (
              <button
                key={o.name}
                onClick={() => onOrientationChange(o.name)}
                title={`${o.label}${o.name === primaryAxis ? ' (native)' : ' (reconstructed)'}`}
                className={`relative px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  orientation === o.name
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {o.short}
                {o.name === primaryAxis && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-400 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-neutral-700 mx-1" />
        </>
      )}

      {/* Layout dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setLayoutOpen(!layoutOpen)}
          title="Layout"
          className={btnClass()}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="hidden sm:inline">Layout</span>
        </button>
        {layoutOpen && (
          <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-50 min-w-[180px]">
            {layouts.map((l) => (
              <button
                key={l.name}
                onClick={() => {
                  onLayoutChange(l.name);
                  setLayoutOpen(false);
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                  layout === l.name
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {l.icon}
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Orientation marker type dropdown */}
      {onOrientationMarkerTypeChange && (
        <div className="relative" ref={markerDropdownRef}>
          <button
            onClick={() => setMarkerOpen(!markerOpen)}
            title="Orientation marker"
            className={btnClass()}
          >
            <Compass className="w-5 h-5" />
          </button>
          {markerOpen && (
            <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-50 min-w-[180px]">
              {markerTypes.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    onOrientationMarkerTypeChange(m.name);
                    setMarkerOpen(false);
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                    orientationMarkerType === m.name
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Analyze button (Cmd+K) */}
      {onOpenSpotlight && (
        <button
          onClick={onOpenSpotlight}
          title="Analyze (Cmd+K)"
          className={btnClass()}
        >
          <Search className="w-5 h-5" />
          <span className="hidden sm:inline">Analyze</span>
        </button>
      )}

      {/* Study Info toggle */}
      {onToggleMetadata && (
        <button
          onClick={onToggleMetadata}
          title="Study Info"
          className={btnClass(showMetadata)}
        >
          <Info className="w-5 h-5" />
        </button>
      )}

      {/* Settings */}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          title="LLM Settings"
          className={btnClass()}
        >
          <Settings className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
