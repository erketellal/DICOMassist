# CLAUDE.md — DICOM LLM Viewer

## Project Overview

A web-based DICOM viewer with LLM chat integration. The core innovation is **smart slice filtering**: instead of dumping 400+ slices into an LLM, we intelligently select 10-20 relevant slices based on a clinical hint (what the doctor suspects), DICOM metadata, and a two-call LLM architecture.

This is a portfolio project. Public GitHub repo + demo video. Goal: showcase clinical product knowledge + technical engineering skills.

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript
- **Viewer**: Cornerstone3D v4 (`@cornerstonejs/core@^4`, `@cornerstonejs/tools@^4`, `@cornerstonejs/dicom-image-loader@^4`)
- **Styling**: Tailwind CSS
- **Icons**: lucide-react
- **LLM**: Abstracted service layer (Claude API as default, swappable to any provider)
- **LLM API access**: Client-side calls with user-provided API key (runtime input, not bundled)
- **Data**: Local DICOM files only (drag-and-drop), no backend

## Vite Configuration (Critical)

Cornerstone3D requires specific Vite config. This is non-negotiable:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
  plugins: [
    react(),
    viteCommonjs(), // Required: dicom-parser is still CommonJS
  ],
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'], // needed for codec WASM files
});
```

## Project Structure

```
dicom-llm-viewer/
├── src/
│   ├── viewer/              # Cornerstone3D setup, viewports, toolbar
│   │   ├── CornerstoneInit.ts       # One-time init of core + tools + imageLoader
│   │   ├── ViewportGrid.tsx          # Viewport layout (stack + MPR)
│   │   ├── Toolbar.tsx               # Tool buttons (W/L, Zoom, Pan, Scroll, Length, etc.)
│   │   └── DicomDropZone.tsx         # Drag-and-drop file loading
│   ├── dicom/               # Metadata extraction and parsing
│   │   ├── MetadataExtractor.ts      # Extract relevant DICOM tags from loaded files
│   │   ├── SeriesOrganizer.ts        # Group files by series, sort by instance number
│   │   └── types.ts                  # DICOM metadata type definitions
│   ├── filtering/           # Slice selection logic
│   │   ├── SliceSelector.ts          # Apply LLM selection plan to actual slices
│   │   ├── SliceExporter.ts          # Convert selected slices to JPEG for LLM
│   │   └── types.ts                  # SelectionPlan, SliceRange types
│   ├── llm/                 # LLM integration (provider-agnostic)
│   │   ├── LLMService.ts            # Abstract interface
│   │   ├── ClaudeService.ts          # Claude API implementation
│   │   ├── PromptBuilder.ts          # Constructs prompts from metadata + hint
│   │   └── types.ts                  # LLMService interface, request/response types
│   ├── ui/                  # App-level UI components
│   │   ├── SpotlightPrompt.tsx       # Cmd+K / Ctrl+K overlay prompt input
│   │   ├── ChatSidebar.tsx           # Collapsible sidebar with chat history
│   │   └── MetadataPanel.tsx         # Shows extracted DICOM metadata summary
│   ├── App.tsx
│   └── main.tsx
├── public/
├── data/                    # Sample metadata JSONs (not DICOM files - too large for git)
├── docs/                    # Architecture diagrams, screenshots for README
├── CLAUDE.md
├── README.md
└── package.json
```

## Core User Flow

This is the single end-to-end workflow the MVP must support:

```
1. User drags DICOM folder onto the app
2. App loads files via Cornerstone3D fileManager (progressive loading with progress bar)
3. Metadata extracted from all DICOM headers (fast, no pixel decoding)
4. Files organized by series, sorted by instance/position
5. Viewer displays the primary axial series with standard tools
   - Primary series = axial series with the most slices (tie-break: lowest series number)
   - Axial detection uses Image Orientation Patient direction cosines, NOT series description
6. User hits Cmd+K → Spotlight-style prompt overlay appears
7. User types clinical hint: "Patient with hepatitis C history, evaluate for HCC"
8. FIRST LLM CALL (text-only, cheap):
   - Input: metadata summary + clinical hint
   - Output: structured SelectionPlan (which series, slice range, window/level, sampling)
9. App applies the plan:
   - Viewer scrolls to relevant slice range
   - Window/level adjusts to recommended values
   - Selected slices exported as JPEG (resized to ≤1568px long edge)
