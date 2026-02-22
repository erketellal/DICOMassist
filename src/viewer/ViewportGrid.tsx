import { useEffect, useRef, useCallback, useState } from 'react';
import {
  RenderingEngine,
  Enums,
  volumeLoader,
  setVolumesForViewports,
  cache,
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

interface ViewportInfo {
  current: number;
  total: number;
  ww: number;
  wc: number;
}

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

export default function ViewportGrid({
  imageIds, activeTool, layout, orientation, primaryAxis,
  orientationMarkerType = 'cube', onResetRef,
  invert = false, flipH = false, flipV = false, cineEnabled = false,
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

  // Set up rendering engine + viewports
  useEffect(() => {
    registerTools();

    const timer = setTimeout(() => {
      setupViewports();
    }, 50);

    return () => {
      clearTimeout(timer);
      cleanup();
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
      renderingEngineRef.current?.resize();
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

  function cleanup() {
    for (const fn of eventCleanupsRef.current) fn();
    eventCleanupsRef.current = [];

    // Remove orientation marker actors from renderers before destroying
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
    renderingEngineRef.current?.destroy();
    renderingEngineRef.current = null;
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

    const renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
    renderingEngineRef.current = renderingEngine;

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

    renderingEngine.renderViewports([VOLUME_SINGLE_VP_ID]);
    applyToggles();

    listenToViewport(element, Enums.Events.VOLUME_NEW_IMAGE, () => {
      updateSingleInfo(VOLUME_SINGLE_VP_ID);
    });
    listenToViewport(element, Enums.Events.VOI_MODIFIED, () => {
      updateSingleInfo(VOLUME_SINGLE_VP_ID);
    });

    updateSingleInfo(VOLUME_SINGLE_VP_ID);
  }

  function updateSingleInfo(viewportId: string) {
    const vp = renderingEngineRef.current?.getViewport(viewportId);
    if (!vp) return;
    const props = vp.getProperties() as any;
    const { lower, upper } = props?.voiRange ?? { lower: 0, upper: 0 };
    const ww = upper - lower;
    const wc = lower + ww / 2;
    setSingleInfo({
      current: vp.getSliceIndex(),
      total: vp.getNumberOfSlices(),
      ww,
      wc,
    });
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

    renderingEngine.renderViewports(MPR_VIEWPORT_IDS);
    applyToggles();

    for (let i = 0; i < MPR_VIEWPORT_IDS.length; i++) {
      const vpId = MPR_VIEWPORT_IDS[i];
      const el = elements[i];

      const updateVpInfo = () => {
        const vp = renderingEngineRef.current?.getViewport(vpId);
        if (!vp) return;
        const props = vp.getProperties() as any;
        const { lower, upper } = props?.voiRange ?? { lower: 0, upper: 0 };
        const ww = upper - lower;
        const wc = lower + ww / 2;
        setMprInfo((prev) => ({
          ...prev,
          [vpId]: {
            current: vp.getSliceIndex(),
            total: vp.getNumberOfSlices(),
            ww,
            wc,
          },
        }));
      };

      listenToViewport(el, Enums.Events.VOLUME_NEW_IMAGE, updateVpInfo);
      listenToViewport(el, Enums.Events.VOI_MODIFIED, updateVpInfo);
      updateVpInfo();
    }
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
      viewport.resetCamera();
      viewport.render();
      updateSingleInfo(vpIds[0]);
      applyInitialState();
    });

    listenToViewport(elements[0], Enums.Events.STACK_NEW_IMAGE, () => updateSingleInfo(vpIds[0]));
    listenToViewport(elements[0], Enums.Events.VOI_MODIFIED, () => updateSingleInfo(vpIds[0]));
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
        <div className="relative bg-black overflow-hidden">
          <div ref={axialRef} className="absolute inset-0" />
          <ViewportOverlay label="Axial" info={mprInfo.CT_AXIAL} />
        </div>
        <div className="relative bg-black overflow-hidden">
          <div ref={sagittalRef} className="absolute inset-0" />
          <ViewportOverlay label="Sagittal" info={mprInfo.CT_SAGITTAL} />
        </div>
        <div className="relative bg-black overflow-hidden">
          <div ref={coronalRef} className="absolute inset-0" />
          <ViewportOverlay label="Coronal" info={mprInfo.CT_CORONAL} />
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
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="relative bg-black overflow-hidden">
            <div ref={refs[i]} className="absolute inset-0" />
            {i === 0 ? (
              <ViewportOverlay label={orientationLabel} info={singleInfo} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs text-neutral-600">Drop series here</span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative bg-black overflow-hidden w-full h-full" onContextMenu={(e) => e.preventDefault()}>
      <div ref={singleRef} className="absolute inset-0" />
      <ViewportOverlay
        label={`${orientationLabel}${isReconstructed ? ' (recon)' : ''}`}
        info={singleInfo}
      />
    </div>
  );
}
