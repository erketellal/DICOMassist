# DICOMassist

A web-based DICOM viewer with LLM-powered slice selection and clinical analysis. Built with Cornerstone3D v4, React, and TypeScript.

![DICOMassist screenshot](screenshots/Screenshot%202026-02-18%20at%2013.45.25.png)

> **Disclaimer**: This is a portfolio/research project. Not intended for clinical diagnosis.

## What Makes This Different

Most medical AI demos send a single image to an LLM. Real CT scans have 200-500+ slices across multiple series. Dumping all of them is expensive, slow, and noisy.

DICOMassist uses a **two-call architecture** to intelligently filter slices:

```
                    Clinical Hint
                         │
                         ▼
              ┌─────────────────────┐
              │   Call 1 (text)     │  Metadata + hint
              │   Selection Plan    │  → series, range, W/L
              └────────┬────────────┘
                       │
            ┌──────────▼──────────┐
            │   Smart Filtering   │  Apply plan: select
            │   10-20 slices      │  relevant slices only
            └──────────┬──────────┘
                       │
              ┌────────▼────────────┐
              │  Call 2 (vision)    │  Selected JPEGs +
              │  Clinical Analysis  │  metadata context
              └─────────────────────┘
```

**Call 1** is text-only and cheap: the LLM receives structured metadata (series descriptions, slice counts, z-ranges, convolution kernels) plus the clinical hint, and returns a selection plan — which series to use, which slice range, what window/level, and how to sample.

**Call 2** is multimodal: only the 10-20 most relevant slices (windowed and resized) are sent for visual analysis, along with position labels so the LLM can reference specific slices.

## Features

- **DICOM Viewer**: Cornerstone3D v4 with stack and MPR layouts, standard tools (W/L, Zoom, Pan, Length, Scroll)
- **Drag-and-Drop Loading**: Drop a DICOM folder, progressive loading with prefetch progress
- **Metadata Extraction**: Automatic extraction of study, series, and per-slice spatial metadata
- **LLM Analysis**: Two-call architecture with structured selection planning and multimodal analysis
- **Interactive Slice References**: LLM responses contain clickable slice references that navigate the viewer
- **Pipeline Visualization**: Real-time step-by-step progress during analysis (timing, slice mappings, LLM reasoning)
- **Multi-Provider**: Claude API and Ollama (local) with separate text/vision model configuration
- **Keyboard Shortcuts**: `Cmd+K` spotlight prompt, `Cmd+B` chat toggle

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript
- **Viewer**: Cornerstone3D v4 (`@cornerstonejs/core`, `tools`, `dicom-image-loader`)
- **Styling**: Tailwind CSS v4
- **Icons**: lucide-react
- **LLM**: Provider-agnostic service layer (Claude API, Ollama)

## Getting Started

### Prerequisites

- Node.js 20+
- An LLM provider (choose one):
  - **Ollama** (free, local) — recommended for getting started
  - **Claude API key** (from [console.anthropic.com](https://console.anthropic.com))

### Setup

```bash
git clone https://github.com/yourusername/DICOMassist.git
cd DICOMassist
npm install
npm run dev
```

### LLM Configuration

Click the gear icon in the toolbar to open settings.

#### Option A: Ollama (Local)

1. Install [Ollama](https://ollama.com)
2. Pull models:
   ```bash
   # Text model for selection planning (Call 1)
   ollama pull alibayram/medgemma:4b

   # Vision model for image analysis (Call 2)
   ollama pull llava:7b
   ```
3. Start Ollama (it runs on `http://localhost:11434` by default)
4. In DICOMassist settings, select "Ollama" and configure model names

> **Note**: Ollama requires CORS to be enabled. Set the environment variable `OLLAMA_ORIGINS=*` before starting Ollama, or use the default URL which the app handles.

#### Option B: Claude API

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In DICOMassist settings, select "Claude" and paste your API key
3. The key is stored in localStorage and never sent anywhere except the Anthropic API

### Sample DICOM Data

For testing, download from [TCIA — LDCT and Projection Data](https://www.cancerimagingarchive.net/collection/ldct-and-projection-data/):
- Contains head, chest, and abdomen CT scans with clinical annotations
- Standard DICOM P10 format
- Free for research use (requires citation)

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Open spotlight prompt |
| `Cmd+B` / `Ctrl+B` | Toggle chat sidebar |
| `Escape` | Close spotlight / settings |

## Project Structure

```
src/
├── viewer/                    # Cornerstone3D setup and viewport management
│   ├── CornerstoneInit.ts     # One-time init of core + tools + imageLoader
│   ├── ViewportGrid.tsx       # Stack + MPR viewport layouts
│   ├── Toolbar.tsx            # Tool buttons and layout controls
│   ├── DicomDropZone.tsx      # Drag-and-drop DICOM loading
│   └── LoadingOverlay.tsx     # Prefetch progress indicator
├── dicom/                     # Metadata extraction
│   ├── MetadataExtractor.ts   # Extract DICOM tags from loaded files
│   ├── orientationUtils.ts    # Anatomical plane detection from direction cosines
│   └── types.ts               # StudyMetadata, SeriesMetadata, SliceMetadata
├── filtering/                 # Slice selection logic
│   ├── SliceSelector.ts       # Apply LLM selection plan to series data
│   ├── SliceExporter.ts       # DICOM → windowed JPEG conversion
│   └── types.ts               # SelectedSlice type
├── llm/                       # LLM integration (provider-agnostic)
│   ├── LLMServiceFactory.ts   # Claude + Ollama service implementations
│   ├── PromptBuilder.ts       # Construct prompts from metadata + hint
│   ├── useLLMChat.ts          # React hook: pipeline orchestration + state
│   └── types.ts               # LLMService interface, SelectionPlan, ChatMessage
├── ui/                        # App-level UI components
│   ├── SpotlightPrompt.tsx    # Cmd+K overlay prompt input
│   ├── ChatSidebar.tsx        # Chat history and follow-up input
│   ├── PipelineView.tsx       # Pipeline step visualization
│   ├── AssistantMessage.tsx   # Formatted LLM response with interactive slice refs
│   ├── MetadataPanel.tsx      # DICOM metadata summary panel
│   └── SettingsPanel.tsx      # LLM provider configuration
├── utils/
│   └── logger.ts              # Dev-gated console logging
├── App.tsx                    # Root component, viewport context, keyboard shortcuts
└── main.tsx                   # Entry point
```

## License

MIT
