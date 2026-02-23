import { useEffect, useRef, useCallback, useState } from 'react';
import {
  RenderingEngine,
  Enums,
  volumeLoader,
  setVolumesForViewports,
  cache,
  eventTarget,
  utilities as csCoreUtilities,
} from '@cornerstonejs/core';
import {
  addTool,
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  CrosshairsTool,
  AngleTool,
  EllipticalROITool,
  PlanarRotateTool,
  OrientationMarkerTool,
  Enums as csToolsEnums,
  utilities as csToolsUtilities,
} from '@cornerstonejs/tools';
import type { AnatomicalPlane } from '../dicom/orientationUtils';
import type { StudyMetadata } from '../dicom/types';
import EmptyViewportOverlay from './EmptyViewportOverlay';
import { extractViewportInfo } from './viewportUtils';
import type { ViewportInfo } from './viewportUtils';

const RENDERING_ENGINE_ID = 'dicomRenderingEngine';
const TOOL_GROUP_ID = 'mainTools';
const STACK_VIEWPORT_ID = 'CT_STACK';
const VOLUME_SINGLE_VP_ID = 'CT_SINGLE_VOL';
const MPR_VIEWPORT_IDS = ['CT_AXIAL', 'CT_SAGITTAL', 'CT_CORONAL'];
const GRID_VIEWPORT_IDS = ['VP_GRID_0', 'VP_GRID_1', 'VP_GRID_2', 'VP_GRID_3'];
const VOLUME_ID = 'dicomVolume';

let toolsRegistered = false;

function registerTools() {
  if (toolsRegistered) return;
  addTool(WindowLevelTool);
  addTool(PanTool);
  addTool(ZoomTool);
  addTool(StackScrollTool);
  addTool(LengthTool);
  addTool(CrosshairsTool);
  addTool(AngleTool);
  addTool(EllipticalROITool);
  addTool(PlanarRotateTool);
  addTool(OrientationMarkerTool);
  toolsRegistered = true;
}

const ORIENTATION_MAP: Record<AnatomicalPlane, Enums.OrientationAxis> = {
  axial: Enums.OrientationAxis.AXIAL,
  sagittal: Enums.OrientationAxis.SAGITTAL,
  coronal: Enums.OrientationAxis.CORONAL,
};

export type ActiveToolName =
  | 'WindowLevel' | 'Pan' | 'Zoom'
  | 'Length' | 'Angle' | 'EllipticalROI'
  | 'Crosshairs' | 'Rotate';

export type LayoutType = '1x1' | '1x2' | '2x1' | '2x2' | 'mpr';
export type OrientationMarkerType = 'cube' | 'axes' | 'custom';

const MARKER_TYPE_MAP: Record<OrientationMarkerType, number> = {
  cube: OrientationMarkerTool.OVERLAY_MARKER_TYPES.ANNOTATED_CUBE,
  axes: OrientationMarkerTool.OVERLAY_MARKER_TYPES.AXES,
  custom: OrientationMarkerTool.OVERLAY_MARKER_TYPES.CUSTOM,
};

const ALL_LEFT_CLICK_TOOLS = [
  WindowLevelTool.toolName,
  PanTool.toolName,
  ZoomTool.toolName,
  LengthTool.toolName,
  AngleTool.toolName,
  EllipticalROITool.toolName,
  CrosshairsTool.toolName,
  PlanarRotateTool.toolName,
];

interface ViewportGridProps {
  imageIds: string[];
  activeTool: ActiveToolName;
  layout: LayoutType;
  orientation: AnatomicalPlane;
  primaryAxis: AnatomicalPlane;
  orientationMarkerType?: OrientationMarkerType;
  onResetRef?: React.MutableRefObject<(() => void) | null>;
  invert?: boolean;
  flipH?: boolean;
  flipV?: boolean;
  cineEnabled?: boolean;
  studyMetadata?: StudyMetadata | null;
}

