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
import type { ProviderConfig, ViewportContext } from './llm/types';
import { useLLMChat, type SliceMapping } from './llm/useLLMChat';

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

  // Apply SelectionPlan to viewport (W/L + scroll + switch series if needed)
  useEffect(() => {
    if (!currentPlan || !studyMetadata) return;

    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === currentPlan.targetSeries,
    );

    // If the plan targets a different series, switch the viewport to it
    if (targetSeries) {
      const targetImageIds = targetSeries.slices.map((s) => s.imageId);
      if (targetImageIds.length > 0 && targetImageIds[0] !== imageIds[0]) {
        setImageIds(targetImageIds);
        // W/L and scroll will be applied after the viewport reloads with new imageIds
      }
    }

    // Apply W/L and scroll (may run before or after series switch)
    let attempts = 0;
    const applyPlan = () => {
      try {
        const engine = getRenderingEngine('dicomRenderingEngine');
        if (!engine) {
          // Viewport not ready yet — retry
          if (attempts++ < 5) setTimeout(applyPlan, 200);
          return;
        }
        const viewport = engine.getViewport('CT_STACK') as IStackViewport | undefined;
        if (!viewport) {
          if (attempts++ < 5) setTimeout(applyPlan, 200);
          return;
        }

        const viewportIds = viewport.getImageIds();
        if (viewportIds.length === 0) {
          if (attempts++ < 5) setTimeout(applyPlan, 200);
          return;
        }

        const { windowCenter, windowWidth } = currentPlan;
        viewport.setProperties({ voiRange: { lower: windowCenter - windowWidth / 2, upper: windowCenter + windowWidth / 2 } });

        if (targetSeries) {
          const [rangeStart, rangeEnd] = currentPlan.sliceRange;
          const midInstance = Math.round((rangeStart + rangeEnd) / 2);
          // Find the slice closest to midInstance in the target series
          const sliceIdx = targetSeries.slices.findIndex((s) => s.instanceNumber >= midInstance);
          if (sliceIdx >= 0 && sliceIdx < viewportIds.length) {
            viewport.setImageIdIndex(sliceIdx);
          }
        }

        viewport.render();
      } catch {
        // viewport may not be ready yet — retry
        if (attempts++ < 5) setTimeout(applyPlan, 200);
      }
    };

    // Delay to let series switch + viewport setup take effect
    const timer = setTimeout(applyPlan, 300);
    return () => clearTimeout(timer);
  }, [currentPlan, studyMetadata]); // intentionally omitting imageIds to avoid loop

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
    // Capture current viewport position as context for slice selection
    let viewportContext: ViewportContext | undefined;
    try {
      const engine = getRenderingEngine('dicomRenderingEngine');
      const viewport = engine?.getViewport('CT_STACK') as IStackViewport | undefined;
      if (viewport && studyMetadata) {
        const sliceIndex = viewport.getCurrentImageIdIndex();
        // Find which series is currently displayed
        const currentIds = viewport.getImageIds();
        const currentSeries = studyMetadata.series.find((s) =>
          s.slices.length === currentIds.length && s.slices[0]?.imageId === currentIds[0],
        ) ?? studyMetadata.series.find((s) =>
          s.slices.some((sl) => sl.imageId === currentIds[0]),
        );
        if (currentSeries && sliceIndex >= 0 && sliceIndex < currentSeries.slices.length) {
          const slice = currentSeries.slices[sliceIndex];
          viewportContext = {
            currentInstanceNumber: slice.instanceNumber,
            currentZPosition: slice.imagePositionPatient[2],
            seriesNumber: String(currentSeries.seriesNumber),
            totalSlicesInSeries: currentSeries.slices.length,
          };
          console.log('[DICOMassist] Viewport context:', viewportContext);
        }
      }
    } catch { /* viewport may not be ready */ }

    startAnalysis(hint, viewportContext);
  }, [startAnalysis, studyMetadata]);

  const handleNavigateToSlice = useCallback((mapping: SliceMapping) => {
    try {
      const engine = getRenderingEngine('dicomRenderingEngine');
      if (!engine) return;

      // Try CT_STACK first (native stack mode), fall back to other viewport types
      let viewport = engine.getViewport('CT_STACK') as IStackViewport | undefined;
      if (!viewport) {
        viewport = engine.getViewport('CT_SINGLE_VOL') as IStackViewport | undefined;
      }
      if (!viewport) return;

      const viewportIds = viewport.getImageIds();

      // Strategy 1: Find by instance number in the target series metadata (most reliable)
      if (studyMetadata && currentPlan) {
        const targetSeries = studyMetadata.series.find(
          (s) => String(s.seriesNumber) === currentPlan.targetSeries,
        );
        if (targetSeries) {
          const sliceIdx = targetSeries.slices.findIndex(
            (s) => s.instanceNumber === mapping.instanceNumber,
          );
          if (sliceIdx >= 0 && sliceIdx < viewportIds.length) {
            console.log(`[Navigate] Instance #${mapping.instanceNumber} → series index ${sliceIdx}`);
            viewport.setImageIdIndex(sliceIdx);
            viewport.render();
            return;
          }
        }
      }

      // Strategy 2: Direct imageId match
      const exactIdx = viewportIds.indexOf(mapping.imageId);
      if (exactIdx >= 0) {
        console.log(`[Navigate] Exact imageId match at index ${exactIdx}`);
        viewport.setImageIdIndex(exactIdx);
        viewport.render();
        return;
      }

      // Strategy 3: Partial imageId match (Cornerstone may add suffixes like &frame=0)
      const partialIdx = viewportIds.findIndex(
        (id) => id.includes(mapping.imageId) || mapping.imageId.includes(id),
      );
      if (partialIdx >= 0) {
        console.log(`[Navigate] Partial imageId match at index ${partialIdx}`);
        viewport.setImageIdIndex(partialIdx);
        viewport.render();
        return;
      }

      console.warn(`[Navigate] Failed to find slice for instance #${mapping.instanceNumber}`, {
        mappingImageId: mapping.imageId,
        viewportIdCount: viewportIds.length,
        viewportIdSample: viewportIds.slice(0, 3),
      });
    } catch {
      // viewport may not be ready
    }
  }, [studyMetadata, currentPlan]);

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
            onNavigateToSlice={handleNavigateToSlice}
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
