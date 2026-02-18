import { useState, useEffect, useCallback, useRef } from 'react';
import { imageLoader, getRenderingEngine } from '@cornerstonejs/core';
import type { IStackViewport } from '@cornerstonejs/core';
import { initCornerstone } from './viewer/CornerstoneInit';
import DicomDropZone, { type LoadResult } from './viewer/DicomDropZone';
import ViewportGrid, { type ActiveToolName, type LayoutType } from './viewer/ViewportGrid';
import Toolbar from './viewer/Toolbar';
import LoadingOverlay from './viewer/LoadingOverlay';
import MetadataPanel from './ui/MetadataPanel';
import SpotlightPrompt from './ui/SpotlightPrompt';
import ChatSidebar from './ui/ChatSidebar';
import SettingsPanel from './ui/SettingsPanel';
import type { AnatomicalPlane } from './dicom/orientationUtils';
import type { StudyMetadata } from './dicom/types';
import type { ProviderConfig } from './llm/types';
import { useLLMChat } from './llm/useLLMChat';

const STORAGE_KEY = 'dicomassist-llm-config';

function loadConfig(): ProviderConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { provider: 'ollama' };
}

function saveConfig(config: ProviderConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [primaryAxis, setPrimaryAxis] = useState<AnatomicalPlane>('axial');
  const [orientation, setOrientation] = useState<AnatomicalPlane>('axial');
  const [activeTool, setActiveTool] = useState<ActiveToolName>('WindowLevel');
  const [layout, setLayout] = useState<LayoutType>('stack');
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });
  const [studyMetadata, setStudyMetadata] = useState<StudyMetadata | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(loadConfig);
  const resetRef = useRef<(() => void) | null>(null);

  const {
    messages,
    status,
    statusText,
    error,
    currentPlan,
    pipeline,
    startAnalysis,
    sendFollowUp,
    clearChat,
  } = useLLMChat(studyMetadata, providerConfig);

  useEffect(() => {
    initCornerstone().then(() => setReady(true));
  }, []);

  const handleFilesLoaded = useCallback((result: LoadResult) => {
    setImageIds(result.imageIds);
    setPrimaryAxis(result.primaryAxis);
    setOrientation(result.primaryAxis);
    setStudyMetadata(result.studyMetadata);
  }, []);

  // Prefetch all images after they're set
  useEffect(() => {
    if (imageIds.length === 0) return;

    let cancelled = false;
    const total = imageIds.length;
    let loaded = 0;

    setPrefetchProgress({ loaded: 0, total });

    const BATCH_SIZE = 6;
    async function prefetch() {
      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = imageIds.slice(i, i + BATCH_SIZE);
        const promises = batch.map((id) =>
          imageLoader.loadAndCacheImage(id).catch(() => {})
        );
        await Promise.all(promises);
        loaded += batch.length;
        if (!cancelled) {
          setPrefetchProgress({ loaded: Math.min(loaded, total), total });
        }
      }
    }

    prefetch();

    return () => {
      cancelled = true;
    };
  }, [imageIds]);

  // Apply SelectionPlan to viewport (W/L + scroll)
  useEffect(() => {
    if (!currentPlan || imageIds.length === 0) return;

    try {
      const engine = getRenderingEngine('dicomRenderingEngine');
      if (!engine) return;
      const viewport = engine.getViewport('CT_STACK') as IStackViewport | undefined;
      if (!viewport) return;

      // Apply window/level
      const { windowCenter, windowWidth } = currentPlan;
      viewport.setProperties({ voiRange: { lower: windowCenter - windowWidth / 2, upper: windowCenter + windowWidth / 2 } });

      // Scroll to middle of selected range
      if (studyMetadata) {
        const series = studyMetadata.series.find(
          (s) => String(s.seriesNumber) === currentPlan.targetSeries,
        );
        if (series) {
          const [rangeStart, rangeEnd] = currentPlan.sliceRange;
          const midInstance = Math.round((rangeStart + rangeEnd) / 2);
          // Find index of the closest slice to midInstance
          const sliceIdx = series.slices.findIndex((s) => s.instanceNumber >= midInstance);
          if (sliceIdx >= 0) {
            viewport.setImageIdIndex(sliceIdx);
          }
        }
      }

      viewport.render();
    } catch {
      // Viewport may not be ready yet
    }
  }, [currentPlan, imageIds, studyMetadata]);

  // Auto-open chat when analysis completes
  useEffect(() => {
    if (messages.length > 0 && status === 'idle') {
      setShowChat(true);
      setSpotlightOpen(false);
    }
  }, [messages.length, status]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'k') {
        e.preventDefault();
        if (imageIds.length > 0 && studyMetadata) {
          setSpotlightOpen(true);
        }
      }

      if (mod && e.key === 'b') {
        e.preventDefault();
        setShowChat((v) => !v);
      }

      if (e.key === 'Escape') {
        if (spotlightOpen) {
          setSpotlightOpen(false);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageIds.length, studyMetadata, spotlightOpen, settingsOpen]);

  const handleReset = useCallback(() => {
    resetRef.current?.();
  }, []);

  const handleConfigChange = useCallback((config: ProviderConfig) => {
    setProviderConfig(config);
    saveConfig(config);
  }, []);

  const handleSpotlightSubmit = useCallback((hint: string) => {
    startAnalysis(hint);
  }, [startAnalysis]);

  // Show chat or metadata panel (mutual exclusion)
  const handleToggleChat = useCallback(() => {
    setShowChat((v) => {
      if (!v) setShowMetadata(false);
      return !v;
    });
  }, []);

  const handleToggleMetadata = useCallback(() => {
    if (!studyMetadata) return;
    setShowMetadata((v) => {
      if (!v) setShowChat(false);
      return !v;
    });
  }, [studyMetadata]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        Initializing viewer...
      </div>
    );
  }

  if (imageIds.length === 0) {
    return <DicomDropZone onFilesLoaded={handleFilesLoaded} />;
  }

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        layout={layout}
        onLayoutChange={setLayout}
        orientation={orientation}
        onOrientationChange={setOrientation}
        primaryAxis={primaryAxis}
        onReset={handleReset}
        showMetadata={showMetadata}
        onToggleMetadata={studyMetadata ? handleToggleMetadata : undefined}
        showChat={showChat}
        onToggleChat={handleToggleChat}
        onOpenSpotlight={() => setSpotlightOpen(true)}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 relative overflow-hidden">
          <div className="absolute inset-0">
            <ViewportGrid
              imageIds={imageIds}
              activeTool={activeTool}
              layout={layout}
              orientation={orientation}
              primaryAxis={primaryAxis}
              onResetRef={resetRef}
            />
          </div>
          <LoadingOverlay
            loaded={prefetchProgress.loaded}
            total={prefetchProgress.total}
          />
        </div>
        {showMetadata && studyMetadata && (
          <MetadataPanel
            metadata={studyMetadata}
            onClose={() => setShowMetadata(false)}
          />
        )}
        {showChat && (
          <ChatSidebar
            messages={messages}
            status={status}
            statusText={statusText}
            error={error}
            pipeline={pipeline}
            onSendFollowUp={sendFollowUp}
            onClear={clearChat}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>

      {/* Overlays */}
      <SpotlightPrompt
        open={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onSubmit={handleSpotlightSubmit}
        status={status}
        statusText={statusText}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={providerConfig}
        onConfigChange={handleConfigChange}
      />
    </div>
  );
}