function ViewportOverlay({ label, info }: { label: string; info: ViewportInfo }) {
  const shadow = 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]';
  return (
    <>
      <div className={`absolute top-2 left-2 pointer-events-none z-10 flex flex-col gap-0.5`}>
        <span className={`text-xs font-medium text-neutral-300 ${shadow}`}>
          {label}
        </span>
        {info.total > 0 && (
          <span className={`text-[11px] tabular-nums text-neutral-400 ${shadow}`}>
            {info.current + 1} / {info.total}
          </span>
        )}
      </div>
      {(info.ww > 0 || info.wc !== 0) && (
        <div className={`absolute bottom-2 left-2 pointer-events-none z-10`}>
          <span className={`text-[11px] tabular-nums text-neutral-400 ${shadow}`}>
            W:{Math.round(info.ww)} C:{Math.round(info.wc)}
          </span>
        </div>
      )}
    </>
  );
}

function SliceSlider({ current, total, onChange }: {
  current: number;
  total: number;
  onChange: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (total <= 1) return null;

  const pct = (current / (total - 1)) * 100;

  function indexFromY(clientY: number) {
    const track = trackRef.current;
    if (!track) return current;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.round(ratio * (total - 1));
  }

  function handlePointerDown(e: React.PointerEvent) {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(indexFromY(e.clientY));
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    onChange(indexFromY(e.clientY));
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  return (
    <div
      ref={trackRef}
      className="w-5 shrink-0 flex items-center justify-center bg-neutral-900 cursor-pointer select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="relative w-1 h-full rounded-full bg-neutral-700">
        <div
          className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-500 shadow"
          style={{ top: `calc(${pct}% - 6px)` }}
        />
      </div>
    </div>
  );
}

export default function ViewportGrid({
  imageIds, activeTool, layout, orientation, primaryAxis,
  orientationMarkerType = 'cube', onResetRef,
  invert = false, flipH = false, flipV = false, cineEnabled = false,
  studyMetadata,
}: ViewportGridProps) {
  const singleRef = useRef<HTMLDivElement>(null);
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const gridRef0 = useRef<HTMLDivElement>(null);
  const gridRef1 = useRef<HTMLDivElement>(null);
  const gridRef2 = useRef<HTMLDivElement>(null);
  const gridRef3 = useRef<HTMLDivElement>(null);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const eventCleanupsRef = useRef<(() => void)[]>([]);
  const markerTypeRef = useRef(orientationMarkerType);
  markerTypeRef.current = orientationMarkerType;

  // Refs for state read inside setup functions (after the 50ms setTimeout)
  const activeToolRef = useRef<ActiveToolName>(activeTool);
  activeToolRef.current = activeTool;
  const togglesRef = useRef({ invert: false, flipH: false, flipV: false, cine: false });
  togglesRef.current = { invert, flipH, flipV, cine: cineEnabled };

  const [singleInfo, setSingleInfo] = useState<ViewportInfo>({ current: 0, total: 0, ww: 0, wc: 0 });
  const [mprInfo, setMprInfo] = useState<Record<string, ViewportInfo>>({
    CT_AXIAL: { current: 0, total: 0, ww: 0, wc: 0 },
    CT_SAGITTAL: { current: 0, total: 0, ww: 0, wc: 0 },
    CT_CORONAL: { current: 0, total: 0, ww: 0, wc: 0 },
  });
  // Per-slot state for grid layouts: maps slot index (1,2,3) → seriesUID
  const [gridLoadedSlots, setGridLoadedSlots] = useState<Record<number, string>>({});
  const [gridInfo, setGridInfo] = useState<Record<number, ViewportInfo>>({});
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);

  // Create rendering engine once on mount — avoids WebGL context leaks
  useEffect(() => {
    registerTools();
    renderingEngineRef.current = new RenderingEngine(RENDERING_ENGINE_ID);
    return () => {
      teardownViewports();
      renderingEngineRef.current?.destroy();
      renderingEngineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up viewports when layout/data changes (reuses the single engine)
  useEffect(() => {
    if (!renderingEngineRef.current || imageIds.length === 0) return;

    // Clear secondary grid slots when layout or primary series changes
    setGridLoadedSlots({});
    setGridInfo({});
    setPickingSlot(null);

    const timer = setTimeout(() => {
      setupViewports();
    }, 50);

    return () => {
      clearTimeout(timer);
      teardownViewports();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, imageIds, orientation, primaryAxis]);

  // Expose reset function
  useEffect(() => {
    if (!onResetRef) return;
    onResetRef.current = () => {
      const engine = renderingEngineRef.current;
      if (!engine) return;
      // Stop cine on all viewports
      for (const vp of engine.getViewports()) {
        try { csToolsUtilities.cine.stopClip((vp as any).element); } catch { /* ok */ }
      }
      for (const vp of engine.getViewports()) {
        vp.resetCamera();
        (vp as any).resetProperties?.();
        vp.render();
      }
    };
    return () => { onResetRef.current = null; };
  });

  // Resize viewports when container dimensions change
  useEffect(() => {
    const elements = [
      singleRef.current, axialRef.current, sagittalRef.current, coronalRef.current,
      gridRef0.current, gridRef1.current, gridRef2.current, gridRef3.current,
    ].filter(Boolean) as HTMLDivElement[];
    if (elements.length === 0) return;

    const observer = new ResizeObserver(() => {
      const engine = renderingEngineRef.current;
      if (!engine) return;
      engine.resize();
      for (const vp of engine.getViewports()) {
        vp.resetCamera();
        vp.render();
      }
    });

    for (const el of elements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [layout]);

  // Prevent browser zoom on trackpad pinch and route to Cornerstone zoom
  useEffect(() => {
    const elements = [
      singleRef.current, axialRef.current, sagittalRef.current, coronalRef.current,
      gridRef0.current, gridRef1.current, gridRef2.current, gridRef3.current,
    ].filter(Boolean) as HTMLDivElement[];
    if (elements.length === 0) return;

    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const engine = renderingEngineRef.current;
      if (!engine) return;

      for (const vp of engine.getViewports()) {
        if ((e.currentTarget as Node).contains(e.target as Node)) {
          const factor = 1 - e.deltaY * 0.01;
          const current = vp.getZoom();
          vp.setZoom(current * factor);
          vp.render();
          break;
        }
      }
    }

    function preventGesture(e: Event) {
      e.preventDefault();
    }

    for (const el of elements) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      el.addEventListener('gesturestart', preventGesture);
      el.addEventListener('gesturechange', preventGesture);
    }

    return () => {
      for (const el of elements) {
        el.removeEventListener('wheel', handleWheel);
        el.removeEventListener('gesturestart', preventGesture);
        el.removeEventListener('gesturechange', preventGesture);
      }
    };
  }, [layout]);

  // Apply invert toggle
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;
    for (const vp of engine.getViewports()) {
      vp.setProperties({ invert });
      vp.render();
    }
  }, [invert]);

  // Apply flip horizontal
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;
    for (const vp of engine.getViewports()) {
      vp.setCamera({ flipHorizontal: flipH });
      vp.render();
    }
  }, [flipH]);

  // Apply flip vertical
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;
    for (const vp of engine.getViewports()) {
      vp.setCamera({ flipVertical: flipV });
      vp.render();
    }
  }, [flipV]);

  // Apply cine play/stop
  useEffect(() => {
    const engine = renderingEngineRef.current;
    if (!engine) return;
    for (const vp of engine.getViewports()) {
      const el = (vp as any).element;
      if (!el) continue;
      if (cineEnabled) {
        csToolsUtilities.cine.playClip(el, { framesPerSecond: 15 });
      } else {
        csToolsUtilities.cine.stopClip(el);
      }
    }
  }, [cineEnabled]);

  /** Re-apply active tool + toggle settings after viewport recreation */
  function applyInitialState() {
    // Apply active tool (the useEffect for activeTool fires before tool group exists)
    const toolMap: Record<ActiveToolName, string> = {
      WindowLevel: WindowLevelTool.toolName,
      Pan: PanTool.toolName,
      Zoom: ZoomTool.toolName,
      Length: LengthTool.toolName,
      Angle: AngleTool.toolName,
      EllipticalROI: EllipticalROITool.toolName,
      Crosshairs: CrosshairsTool.toolName,
      Rotate: PlanarRotateTool.toolName,
    };
    setLeftClickTool(toolMap[activeToolRef.current]);

    // Apply toggles
    const engine = renderingEngineRef.current;
    if (!engine) return;
    const t = togglesRef.current;
    for (const vp of engine.getViewports()) {
      if (t.invert) vp.setProperties({ invert: true });
      if (t.flipH) vp.setCamera({ flipHorizontal: true });
      if (t.flipV) vp.setCamera({ flipVertical: true });
      vp.render();
    }
    if (t.cine) {
      for (const vp of engine.getViewports()) {
        const el = (vp as any).element;
        if (el) csToolsUtilities.cine.playClip(el, { framesPerSecond: 15 });
      }
    }
  }

  /** Teardown viewports + tool group but keep the rendering engine alive */
  function teardownViewports() {
    for (const fn of eventCleanupsRef.current) fn();
    eventCleanupsRef.current = [];

    // Remove orientation marker actors before disabling viewports
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (toolGroup) {
      try {
        const tool = toolGroup.getToolInstance(OrientationMarkerTool.toolName) as any;
        const engine = renderingEngineRef.current;
        if (tool?.orientationMarkers && engine) {
          for (const vp of engine.getViewports()) {
            const marker = tool.orientationMarkers[vp.id];
            if (!marker) continue;
            try {
              (vp as any).getRenderer?.()?.removeActor?.(marker.actor);
              marker.orientationWidget?.setEnabled(false);
              marker.orientationWidget?.delete();
              marker.actor?.delete();
            } catch { /* viewport may be partially torn down */ }
          }
          tool.orientationMarkers = {};
        }
        toolGroup.setToolDisabled(OrientationMarkerTool.toolName);
      } catch { /* may already be cleaned up */ }
    }

    ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);

    // Disable viewports (releases WebGL contexts) but keep engine alive
    const engine = renderingEngineRef.current;
    if (engine) {
      const vpIds = engine.getViewports().map((vp) => vp.id);
      for (const id of vpIds) {
        try { engine.disableElement(id); } catch { /* ok */ }
      }
    }

    if (cache.getVolume(VOLUME_ID)) {
      cache.removeVolumeLoadObject(VOLUME_ID);
    }
  }

  function listenToViewport(element: HTMLDivElement, event: string, onUpdate: () => void) {
    element.addEventListener(event, onUpdate);
    eventCleanupsRef.current.push(() => element.removeEventListener(event, onUpdate));
  }

  async function setupViewports() {
    if (imageIds.length === 0) return;

    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) return;

    if (layout === 'mpr') {
      await setupMprViewports(renderingEngine);
    } else if (layout === '1x1') {
      if (orientation === primaryAxis) {
        setupNativeStackViewport(renderingEngine);
      } else {
        await setupReconstructedViewport(renderingEngine);
      }
    } else {
      // Grid layouts: 1x2, 2x1, 2x2
      setupGridViewports(renderingEngine);
    }
  }

  // Primary axis in 1x1 mode: native StackViewport (best quality)
  function setupNativeStackViewport(renderingEngine: RenderingEngine) {
    const element = singleRef.current;
    if (!element) return;

    renderingEngine.enableElement({
      viewportId: STACK_VIEWPORT_ID,
      element,
      type: Enums.ViewportType.STACK,
    });

    const toolGroup = createToolGroup([STACK_VIEWPORT_ID], renderingEngine.id);
    toolGroup?.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });

    const viewport = renderingEngine.getViewport(STACK_VIEWPORT_ID) as any;
    viewport.setStack(imageIds, 0).then(() => {
      renderingEngine.resize();
      viewport.resetCamera();
      viewport.render();
      updateSingleInfo(STACK_VIEWPORT_ID);
      applyInitialState();
    });

    listenToViewport(element, Enums.Events.STACK_NEW_IMAGE, () => {
      updateSingleInfo(STACK_VIEWPORT_ID);
    });
    listenToViewport(element, Enums.Events.VOI_MODIFIED, () => {
      updateSingleInfo(STACK_VIEWPORT_ID);
    });
  }

  // Reconstructed axis in 1x1 mode: single VolumeViewport
  async function setupReconstructedViewport(renderingEngine: RenderingEngine) {
    const element = singleRef.current;
    if (!element) return;

    renderingEngine.setViewports([{
      viewportId: VOLUME_SINGLE_VP_ID,
      element,
      type: Enums.ViewportType.ORTHOGRAPHIC,
      defaultOptions: { orientation: ORIENTATION_MAP[orientation] },
    }]);

    const toolGroup = createToolGroup([VOLUME_SINGLE_VP_ID], renderingEngine.id);
    toolGroup?.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });

    const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds });
    volume.load();

    setVolumesForViewports(
      renderingEngine,
      [{ volumeId: VOLUME_ID }],
      [VOLUME_SINGLE_VP_ID],
    );

    renderingEngine.resize();
    renderingEngine.renderViewports([VOLUME_SINGLE_VP_ID]);
    applyToggles();

    listenToViewport(element, Enums.Events.VOLUME_NEW_IMAGE, () => {
      updateSingleInfo(VOLUME_SINGLE_VP_ID);
    });
    listenToViewport(element, Enums.Events.VOI_MODIFIED, () => {
      updateSingleInfo(VOLUME_SINGLE_VP_ID);
    });

    updateSingleInfo(VOLUME_SINGLE_VP_ID);

    // Volume loading completes asynchronously — update info once ready
    const onVolumeLoaded = () => updateSingleInfo(VOLUME_SINGLE_VP_ID);
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded);
    eventCleanupsRef.current.push(() =>
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded),
    );
  }

  function updateSingleInfo(viewportId: string) {
    const vp = renderingEngineRef.current?.getViewport(viewportId);
    if (!vp) return;
    setSingleInfo(extractViewportInfo(vp));
  }

  async function setupMprViewports(renderingEngine: RenderingEngine) {
    const axialEl = axialRef.current;
    const sagittalEl = sagittalRef.current;
    const coronalEl = coronalRef.current;
    if (!axialEl || !sagittalEl || !coronalEl) return;

    const elements = [axialEl, sagittalEl, coronalEl];

    renderingEngine.setViewports([
      {
        viewportId: MPR_VIEWPORT_IDS[0],
        element: axialEl,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        defaultOptions: { orientation: Enums.OrientationAxis.AXIAL },
      },
      {
        viewportId: MPR_VIEWPORT_IDS[1],
        element: sagittalEl,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        defaultOptions: { orientation: Enums.OrientationAxis.SAGITTAL },
      },
      {
        viewportId: MPR_VIEWPORT_IDS[2],
        element: coronalEl,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        defaultOptions: { orientation: Enums.OrientationAxis.CORONAL },
      },
    ]);

    const toolGroup = createToolGroup(MPR_VIEWPORT_IDS, renderingEngine.id);
    toolGroup?.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });

    const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds });
    volume.load();

    setVolumesForViewports(
      renderingEngine,
      [{ volumeId: VOLUME_ID }],
      MPR_VIEWPORT_IDS,
    );

    renderingEngine.resize();
    renderingEngine.renderViewports(MPR_VIEWPORT_IDS);
    applyToggles();

    const updateAllMprInfo = () => {
      const engine = renderingEngineRef.current;
      if (!engine) return;
      for (const vpId of MPR_VIEWPORT_IDS) {
        const vp = engine.getViewport(vpId);
        if (!vp) continue;
        setMprInfo((prev) => ({ ...prev, [vpId]: extractViewportInfo(vp) }));
      }
    };

    for (let i = 0; i < MPR_VIEWPORT_IDS.length; i++) {
      const vpId = MPR_VIEWPORT_IDS[i];
      const el = elements[i];

      const updateVpInfo = () => {
        const vp = renderingEngineRef.current?.getViewport(vpId);
        if (!vp) return;
        setMprInfo((prev) => ({ ...prev, [vpId]: extractViewportInfo(vp) }));
      };

      listenToViewport(el, Enums.Events.VOLUME_NEW_IMAGE, updateVpInfo);
      listenToViewport(el, Enums.Events.VOI_MODIFIED, updateVpInfo);
      updateVpInfo();
    }

    // Volume loading completes asynchronously — update info once ready
    const onVolumeLoaded = () => updateAllMprInfo();
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded);
    eventCleanupsRef.current.push(() =>
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded),
    );
  }

  // Grid layouts (1x2, 2x1, 2x2): StackViewports, first has images, rest are empty
  function setupGridViewports(renderingEngine: RenderingEngine) {
    const refs = [gridRef0, gridRef1, gridRef2, gridRef3];
    const count = layout === '2x2' ? 4 : 2;
    const elements: HTMLDivElement[] = [];
    const vpIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const el = refs[i].current;
      if (!el) continue;
      elements.push(el);
      vpIds.push(GRID_VIEWPORT_IDS[i]);
    }

    if (elements.length === 0) return;

    // Enable all viewport containers
    for (let i = 0; i < elements.length; i++) {
      renderingEngine.enableElement({
        viewportId: vpIds[i],
        element: elements[i],
        type: Enums.ViewportType.STACK,
      });
    }

    const toolGroup = createToolGroup(vpIds, renderingEngine.id);
    toolGroup?.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });

    // Load images only into the first viewport
    const viewport = renderingEngine.getViewport(vpIds[0]) as any;
    viewport.setStack(imageIds, 0).then(() => {
      renderingEngine.resize();
      viewport.resetCamera();
      viewport.render();
      updateSingleInfo(vpIds[0]);
      applyInitialState();
    });

    listenToViewport(elements[0], Enums.Events.STACK_NEW_IMAGE, () => updateSingleInfo(vpIds[0]));
    listenToViewport(elements[0], Enums.Events.VOI_MODIFIED, () => updateSingleInfo(vpIds[0]));
  }

  function loadSeriesIntoSlot(slotIndex: number, seriesUID: string) {
    if (!studyMetadata) return;
    const series = studyMetadata.series.find((s) => s.seriesInstanceUID === seriesUID);
    if (!series) return;

    const slotImageIds = series.slices.map((s) => s.imageId);
    if (slotImageIds.length === 0) return;

    const engine = renderingEngineRef.current;
    if (!engine) return;

    const vpId = GRID_VIEWPORT_IDS[slotIndex];
    const viewport = engine.getViewport(vpId) as any;
    if (!viewport) return;

    const infoUpdater = slotIndex === 0
      ? () => updateSingleInfo(vpId)
      : () => updateGridSlotInfo(slotIndex, vpId);

    viewport.setStack(slotImageIds, 0).then(() => {
      viewport.resetCamera();
      viewport.render();
      infoUpdater();
    });

    // Find the element for this viewport to attach event listeners
    const refs = [gridRef0, gridRef1, gridRef2, gridRef3];
    const el = refs[slotIndex].current;
    if (el) {
      listenToViewport(el, Enums.Events.STACK_NEW_IMAGE, infoUpdater);
      listenToViewport(el, Enums.Events.VOI_MODIFIED, infoUpdater);
    }

    setGridLoadedSlots((prev) => ({ ...prev, [slotIndex]: seriesUID }));
    setPickingSlot(null);
  }

  function updateGridSlotInfo(slotIndex: number, viewportId: string) {
    const vp = renderingEngineRef.current?.getViewport(viewportId);
    if (!vp) return;
    setGridInfo((prev) => ({ ...prev, [slotIndex]: extractViewportInfo(vp) }));
  }

  function createToolGroup(viewportIds: string[], renderingEngineId: string) {
    const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
    if (!toolGroup) return null;

    toolGroup.addTool(WindowLevelTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addTool(CrosshairsTool.toolName);
    toolGroup.addTool(AngleTool.toolName);
    toolGroup.addTool(EllipticalROITool.toolName);
    toolGroup.addTool(PlanarRotateTool.toolName);
    toolGroup.addTool(OrientationMarkerTool.toolName);
    // Set marker type directly on instance via ref
    const markerTool = toolGroup.getToolInstance(OrientationMarkerTool.toolName) as any;
    if (markerTool) {
      markerTool.configuration.overlayMarkerType = MARKER_TYPE_MAP[markerTypeRef.current];
    }

    for (const id of viewportIds) {
      toolGroup.addViewport(id, renderingEngineId);
    }

    // Enable AFTER viewports are added
    toolGroup.setToolEnabled(OrientationMarkerTool.toolName);

    return toolGroup;
  }

  const setLeftClickTool = useCallback((toolName: string) => {
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (!toolGroup) return;

    for (const name of ALL_LEFT_CLICK_TOOLS) {
      // CrosshairsTool crashes in passive mode if annotations aren't initialized
      if (name === CrosshairsTool.toolName) {
        toolGroup.setToolDisabled(name);
      } else {
        toolGroup.setToolPassive(name);
      }
    }

    // Active tool on left click
    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });

    // Always keep Zoom on right-click and Pan on middle-click
    if (toolName !== ZoomTool.toolName) {
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [
          { mouseButton: csToolsEnums.MouseBindings.Secondary },
          { numTouchPoints: 2 },
        ],
      });
    }
    if (toolName !== PanTool.toolName) {
      toolGroup.setToolActive(PanTool.toolName, {
        bindings: [
          { mouseButton: csToolsEnums.MouseBindings.Auxiliary },
          { numTouchPoints: 3 },
        ],
      });
    }
  }, []);

  useEffect(() => {
    const toolMap: Record<ActiveToolName, string> = {
      WindowLevel: WindowLevelTool.toolName,
      Pan: PanTool.toolName,
      Zoom: ZoomTool.toolName,
      Length: LengthTool.toolName,
      Angle: AngleTool.toolName,
      EllipticalROI: EllipticalROITool.toolName,
      Crosshairs: CrosshairsTool.toolName,
      Rotate: PlanarRotateTool.toolName,
    };
    setLeftClickTool(toolMap[activeTool]);
  }, [activeTool, setLeftClickTool]);

  // Switch orientation marker type at runtime
  useEffect(() => {
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (!toolGroup) return;
    const tool = toolGroup.getToolInstance(OrientationMarkerTool.toolName) as any;
    if (!tool) return;
    const engine = renderingEngineRef.current;
    if (!engine) return;
    tool.configuration.overlayMarkerType = MARKER_TYPE_MAP[orientationMarkerType];
    for (const vp of engine.getViewports()) {
      try {
        tool.updatingOrientationMarker[vp.id] = false;
        tool.addAxisActorInViewport(vp);
      } catch { /* skip viewports not ready */ }
    }
  }, [orientationMarkerType]);

  // Throttle trackpad scroll (trackpads fire many events per gesture)
  useEffect(() => {
    const elements = [
      singleRef.current, axialRef.current, sagittalRef.current, coronalRef.current,
      gridRef0.current, gridRef1.current, gridRef2.current, gridRef3.current,
    ].filter(Boolean) as HTMLDivElement[];
    if (elements.length === 0) return;

    let lastScrollTime = 0;
    function throttleWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) return;
      const now = Date.now();
      if (now - lastScrollTime < 50) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      lastScrollTime = now;
    }

    for (const el of elements) {
      el.addEventListener('wheel', throttleWheel, { capture: true, passive: false });
    }
    return () => {
      for (const el of elements) {
        el.removeEventListener('wheel', throttleWheel, { capture: true } as EventListenerOptions);
      }
    };
  }, [layout]);

  const handleSliceChange = useCallback((viewportId: string, index: number) => {
    const engine = renderingEngineRef.current;
    if (!engine) return;
    const vp = engine.getViewport(viewportId);
    if (!vp) return;
    const current = vp.getSliceIndex();
    const delta = index - current;
    if (delta === 0) return;
    if ('setImageIdIndex' in vp && typeof (vp as any).setImageIdIndex === 'function') {
      (vp as any).setImageIdIndex(index);
    } else {
      csCoreUtilities.scroll(vp, { delta });
    }
    vp.render();
    updateSingleInfo(viewportId);
  }, []);

  // Capitalize first letter for label
  const orientationLabel = orientation.charAt(0).toUpperCase() + orientation.slice(1);
  const isReconstructed = orientation !== primaryAxis;
  const isGridLayout = layout === '1x2' || layout === '2x1' || layout === '2x2';

  if (layout === 'mpr') {
    return (
      <div
        className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px bg-neutral-800"
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex overflow-hidden">
          <SliceSlider current={mprInfo.CT_AXIAL.current} total={mprInfo.CT_AXIAL.total} onChange={(idx) => handleSliceChange(MPR_VIEWPORT_IDS[0], idx)} />
          <div className="relative flex-1 min-w-0 bg-black">
            <div ref={axialRef} className="absolute inset-0" />
            <ViewportOverlay label="Axial" info={mprInfo.CT_AXIAL} />
          </div>
        </div>
        <div className="flex overflow-hidden">
          <SliceSlider current={mprInfo.CT_SAGITTAL.current} total={mprInfo.CT_SAGITTAL.total} onChange={(idx) => handleSliceChange(MPR_VIEWPORT_IDS[1], idx)} />
          <div className="relative flex-1 min-w-0 bg-black">
            <div ref={sagittalRef} className="absolute inset-0" />
            <ViewportOverlay label="Sagittal" info={mprInfo.CT_SAGITTAL} />
          </div>
        </div>
        <div className="flex overflow-hidden">
          <SliceSlider current={mprInfo.CT_CORONAL.current} total={mprInfo.CT_CORONAL.total} onChange={(idx) => handleSliceChange(MPR_VIEWPORT_IDS[2], idx)} />
          <div className="relative flex-1 min-w-0 bg-black">
            <div ref={coronalRef} className="absolute inset-0" />
            <ViewportOverlay label="Coronal" info={mprInfo.CT_CORONAL} />
          </div>
        </div>
        <div className="bg-neutral-900 flex items-center justify-center">
          <span className="text-xs text-neutral-600">3D view (coming soon)</span>
        </div>
      </div>
    );
  }

  if (isGridLayout) {
    const count = layout === '2x2' ? 4 : 2;
    const gridClass =
      layout === '1x2' ? 'grid-cols-2 grid-rows-1'
      : layout === '2x1' ? 'grid-cols-1 grid-rows-2'
      : 'grid-cols-2 grid-rows-2';
    const refs = [gridRef0, gridRef1, gridRef2, gridRef3];

    return (
      <div
        className={`w-full h-full grid ${gridClass} gap-px bg-neutral-800`}
        onContextMenu={(e) => e.preventDefault()}
      >
        {Array.from({ length: count }).map((_, i) => {
          const isSlotLoaded = i === 0 || !!gridLoadedSlots[i];
          const slotInfo = i === 0 ? singleInfo : gridInfo[i];
          const slotSeriesUID = gridLoadedSlots[i];
          const slotSeries = slotSeriesUID && studyMetadata
            ? studyMetadata.series.find((s) => s.seriesInstanceUID === slotSeriesUID)
            : null;
          const slotLabel = i === 0
            ? orientationLabel
            : slotSeries
              ? `#${slotSeries.seriesNumber} ${slotSeries.seriesDescription || ''}`
              : '';
          const hasSeries = studyMetadata && studyMetadata.series.length > 1;
          const isPicking = pickingSlot === i;

          return (
            <div key={i} className="flex overflow-hidden">
              {isSlotLoaded && slotInfo && (
                <SliceSlider current={slotInfo.current} total={slotInfo.total} onChange={(idx) => handleSliceChange(GRID_VIEWPORT_IDS[i], idx)} />
              )}
              <div className="relative flex-1 min-w-0 bg-black">
                <div ref={refs[i]} className="absolute inset-0" />
                {isPicking && hasSeries ? (
                  <EmptyViewportOverlay
                    availableSeries={studyMetadata.series}
                    onSelect={(uid) => loadSeriesIntoSlot(i, uid)}
                    onClose={() => setPickingSlot(null)}
                  />
                ) : isSlotLoaded && slotInfo ? (
                  <>
                    <ViewportOverlay label={slotLabel} info={slotInfo} />
                    {hasSeries && (
                      <button
                        onClick={() => setPickingSlot(i)}
                        className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded bg-neutral-800/70 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 text-xs transition-colors"
                        title="Switch series"
                      >
                        &#x21C4;
                      </button>
                    )}
                  </>
                ) : hasSeries ? (
                  <EmptyViewportOverlay
                    availableSeries={studyMetadata.series}
                    onSelect={(uid) => loadSeriesIntoSlot(i, uid)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-xs text-neutral-600">No other series available</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const singleVpId = orientation === primaryAxis ? STACK_VIEWPORT_ID : VOLUME_SINGLE_VP_ID;

  return (
    <div className="flex w-full h-full" onContextMenu={(e) => e.preventDefault()}>
      <SliceSlider current={singleInfo.current} total={singleInfo.total} onChange={(idx) => handleSliceChange(singleVpId, idx)} />
      <div className="relative flex-1 min-w-0 bg-black overflow-hidden">
        <div ref={singleRef} className="absolute inset-0" />
        <ViewportOverlay
          label={`${orientationLabel}${isReconstructed ? ' (recon)' : ''}`}
          info={singleInfo}
        />
      </div>
    </div>
  );
}