10. SECOND LLM CALL (multimodal):
    - Input: selected JPEG images + metadata context + clinical hint
    - Output: clinical analysis text
11. Response appears in chat sidebar
12. User can ask follow-up questions (conversation continues in sidebar)
    - Follow-ups are text-only: full conversation history sent as context, no new images
    - Covers "elaborate on finding #2", "differential diagnosis?", etc.
    - For a fresh analysis with different slices/series, user opens Cmd+K again (new two-call cycle)
```

## Cornerstone3D Implementation Notes

### Initialization
Initialize once at app startup. All three init calls are async in v4:
```ts
import { init as csRenderInit } from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

await csRenderInit();
await csToolsInit();
dicomImageLoaderInit({ maxWebWorkers: navigator.hardwareConcurrency || 1 });
```

Optional: configure camera FOV behavior (v4 removed the 10% padding from v3):
```ts
await csRenderInit({
  rendering: {
    useLegacyCameraFOV: true, // restore v3-style 10% padding if needed
  },
});
```

### Loading Local Files
Use the fileManager to register dropped files:
```ts
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';

// For each file from the drop event:
const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);
// Collect all imageIds, then set as stack on viewport
```

### Tool Registration
Register tools and bind to mouse buttons via ToolGroup. Note: `StackScrollMouseWheelTool` was renamed to `StackScrollTool` in v2+. Use `MouseBindings` enum instead of raw numbers:
```ts
import {
  addTool,
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,          // renamed from StackScrollMouseWheelTool
  LengthTool,
  Enums as csToolsEnums,
} from '@cornerstonejs/tools';

// Register tools globally (once)
addTool(WindowLevelTool);
addTool(PanTool);
addTool(ZoomTool);
addTool(StackScrollTool);
addTool(LengthTool);

// Create tool group and add tools
const toolGroup = ToolGroupManager.createToolGroup('mainTools');
toolGroup.addTool(WindowLevelTool.toolName);
toolGroup.addTool(PanTool.toolName);
toolGroup.addTool(ZoomTool.toolName);
toolGroup.addTool(StackScrollTool.toolName);
toolGroup.addTool(LengthTool.toolName);

// Associate viewport with tool group
toolGroup.addViewport(viewportId, renderingEngineId);

// Default bindings using MouseBindings enum
toolGroup.setToolActive(WindowLevelTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],      // Left click
});
toolGroup.setToolActive(PanTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],     // Middle click
});
toolGroup.setToolActive(ZoomTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary }],     // Right click
});
toolGroup.setToolActive(StackScrollTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],         // Scroll wheel
});
```

### Toolbar UI
Simple row of icon buttons. Each button calls `toolGroup.setToolActive(toolName, { bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }] })` for left-click binding. Use lucide-react icons. Active tool gets a highlighted state. This is NOT complex — it's a basic React component with ~50-80 lines.

### Viewport Types
- **StackViewport** (`Enums.ViewportType.STACK`): For scrolling through a 2D stack of axial slices (primary view)
- **VolumeViewport** (`Enums.ViewportType.ORTHOGRAPHIC`): For MPR (axial, coronal, sagittal reconstructions). Note: use `ORTHOGRAPHIC`, not `VOLUME`.

Both come out of the box from Cornerstone3D. Start with StackViewport. MPR can be added as a layout toggle — Cornerstone3D handles the rendering, we just create VolumeViewports and load the volume.

```ts
import { RenderingEngine, Enums, volumeLoader, setVolumesForViewports } from '@cornerstonejs/core';

// Stack viewport setup:
const renderingEngine = new RenderingEngine('myRenderingEngine');
renderingEngine.enableElement({
  viewportId: 'CT_STACK',
  element: htmlDivElement,
  type: Enums.ViewportType.STACK,
});
const viewport = renderingEngine.getViewport('CT_STACK');
viewport.setStack(imageIds, 0); // 0 = initial slice index
viewport.render();

