# DICOMassist

**AI-Powered Medical Image Analysis**

Smart slice selection meets multimodal AI analysis. DICOMassist is a web-based DICOM viewer that intelligently selects the right images before sending them to an LLM for analysis — because the hard part isn't the AI, it's knowing what to send it.

<p align="center">
  <img src="docs/demo.gif" alt="DICOMassist demo" width="800" />
</p>

<p align="center">
  <a href="https://youtu.be/fdDkg8ZleyA">Watch the full demo video</a> · <a href="https://dicomassist.dev">Live demo</a>
</p>

> ⚠️ **Educational and research use only.** Not a certified medical device. Not intended for clinical diagnosis or treatment decisions.

## How It Works

A knee MRI can have 200+ slices across 8+ series. Dumping them all to an AI gives garbage results. DICOMassist uses a **two-call architecture**:

1. **Load** — Drag and drop DICOM files or folders into the browser
2. **Analyze** — Describe what to evaluate (e.g., "evaluate for ACL tear grade")
3. **Plan** — The LLM analyzes study metadata and selects the optimal series, slice range, and windowing based on the clinical question
4. **Review** — Only the focused slices are sent for multimodal analysis, producing findings with interactive slice references you can click to navigate

## Key Features

- **Smart slice filtering** — AI reasons about which series orientation, weighting, and slice range are diagnostically relevant, then samples only those slices
- **Multi-series support** — Automatic scout detection, series metadata extraction (orientation, MRI weighting, resolution)
- **Interactive results** — Clickable slice references in findings jump the viewer to the referenced image
- **Privacy-first** — DICOM files are processed entirely in your browser. No data is uploaded to any server. Image data is only sent to the LLM provider you configure when you run an analysis
- **Multiple layouts** — 1×1, 1×2, 2×1, 2×2 grid, and MPR (axial/sagittal/coronal)
- **Standard tools** — Window/Level, Zoom, Pan, Length measurement, Rotate, Flip, Invert, Cine playback
- **Provider-agnostic** — Works with Claude API (recommended) or local models via Ollama

## Getting Started

### Live demo

Visit [dicomassist.dev](https://dicomassist.dev)

### Run locally

```bash
git clone https://github.com/erketellal/DICOMassist.git
cd DICOMassist
npm install
npm run dev
```

### Configure AI analysis

1. Click the ⚙ Settings icon in the toolbar
2. Select **Claude API** and enter your API key ([get one here](https://console.anthropic.com))
3. Load DICOM files, click **Analyze**, and describe what to evaluate

For local models, install [Ollama](https://ollama.ai), pull a model (`ollama pull gemma3:4b`), and select Ollama in settings. Note: local models produce significantly lower quality results for medical image analysis compared to Claude.

### Sample data

To try DICOMassist, you can use public DICOM datasets:

- [DICOM Library](https://www.dicomlibrary.com) — free sample datasets
- [The Cancer Imaging Archive](https://www.cancerimagingarchive.net) — research datasets
- [OAI (Osteoarthritis Initiative)](https://nda.nih.gov/oai/) — knee MRI datasets

## Tech Stack

- **React 18** + TypeScript + Vite
- **Cornerstone3D v4** — medical image rendering, viewport management, tools
- **Claude API** (Anthropic) — multimodal LLM for image analysis
- **Ollama** — optional local model support

## Architecture

```
User prompt ("evaluate ACL tear")
        │
        ▼
   ┌─────────┐     Study metadata
   │  Call 1  │◄─── (series list, orientations,
   │  (text)  │     slice counts, resolutions)
   └────┬────┘
        │ Selection plan:
        │ Series #8 sagittal PD-FS, slices 13-27
        ▼
   ┌──────────┐     Focused JPEG exports
   │  Call 2   │◄─── (15 slices, windowed,
   │ (vision)  │     with slice labels)
   └────┬─────┘
        │
        ▼
   Findings with slice references
```

## Contributing

Contributions are welcome! This is an open-source project — feel free to open issues, submit PRs, or suggest features.

## License

MIT

---

*DICOMassist is an educational tool built to demonstrate intelligent data preparation for AI-powered medical image analysis. It is not a certified medical device and must not be used for clinical decision-making.*
