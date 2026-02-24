import type { ReactNode } from 'react';

interface LandingScreenProps {
  children: ReactNode;
}

export default function LandingScreen({ children }: LandingScreenProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-zinc-300 p-8">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">DICOMassist</h1>
          <p className="text-lg text-zinc-400">AI-Powered Medical Image Analysis</p>
          <p className="text-sm text-zinc-500 mt-2">
            Smart slice selection meets multimodal AI analysis.
            <br />
            Load your DICOM files to get started.
          </p>
        </div>

        {/* Drop zone (rendered by DicomDropZone) */}
        <div className="h-56 mb-10">
          {children}
        </div>

        {/* How it works */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
            How it works
          </h3>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-blue-400 font-mono mr-2">1.</span>
              <strong className="text-zinc-200">Load</strong>
              <span className="text-zinc-400"> — Drop your DICOM files or folder</span>
            </div>
            <div>
              <span className="text-blue-400 font-mono mr-2">2.</span>
              <strong className="text-zinc-200">Analyze</strong>
              <span className="text-zinc-400"> — Describe what to evaluate</span>
            </div>
            <div>
              <span className="text-blue-400 font-mono mr-2">3.</span>
              <strong className="text-zinc-200">Plan</strong>
              <span className="text-zinc-400"> — AI selects optimal series and slices</span>
            </div>
            <div>
              <span className="text-blue-400 font-mono mr-2">4.</span>
              <strong className="text-zinc-200">Review</strong>
              <span className="text-zinc-400"> — Get findings with interactive slice references</span>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
            Features
          </h3>
          <ul className="text-sm text-zinc-400 space-y-1.5">
            <li>Multi-series support with automatic scout detection</li>
            <li>Smart slice filtering — AI picks what matters</li>
            <li>Interactive results with clickable slice navigation</li>
            <li>Privacy-first: DICOM files stay in your browser</li>
            <li>Works with Claude API or local models via Ollama</li>
          </ul>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-zinc-600 space-x-3">
          <span>Open Source</span>
          <span>&middot;</span>
          <a
            href="https://github.com/erketellal/DICOMassist"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-400 transition-colors"
          >
            GitHub
          </a>
          <span>&middot;</span>
          <span>Educational use only</span>
        </div>
      </div>
    </div>
  );
}