// Volume/MPR viewport setup (for later phases):
renderingEngine.setViewports([
  {
    viewportId: 'CT_AXIAL',
    element: element1,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { orientation: Enums.OrientationAxis.AXIAL },
  },
  {
    viewportId: 'CT_SAGITTAL',
    element: element2,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { orientation: Enums.OrientationAxis.SAGITTAL },
  },
]);
const volume = await volumeLoader.createAndCacheVolume('myVolume', { imageIds });
volume.load();
setVolumesForViewports(renderingEngine, [{ volumeId: 'myVolume' }], ['CT_AXIAL', 'CT_SAGITTAL']);
```

### Performance
300-500MB DICOM datasets will work client-side. Cornerstone3D uses:
- Web Workers for multi-threaded decoding
- Progressive loading (user can scroll before all slices are decoded)
- GPU-accelerated rendering via WebGL

Expect 10-20 second initial load for large datasets. Show a progress bar. Memory usage can be ~2x the file size due to web worker buffer duplication.

## DICOM Metadata Tags to Extract

### Study-Level (extract once from first file)
| Tag | Name | Purpose |
|-----|------|---------|
| (0008,1030) | Study Description | "CT CHEST WITH CONTRAST" — scan context |
| (0018,0015) | Body Part Examined | "CHEST", "ABDOMEN" — unreliable (~15% error), use as hint only |
| (0008,0060) | Modality | CT, MR, US — determines analysis approach |
| (0010,1010) | Patient's Age | Clinical context for LLM |
| (0010,0040) | Patient's Sex | Clinical context for LLM |
| (0008,0020) | Study Date | Temporal context |
| (0008,0080) | Institution Name | Context |

### Series-Level (extract per unique series)
| Tag | Name | Purpose |
|-----|------|---------|
| (0008,103E) | Series Description | "AXIAL 3mm", "LUNG WINDOW" — human-readable series ID |
| (0020,0011) | Series Number | Series ordering |
| (0018,0050) | Slice Thickness | Resolution — thin slices = more detail |
| (0018,0088) | Spacing Between Slices | Continuity and coverage |
| (0018,1210) | Convolution Kernel | "LUNG", "BONE", "SOFT" — reconstruction type, critical for series selection |
| (0028,1050) | Window Center | Preset viewing parameters |
| (0028,1051) | Window Width | Preset viewing parameters |

### Per-Slice Spatial (for filtering)
| Tag | Name | Purpose |
|-----|------|---------|
| (0020,0032) | Image Position Patient | xyz coordinates — essential for z-range slice selection |
| (0020,0037) | Image Orientation Patient | Direction cosines — reliable axial/coronal/sagittal detection |
| (0020,0013) | Instance Number | Slice ordering within series |
| (0020,1041) | Slice Location | z-position shorthand |

### Key Insight
Image Orientation Patient (0020,0037) is MORE reliable than Series Description for determining the anatomical plane. Compute the plane from direction cosines rather than parsing free-text descriptions.

## LLM Integration Architecture

### Type Definitions
```ts
// --- DICOM Metadata Types ---

interface SliceMetadata {
  instanceNumber: number;
  imagePositionPatient: [number, number, number]; // x, y, z
  imageOrientationPatient: [number, number, number, number, number, number];
  sliceLocation?: number;
  imageId: string; // Cornerstone imageId for this slice
}

interface SeriesMetadata {
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  convolutionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
  anatomicalPlane: 'axial' | 'coronal' | 'sagittal' | 'oblique';
  slices: SliceMetadata[];
}

interface StudyMetadata {
  studyDescription: string;
  bodyPartExamined?: string;
  modality: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  institutionName?: string;
  series: SeriesMetadata[];
}

// --- LLM Types ---

interface SelectionPlan {
  targetSeries: string;           // Series Number as string, e.g., "3" (NOT Series UID)
  sliceRange: [number, number];   // Inclusive instance number range [start, end]
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;         // Required for every_nth and uniform, ignored for all
  windowCenter: number;
  windowWidth: number;
  reasoning: string;              // LLM explains why these selections
}

// samplingStrategy semantics:
//   'every_nth' — samplingParam = N, take every Nth slice (e.g., 5 → slices 1,6,11,16...)
//   'uniform'   — samplingParam = N, pick exactly N slices evenly spaced across the range
//   'all'       — take every slice in the range (use when range is already ≤20 slices)
// Hard guardrail: if result exceeds 20 slices after sampling, re-sample uniformly to 20.

interface ClinicalAnalysis {
  summary: string;
  findings: string[];
  limitations: string;
  suggestedFollowUp?: string;
}

