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
  Crosshair,
  RotateCw,
  Contrast,
  FlipHorizontal,
  FlipVertical,
  Play,
  Pause,
  ChevronDown,
  Triangle,
  Circle,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ActiveToolName, LayoutType, OrientationMarkerType } from './ViewportGrid';

type MeasureTool = 'Length' | 'Angle' | 'EllipticalROI';

interface ToolbarProps {
  activeTool: ActiveToolName;
  onToolChange: (tool: ActiveToolName) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  onReset: () => void;
  showSeriesBrowser?: boolean;
  onToggleSeriesBrowser?: () => void;
  showMetadata?: boolean;
  onToggleMetadata?: () => void;
  onOpenSpotlight?: () => void;
  onOpenSettings?: () => void;
  orientationMarkerType?: OrientationMarkerType;
  onOrientationMarkerTypeChange?: (type: OrientationMarkerType) => void;
  invert?: boolean;
  onInvertToggle?: () => void;
  flipH?: boolean;
  onFlipHToggle?: () => void;
  flipV?: boolean;
  onFlipVToggle?: () => void;
  cineEnabled?: boolean;
  onCineToggle?: () => void;
}

const mainTools: { name: ActiveToolName; label: string; icon: React.ReactNode }[] = [
  { name: 'WindowLevel', label: 'W/L', icon: <SunDim className="w-5 h-5" /> },
  { name: 'Zoom', label: 'Zoom', icon: <ZoomIn className="w-5 h-5" /> },
  { name: 'Pan', label: 'Pan', icon: <Move className="w-5 h-5" /> },
];

const measureTools: { name: MeasureTool; label: string; icon: React.ReactNode }[] = [
  { name: 'Length', label: 'Length', icon: <Ruler className="w-5 h-5" /> },
  { name: 'Angle', label: 'Angle', icon: <Triangle className="w-5 h-5" /> },
  { name: 'EllipticalROI', label: 'Elliptical ROI', icon: <Circle className="w-5 h-5" /> },
];

const layouts: { name: LayoutType; label: string; icon: React.ReactNode }[] = [
  { name: '1x1', label: '1\u00d71', icon: <Square className="w-4 h-4" /> },
  { name: '1x2', label: '1\u00d72 Side by Side', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <rect x="1" y="1" width="6" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1" width="6" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { name: '2x1', label: '2\u00d71 Stacked', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <rect x="1" y="1" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="9" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { name: '2x2', label: '2\u00d72 Grid', icon: <Grid2x2 className="w-4 h-4" /> },
  { name: 'mpr', label: 'MPR', icon: <Grid2x2 className="w-4 h-4" /> },
];

const markerTypes: { name: OrientationMarkerType; label: string }[] = [
  { name: 'cube', label: 'Annotated Cube' },
  { name: 'axes', label: 'Axes' },
  { name: 'custom', label: 'Human Model' },
];

export default function Toolbar({
  activeTool, onToolChange,
  layout, onLayoutChange,
  onReset,
  showSeriesBrowser, onToggleSeriesBrowser,
  showMetadata, onToggleMetadata,
  onOpenSpotlight, onOpenSettings,
  orientationMarkerType = 'cube', onOrientationMarkerTypeChange,
  invert = false, onInvertToggle,
  flipH = false, onFlipHToggle,
  flipV = false, onFlipVToggle,
  cineEnabled = false, onCineToggle,
}: ToolbarProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [currentMeasure, setCurrentMeasure] = useState<MeasureTool>('Length');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const markerDropdownRef = useRef<HTMLDivElement>(null);
  const measureDropdownRef = useRef<HTMLDivElement>(null);

  // Track active measurement tool
  useEffect(() => {
    if (activeTool === 'Length' || activeTool === 'Angle' || activeTool === 'EllipticalROI') {
      setCurrentMeasure(activeTool);
    }
  }, [activeTool]);

  // Click-outside handlers
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

  useEffect(() => {
    if (!measureOpen) return;
    function handleClick(e: MouseEvent) {
      if (measureDropdownRef.current && !measureDropdownRef.current.contains(e.target as Node)) {
        setMeasureOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [measureOpen]);

  const isMeasureActive = activeTool === 'Length' || activeTool === 'Angle' || activeTool === 'EllipticalROI';
  const activeMeasureInfo = measureTools.find((m) => m.name === currentMeasure) ?? measureTools[0];

  const btnClass = (active?: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
    }`;

  const toggleClass = (active?: boolean) =>
    `flex items-center gap-1 px-2 py-1.5 rounded text-sm transition-colors ${
      active
        ? 'bg-amber-600/80 text-white'
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

      {/* Main tools: W/L, Zoom, Pan */}
      {mainTools.map((tool) => (
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

      {/* Crosshairs — only in MPR */}
      {layout === 'mpr' && (
        <button
          onClick={() => onToolChange(activeTool === 'Crosshairs' ? 'WindowLevel' : 'Crosshairs')}
          title="Crosshairs"
          className={btnClass(activeTool === 'Crosshairs')}
        >
          <Crosshair className="w-5 h-5" />
          <span className="hidden sm:inline">Crosshairs</span>
        </button>
      )}

      {/* Measurement dropdown */}
      <div className="relative flex items-center" ref={measureDropdownRef}>
        <button
          onClick={() => {
            if (isMeasureActive) {
              onToolChange('WindowLevel');
            } else {
              onToolChange(currentMeasure);
            }
          }}
          title={activeMeasureInfo.label}
          className={`flex items-center gap-1.5 pl-3 pr-1 py-1.5 rounded-l text-sm transition-colors ${
            isMeasureActive
              ? 'bg-blue-600 text-white'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          {activeMeasureInfo.icon}
          <span className="hidden sm:inline">{activeMeasureInfo.label}</span>
        </button>
        <button
          onClick={() => setMeasureOpen(!measureOpen)}
          title="More measurements"
          className={`flex items-center px-1 py-1.5 rounded-r text-sm transition-colors ${
            isMeasureActive
              ? 'bg-blue-600 text-white'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {measureOpen && (
          <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-50 min-w-[180px]">
            {measureTools.map((m) => (
              <button
                key={m.name}
                onClick={() => {
                  setCurrentMeasure(m.name);
                  onToolChange(m.name);
                  setMeasureOpen(false);
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                  activeTool === m.name
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-neutral-700 mx-1" />

      {/* Utility tools: Rotate */}
      <button
        onClick={() => onToolChange(activeTool === 'Rotate' ? 'WindowLevel' : 'Rotate')}
        title="Rotate"
        className={btnClass(activeTool === 'Rotate')}
      >
        <RotateCw className="w-5 h-5" />
      </button>

      {/* Viewport toggles: Invert, Flip H, Flip V */}
      {onInvertToggle && (
        <button onClick={onInvertToggle} title="Invert" className={toggleClass(invert)}>
          <Contrast className="w-5 h-5" />
        </button>
      )}
      {onFlipHToggle && (
        <button onClick={onFlipHToggle} title="Flip Horizontal" className={toggleClass(flipH)}>
          <FlipHorizontal className="w-5 h-5" />
        </button>
      )}
      {onFlipVToggle && (
        <button onClick={onFlipVToggle} title="Flip Vertical" className={toggleClass(flipV)}>
          <FlipVertical className="w-5 h-5" />
        </button>
      )}

      {/* Cine play/pause */}
      {onCineToggle && (
        <button onClick={onCineToggle} title={cineEnabled ? 'Stop Cine' : 'Play Cine'} className={toggleClass(cineEnabled)}>
          {cineEnabled ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
      )}

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
