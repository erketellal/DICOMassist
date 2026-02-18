import { useState, useEffect, useCallback, useRef } from 'react';
import { imageLoader } from '@cornerstonejs/core';
import { initCornerstone } from './viewer/CornerstoneInit';
import DicomDropZone, { type LoadResult } from './viewer/DicomDropZone';
import ViewportGrid, { type ActiveToolName, type LayoutType } from './viewer/ViewportGrid';
import Toolbar from './viewer/Toolbar';
import LoadingOverlay from './viewer/LoadingOverlay';
import MetadataPanel from './ui/MetadataPanel';
import type { AnatomicalPlane } from './dicom/orientationUtils';
import type { StudyMetadata } from './dicom/types';

export default function App() {
  const [ready, setReady] = useState(false);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [primaryAxis, setPrimaryAxis] = useState<AnatomicalPlane>('axial');
  const [orientation, setOrientation] = useState<AnatomicalPlane>('axial');
  const [activeTool, setActiveTool] = useState<ActiveToolName>('WindowLevel');
  const [layout, setLayout] = useState<LayoutType>('stack');
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });
  const [studyMetadata, setStudyMetadata] = useState<StudyMetadata | null>(null);
  const [showMetadata, setShowMetadata] = useState(true);
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    initCornerstone().then(() => setReady(true));
  }, []);

  const handleFilesLoaded = useCallback((result: LoadResult) => {
    setImageIds(result.imageIds);
    setPrimaryAxis(result.primaryAxis);
    setOrientation(result.primaryAxis); // default to primary axis
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

  const handleReset = useCallback(() => {
    resetRef.current?.();
  }, []);

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
        onToggleMetadata={studyMetadata ? () => setShowMetadata((v) => !v) : undefined}
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
      </div>
    </div>
  );
}
