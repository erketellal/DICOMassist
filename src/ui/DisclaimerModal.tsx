interface DisclaimerModalProps {
  onAccept: () => void;
}

export default function DisclaimerModal({ onAccept }: DisclaimerModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6">
        <h2 className="text-xl font-semibold text-white mb-4 text-center">
          Important Disclaimer
        </h2>
        <p className="text-zinc-300 mb-4">
          DICOMassist is an educational and research tool.
        </p>
        <ul className="text-zinc-400 text-sm space-y-2 mb-6">
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            This software is NOT certified as a medical device
          </li>
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            It is NOT intended for clinical diagnosis, treatment planning, or any clinical decision-making
          </li>
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            AI-generated analysis may contain errors, hallucinations, or inaccurate findings
          </li>
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            Never use this tool as a substitute for professional medical judgment
          </li>
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            All DICOM files are processed locally in your browser — no medical data is uploaded to our servers
          </li>
          <li className="flex gap-2">
            <span className="text-zinc-500 shrink-0">&bull;</span>
            When using AI analysis, image data is sent to the selected LLM provider (e.g., Anthropic Claude API) according to their data handling policies
          </li>
        </ul>
        <p className="text-zinc-500 text-xs mb-6">
          By continuing, you acknowledge that this tool is for educational purposes only
          and accept full responsibility for any use of the information provided.
        </p>
        <button
          onClick={onAccept}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors cursor-pointer"
        >
          I Understand &amp; Accept
        </button>
      </div>
    </div>
  );
}
