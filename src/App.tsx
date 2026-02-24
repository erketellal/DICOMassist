import { useState, useEffect, useCallback, useRef } from 'react';
import { imageLoader, getRenderingEngine } from '@cornerstonejs/core';
import type { IStackViewport } from '@cornerstonejs/core';
import { initCornerstone } from './viewer/CornerstoneInit';
import DicomDropZone, { type LoadResult } from './viewer/DicomDropZone';
import ViewportGrid, { type ActiveToolName, type LayoutType, type OrientationMarkerType } from './viewer/ViewportGrid';
import Toolbar from './viewer/Toolbar';
import LoadingOverlay from './viewer/LoadingOverlay';
import MetadataPanel from './ui/MetadataPanel';
import SeriesBrowser from './ui/SeriesBrowser';
import ChatSidebar, { type ChatSidebarHandle } from './ui/ChatSidebar';
import SettingsPanel from './ui/SettingsPanel';
import DisclaimerModal from './ui/DisclaimerModal';
import LandingScreen from './ui/LandingScreen';
import type { AnatomicalPlane } from './dicom/orientationUtils';
import type { StudyMetadata } from './dicom/types';
import type { ProviderConfig, ViewportContext } from './llm/types';
import { useLLMChat, type SliceMapping } from './llm/useLLMChat';
import { logger } from './utils/logger';

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
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [primaryAxis, setPrimaryAxis] = useState<AnatomicalPlane>('axial');
  const [orientation, setOrientation] = useState<AnatomicalPlane>('axial');
  const [activeTool, setActiveTool] = useState<ActiveToolName>('WindowLevel');
  const [layout, setLayout] = useState<LayoutType>('1x1');
  const [orientationMarkerType, setOrientationMarkerType] = useState<OrientationMarkerType>('cube');
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });
  const [studyMetadata, setStudyMetadata] = useState<StudyMetadata | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(loadConfig);
  const [showSeriesBrowser, setShowSeriesBrowser] = useState(false);
  const [activeSeriesUID, setActiveSeriesUID] = useState<string>('');
  const [invert, setInvert] = useState(false);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cineEnabled, setCineEnabled] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle>(null);

  const {
    messages,
    status,
    statusText,
    error,
    currentPlan,
    pipeline,
    startAnalysis,
    confirmPlan,
    cancelPlan,
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
    setActiveSeriesUID(result.studyMetadata.primarySeriesUID);
    if (result.studyMetadata.series.length > 1) {
      setShowSeriesBrowser(true);
    }
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
      setActiveSeriesUID(targetSeries.seriesInstanceUID);
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

  // When plan arrives, ensure sidebar is open
  useEffect(() => {
    if (status === 'awaiting-confirmation') {
      setShowChat(true);
      setShowMetadata(false);
    }
  }, [status]);

  // Auto-open chat when analysis completes
  useEffect(() => {
    if (messages.length > 0 && status === 'idle') {
      setShowChat(true);
    }
  }, [messages.length, status]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'k') {
        e.preventDefault();
        if (imageIds.length > 0 && studyMetadata) {
          setShowChat(true);
          setShowMetadata(false);
          // Focus the input after the sidebar renders
          requestAnimationFrame(() => chatSidebarRef.current?.focusInput());
        }
      }

      if (e.key === 'Escape') {
        if (status === 'awaiting-confirmation') {
          cancelPlan();
        } else if (settingsOpen) {
          setSettingsOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageIds.length, studyMetadata, settingsOpen, status, cancelPlan]);

  // Fall back to W/L if leaving MPR while Crosshairs is active
  useEffect(() => {
    if (layout !== 'mpr' && activeTool === 'Crosshairs') {
      setActiveTool('WindowLevel');
    }
  }, [layout, activeTool]);

  const handleReset = useCallback(() => {
    resetRef.current?.();
    setInvert(false);
    setFlipH(false);
    setFlipV(false);
    setCineEnabled(false);
  }, []);

  const handleAcceptDisclaimer = useCallback(() => {
    setDisclaimerAccepted(true);
  }, []);

  const handleConfigChange = useCallback((config: ProviderConfig) => {
    setProviderConfig(config);
    saveConfig(config);
  }, []);

  const handleStartAnalysis = useCallback((hint: string) => {
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
          logger.log('[DICOMassist] Viewport context:', viewportContext);
        }
      }
    } catch { /* viewport may not be ready */ }

    startAnalysis(hint, viewportContext);
  }, [startAnalysis, studyMetadata]);

  const navigateTargetRef = useRef<{ instanceNumber: number; imageId: string } | null>(null);

  const handleNavigateToSlice = useCallback((mapping: SliceMapping) => {
    if (!studyMetadata || !currentPlan) return;

    // Find the target series from the plan that generated this mapping
    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === currentPlan.targetSeries,
    );
    if (!targetSeries) return;

    // Check if we need to switch series first
    const needsSeriesSwitch = targetSeries.seriesInstanceUID !== activeSeriesUID;

    if (needsSeriesSwitch) {
      logger.log(`[Navigate] Switching from series ${activeSeriesUID} → ${targetSeries.seriesInstanceUID} (${targetSeries.seriesDescription})`);
      // Store the target so we can scroll after series loads
      navigateTargetRef.current = { instanceNumber: mapping.instanceNumber, imageId: mapping.imageId };
      const targetImageIds = targetSeries.slices.map((s) => s.imageId);
      setImageIds(targetImageIds);
      setActiveSeriesUID(targetSeries.seriesInstanceUID);
      const plane = targetSeries.anatomicalPlane === 'oblique' ? 'axial' : targetSeries.anatomicalPlane;
      setPrimaryAxis(plane);
      setOrientation(plane);
      setLayout('1x1');
      return; // scrollToSlice will be called by the effect below once images load
    }

    // Already on the correct series — scroll directly
    scrollToSlice(mapping.instanceNumber, mapping.imageId, targetSeries);
  }, [studyMetadata, currentPlan, activeSeriesUID]);

  // After a series switch triggered by slice navigation, scroll to the target slice
  useEffect(() => {
    const target = navigateTargetRef.current;
    if (!target || !studyMetadata || !currentPlan) return;

    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === currentPlan.targetSeries,
    );
    if (!targetSeries || targetSeries.seriesInstanceUID !== activeSeriesUID) return;

    // Series is now active — try to scroll (with retries for viewport readiness)
    let attempts = 0;
    const tryScroll = () => {
      const success = scrollToSlice(target.instanceNumber, target.imageId, targetSeries);
      if (!success && attempts++ < 5) {
        setTimeout(tryScroll, 200);
      } else {
        navigateTargetRef.current = null;
      }
    };
    const timer = setTimeout(tryScroll, 100);
    return () => clearTimeout(timer);
  }, [activeSeriesUID, studyMetadata, currentPlan]);

  function scrollToSlice(
    instanceNumber: number,
    imageId: string,
    targetSeries: StudyMetadata['series'][number],
  ): boolean {
    try {
      const engine = getRenderingEngine('dicomRenderingEngine');
      if (!engine) return false;

      let viewport = engine.getViewport('CT_STACK') as IStackViewport | undefined;
      if (!viewport) {
        viewport = engine.getViewport('CT_SINGLE_VOL') as IStackViewport | undefined;
      }
      if (!viewport) return false;

      const viewportIds = viewport.getImageIds();
      if (viewportIds.length === 0) return false;

      // Strategy 1: Find by instance number in the target series metadata
      const sliceIdx = targetSeries.slices.findIndex(
        (s) => s.instanceNumber === instanceNumber,
      );
      if (sliceIdx >= 0 && sliceIdx < viewportIds.length) {
        logger.log(`[Navigate] Instance #${instanceNumber} → series index ${sliceIdx}`);
        viewport.setImageIdIndex(sliceIdx);
        viewport.render();
        return true;
      }

      // Strategy 2: Direct imageId match
      const exactIdx = viewportIds.indexOf(imageId);
      if (exactIdx >= 0) {
        logger.log(`[Navigate] Exact imageId match at index ${exactIdx}`);
        viewport.setImageIdIndex(exactIdx);
        viewport.render();
        return true;
      }

      // Strategy 3: Partial imageId match
      const partialIdx = viewportIds.findIndex(
        (id) => id.includes(imageId) || imageId.includes(id),
      );
      if (partialIdx >= 0) {
        logger.log(`[Navigate] Partial imageId match at index ${partialIdx}`);
        viewport.setImageIdIndex(partialIdx);
        viewport.render();
        return true;
      }

      logger.warn(`[Navigate] Failed to find slice for instance #${instanceNumber}`, {
        imageId,
        viewportIdCount: viewportIds.length,
      });
      return false;
    } catch {
      return false;
    }
  }

  const handleToggleMetadata = useCallback(() => {
    if (!studyMetadata) return;
    setShowMetadata((v) => {
      if (!v) setShowChat(false);
      return !v;
    });
  }, [studyMetadata]);

  const handleSelectSeries = useCallback((seriesUID: string) => {
    if (!studyMetadata || seriesUID === activeSeriesUID) return;
    const series = studyMetadata.series.find((s) => s.seriesInstanceUID === seriesUID);
    if (!series) return;
    setImageIds(series.slices.map((s) => s.imageId));
    setActiveSeriesUID(seriesUID);
    const plane = series.anatomicalPlane === 'oblique' ? 'axial' : series.anatomicalPlane;
    setPrimaryAxis(plane);
    setOrientation(plane);
    setLayout('1x1');
  }, [studyMetadata, activeSeriesUID]);

  if (!ready) {
    return (
      <>
        {!disclaimerAccepted && <DisclaimerModal onAccept={handleAcceptDisclaimer} />}
        <div className="flex items-center justify-center h-full text-neutral-500">
          Initializing viewer...
        </div>
      </>
    );
  }

  if (imageIds.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        {!disclaimerAccepted && <DisclaimerModal onAccept={handleAcceptDisclaimer} />}
        <LandingScreen>
          <DicomDropZone onFilesLoaded={handleFilesLoaded} />
        </LandingScreen>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        layout={layout}
        onLayoutChange={setLayout}
        onReset={handleReset}
        showSeriesBrowser={showSeriesBrowser}
        onToggleSeriesBrowser={studyMetadata && studyMetadata.series.length > 1 ? () => setShowSeriesBrowser((v) => !v) : undefined}
        showMetadata={showMetadata}
        onToggleMetadata={studyMetadata ? handleToggleMetadata : undefined}
        onOpenSpotlight={() => {
          setShowChat(true);
          setShowMetadata(false);
          requestAnimationFrame(() => chatSidebarRef.current?.focusInput());
        }}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        orientationMarkerType={orientationMarkerType}
        onOrientationMarkerTypeChange={setOrientationMarkerType}
        invert={invert}
        onInvertToggle={() => setInvert((v) => !v)}
        flipH={flipH}
        onFlipHToggle={() => setFlipH((v) => !v)}
        flipV={flipV}
        onFlipVToggle={() => setFlipV((v) => !v)}
        cineEnabled={cineEnabled}
        onCineToggle={() => setCineEnabled((v) => !v)}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {showSeriesBrowser && studyMetadata && studyMetadata.series.length > 1 && (
          <SeriesBrowser
            metadata={studyMetadata}
            activeSeriesUID={activeSeriesUID}
            onSelectSeries={handleSelectSeries}
            onClose={() => setShowSeriesBrowser(false)}
          />
        )}
        <div className="flex-1 min-w-0 relative overflow-hidden">
          <div className="absolute inset-0">
            <ViewportGrid
              imageIds={imageIds}
              activeTool={activeTool}
              layout={layout}
              orientation={orientation}
              primaryAxis={primaryAxis}
              orientationMarkerType={orientationMarkerType}
              onResetRef={resetRef}
              invert={invert}
              flipH={flipH}
              flipV={flipV}
              cineEnabled={cineEnabled}
              studyMetadata={studyMetadata}
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
            activeSeriesUID={activeSeriesUID}
            onClose={() => setShowMetadata(false)}
          />
        )}
        {showChat && (
          <ChatSidebar
            ref={chatSidebarRef}
            messages={messages}
            status={status}
            statusText={statusText}
            error={error}
            pipeline={pipeline}
            currentPlan={currentPlan}
            studyMetadata={studyMetadata}
            onConfirmPlan={confirmPlan}
            onCancelPlan={cancelPlan}
            onStartAnalysis={handleStartAnalysis}
            onSendFollowUp={sendFollowUp}
            onClear={clearChat}
            onClose={() => setShowChat(false)}
            onNavigateToSlice={handleNavigateToSlice}
          />
        )}
      </div>

      {/* Overlays */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={providerConfig}
        onConfigChange={handleConfigChange}
      />
    </div>
  );
}