interface LLMService {
  getSelectionPlan(metadata: StudyMetadata, clinicalHint: string): Promise<SelectionPlan>;
  analyzeSlices(images: Blob[], metadata: StudyMetadata, clinicalHint: string, plan: SelectionPlan): Promise<ClinicalAnalysis>;
}
```

### Two-Call Architecture
**Call 1 — Selection Planning (text-only)**
- Send: structured metadata JSON + clinical hint
- Receive: SelectionPlan JSON
- Purpose: LLM uses clinical reasoning to pick the right series, slice range, window/level

**Call 2 — Image Analysis (multimodal)**
- Send: 10-20 JPEG images + metadata context + clinical hint + selection reasoning
- Receive: clinical analysis text
- Purpose: actual visual analysis of selected slices

### Image Preparation for LLM
- Convert selected DICOM slices to JPEG using canvas
- Apply the recommended window/level BEFORE export (LLM sees what a radiologist would see)
- Resize to max 1568px on the long edge (optimal for Claude, avoids auto-resize latency)
- Target 10-20 images per request
- Base64 encode for API transmission

### Claude API Constraints (reference for ClaudeService)
- Max 100 images per API request
- ≤20 images: max 8000x8000px each
- >20 images: max 2000x2000px each
- ~1,600 tokens per image at optimal size
- 5MB per image, 32MB total request size
- Supported formats: JPEG, PNG, GIF, WebP

### Prompt Construction
PromptBuilder constructs system and user prompts. Key principles:
- Include disclaimer: "This is a research/portfolio tool, not for clinical diagnosis"
- Structure metadata as a clear clinical summary, not raw JSON dump
- Ask for structured JSON output from Call 1
- For Call 2, label images as "Image 1: (slice 45, z=-120mm):", "Image 2: ..." with position context
- Include the SelectionPlan reasoning so the analysis LLM knows why these slices were chosen

## UI Design

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [W/L] [Zoom] [Pan] [Length] [Reset] [Layout▼] │
├────────────────────────────────────┬────────────────────┤
│                                    │                    │
│                                    │   Chat Sidebar     │
│       DICOM Viewport               │   (collapsible)    │
│       (or MPR grid)                │                    │
│                                    │   - Chat history   │
│                                    │   - LLM responses  │
│                                    │   - Findings       │
│                                    │                    │
├────────────────────────────────────┴────────────────────┤
│ Status: Series info | Slice 45/187 | W:400 C:40         │
└─────────────────────────────────────────────────────────┘

Spotlight Prompt (Cmd+K / Ctrl+K overlay, centered):
┌─────────────────────────────────────────────────┐
│ 🔍 Patient with hepatitis C, evaluate for HCC  │
│    ▌                                            │
└─────────────────────────────────────────────────┘
```

### Spotlight Prompt (Cmd+K / Ctrl+K)
- Floating overlay centered on screen, above everything
- Text input with placeholder: "Describe clinical context or what to look for..."
- Enter to submit, Escape to dismiss
- Shows loading state during LLM calls
- After submission, result goes to chat sidebar which auto-opens

### Chat Sidebar
- Collapsible panel on the right
- Toggle with **Cmd+B** (Mac) / **Ctrl+B** (Windows/Linux), or toggle button
- Conversation history: user prompts + LLM responses
- Responses rendered as formatted markdown
- Follow-up input at bottom of sidebar (text-only, no new image analysis)

### Keyboard Shortcuts Summary
| Shortcut | Action |
|---|---|
| Cmd+K / Ctrl+K | Open spotlight prompt |
| Cmd+B / Ctrl+B | Toggle chat sidebar |
| Escape | Dismiss spotlight / close sidebar |

### Metadata Panel
- Collapsible accordion section at the **top of the sidebar**, above chat history
- Collapsed by default, "Study Info" header expands on click
- Shows extracted study/series metadata summary
- Useful for demo: show metadata and chat simultaneously for storytelling

## Build Phases

### Phase 1: Viewer Foundation
- [ ] Project setup (React + Vite + Cornerstone3D + Tailwind)
- [ ] Cornerstone3D initialization
- [ ] Drag-and-drop DICOM file loading with progress bar
- [ ] Stack viewport with axial slice scrolling
- [ ] Toolbar (W/L, Zoom, Pan, Scroll, Length, Reset)
- [ ] Status bar (series info, slice number, window values)

### Phase 2: Metadata Extraction
- [ ] Extract study-level metadata
- [ ] Extract series-level metadata, group files by series
- [ ] Extract per-slice spatial data
- [ ] Build structured metadata summary object
- [ ] Metadata panel UI

### Phase 3: LLM Integration
- [ ] LLMService interface
- [ ] ClaudeService: Call 1 (text-only selection plan)
- [ ] PromptBuilder for metadata + hint
- [ ] SliceSelector: apply SelectionPlan to image data
- [ ] SliceExporter: DICOM → windowed JPEG conversion
- [ ] ClaudeService: Call 2 (multimodal analysis)
- [ ] API key config: runtime input UI (stored in localStorage, NOT bundled in build)

### Phase 4: UI Integration
- [ ] Spotlight prompt component (Cmd+K)
- [ ] Chat sidebar component
- [ ] Wire up full flow: prompt → Call 1 → viewer adjust → Call 2 → chat
- [ ] Viewer auto-scrolls to selected range
- [ ] Viewer auto-applies window/level from plan
- [ ] Loading states and error handling

### Phase 5: Polish
- [ ] README with architecture diagram, screenshots, setup instructions
- [ ] Sample DICOM data download instructions
- [ ] Error handling edge cases
- [ ] Keyboard shortcuts documentation
- [ ] "Not for clinical use" disclaimer in UI

## Sample DICOM Data

For testing and demo, use LDCT-and-Projection-Data from TCIA:
- URL: https://www.cancerimagingarchive.net/collection/ldct-and-projection-data/
- Contains: head, chest, abdomen CT scans with clinical annotations
- Has: real pathology findings confirmed by biopsy/follow-up
- Format: Standard DICOM P10 files
- Includes: clinical data reports in Excel alongside images
- License: TCIA Data Usage Policy (free for research, requires citation)

Include download instructions in README. Do NOT commit DICOM files to git.

## Important Conventions

- All TypeScript, strict mode
- Functional React components with hooks only
- Cornerstone3D initialization in a single module — never scatter init calls
- LLM service is provider-agnostic: interface first, implementation second
- Always include "not for clinical use" disclaimer in LLM prompts and UI
- DICOM files never leave the client (privacy-first, all processing client-side)
- API key entered at runtime via UI (stored in localStorage), never bundled in build
- `.env.local` supported as optional fallback for local dev, never committed
- No patient PHI in git (even from de-identified public datasets)

## Known Pitfalls

1. **Cornerstone3D + Vite**: The viteCommonjs plugin and optimizeDeps exclusion are required. Without them, dicom-parser fails silently. This is still true in v4.
2. **Local file loading**: Use `wadouri.fileManager.add(file)` — NOT URL-based loading for local files.
3. **Memory**: ~500MB dataset can use ~1GB browser memory. Expected behavior, not a bug.
4. **Image Orientation**: Use (0020,0037) direction cosines for plane detection. Series Description is unreliable free text.
5. **Body Part Examined**: (0018,0015) is wrong ~15% of the time. Treat as hint, not ground truth.
6. **JPEG export**: Must apply window/level (rescale slope/intercept + windowing) to pixel data BEFORE JPEG conversion. Raw DICOM pixel values produce unusable images.
7. **Image sizing for LLM**: Resize to ≤1568px long edge before sending. Larger images auto-downscale on the API side, wasting latency with no quality benefit.
8. **Cornerstone3D has NO built-in toolbar UI**: It provides tool behaviors (zoom, pan, W/L, etc.) but NOT buttons or icons. We build a simple toolbar in React with lucide-react icons.
9. **StackScrollMouseWheelTool renamed**: In v2+ it's `StackScrollTool`. The mouse wheel is now a binding (`MouseBindings.Wheel`), not part of the tool name.
10. **Volume viewport type**: Use `Enums.ViewportType.ORTHOGRAPHIC` for MPR viewports, not `VOLUME`.
11. **v4 camera FOV**: v4 removed the 10% padding around images. Use `useLegacyCameraFOV: true` in init if the edge-to-edge display looks wrong.
12. **Node.js 20+ required**: Cornerstone3D v4 requires Node.js 20 or later.
