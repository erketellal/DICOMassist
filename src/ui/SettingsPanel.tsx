import { useState, useEffect, useRef, useCallback } from 'react';
import { X, CheckCircle, XCircle, Loader2, Download, ChevronDown } from 'lucide-react';
import type { ProviderConfig, ProviderType } from '../llm/types';
import {
  pingOllama,
  fetchOllamaModels,
  pullOllamaModel,
  type OllamaModelInfo,
} from '../llm/LLMServiceFactory';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  config: ProviderConfig;
  onConfigChange: (config: ProviderConfig) => void;
}

interface RecommendedModel {
  name: string;
  label: string;
  desc: string;
  role: 'text' | 'vision' | 'both';
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  { name: 'alibayram/medgemma:4b', label: 'MedGemma 4B', desc: 'Medical text planning, no vision (2.5GB)', role: 'text' },
  { name: 'gemma3:4b', label: 'Gemma 3 4B', desc: 'Official Google, text + vision (3.3GB)', role: 'both' },
  { name: 'llava:7b', label: 'LLaVA 7B', desc: 'Proven vision support (4.7GB)', role: 'vision' },
  { name: 'llama3.2:latest', label: 'Llama 3.2 3B', desc: 'Fast general text (2GB)', role: 'text' },
];

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

export default function SettingsPanel({ open, onClose, config, onConfigChange }: SettingsPanelProps) {
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [installedModels, setInstalledModels] = useState<OllamaModelInfo[]>([]);
  const [pulling, setPulling] = useState<{ model: string; status: string; percent: number | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const baseUrl = config.ollamaUrl || 'http://localhost:11434';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const refreshModels = useCallback(async () => {
    setOllamaStatus('checking');
    const online = await pingOllama(baseUrl);
    setOllamaStatus(online ? 'online' : 'offline');
    if (online) {
      const models = await fetchOllamaModels(baseUrl);
      setInstalledModels(models);
    } else {
      setInstalledModels([]);
    }
  }, [baseUrl]);

  // Check Ollama when panel opens or provider changes to ollama
  useEffect(() => {
    if (open && config.provider === 'ollama') {
      refreshModels();
    }
  }, [open, config.provider, refreshModels]);

  const handlePull = async (modelName: string) => {
    setPulling({ model: modelName, status: 'Starting...', percent: null });
    const success = await pullOllamaModel(
      modelName,
      (status, percent) => setPulling({ model: modelName, status, percent }),
      baseUrl,
    );
    if (success) {
      await refreshModels();
    }
    // Keep the final status visible briefly
    setTimeout(() => setPulling(null), 1500);
  };

  if (!open) return null;

  const setProvider = (provider: ProviderType) => {
    onConfigChange({ ...config, provider });
  };

  const isInstalled = (name: string) =>
    installedModels.some((m) => m.name === name || m.name === name.replace(':latest', '') || m.name + ':latest' === name);

  const textModel = config.ollamaTextModel || 'alibayram/medgemma:4b';
  const visionModel = config.ollamaVisionModel || 'llava:7b';

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        ref={panelRef}
        className="absolute top-12 right-4 w-96 max-h-[80vh] bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
          <span className="text-sm font-medium text-neutral-200">LLM Settings</span>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* Provider Toggle */}
          <div>
            <label className="text-xs text-neutral-400 block mb-1.5">Provider</label>
            <div className="flex bg-neutral-900 rounded-lg p-0.5">
              <button
                onClick={() => setProvider('claude')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'claude' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Claude API
              </button>
              <button
                onClick={() => setProvider('ollama')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'ollama' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Ollama (Local)
              </button>
            </div>
          </div>

          {/* Claude fields */}
          {config.provider === 'claude' && (
            <div>
              <label className="text-xs text-neutral-400 block mb-1.5">API Key</label>
              <input
                type="password"
                value={config.apiKey ?? ''}
                onChange={(e) => onConfigChange({ ...config, apiKey: e.target.value })}
                placeholder="sk-ant-..."
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-neutral-500 mt-1">
                Stored in localStorage only. Never sent to our servers.
              </p>
            </div>
          )}

          {/* Ollama fields */}
          {config.provider === 'ollama' && (
            <>
              {/* Status */}
              <div className="flex items-center gap-2 text-xs">
                {ollamaStatus === 'checking' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-neutral-400">Connecting...</span>
                  </>
                )}
                {ollamaStatus === 'online' && (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400">Ollama running</span>
                    <span className="text-neutral-500">({installedModels.length} model{installedModels.length !== 1 ? 's' : ''})</span>
                  </>
                )}
                {ollamaStatus === 'offline' && (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">Ollama not running</span>
                  </>
                )}
                <button
                  onClick={refreshModels}
                  className="text-neutral-500 hover:text-neutral-300 ml-auto text-xs"
                >
                  Refresh
                </button>
              </div>

              {ollamaStatus === 'offline' && (
                <div className="text-xs text-neutral-500 bg-neutral-900 rounded-lg px-3 py-2">
                  <p>Start Ollama in your terminal:</p>
                  <code className="block mt-1 text-neutral-300 font-mono">ollama serve</code>
                </div>
              )}

              {/* Ollama URL */}
              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Ollama URL</label>
                <input
                  type="text"
                  value={config.ollamaUrl ?? 'http://localhost:11434'}
                  onChange={(e) => onConfigChange({ ...config, ollamaUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
              </div>

              {ollamaStatus === 'online' && (
                <>
                  {/* Text Model (Call 1) */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-1.5">
                      Text Model <span className="text-neutral-600">(Call 1: slice planning)</span>
                    </label>
                    <ModelDropdown
                      value={textModel}
                      models={installedModels}
                      onChange={(m) => onConfigChange({ ...config, ollamaTextModel: m })}
                    />
                  </div>

                  {/* Vision Model (Call 2) */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-1.5">
                      Vision Model <span className="text-neutral-600">(Call 2: image analysis)</span>
                    </label>
                    <ModelDropdown
                      value={visionModel}
                      models={installedModels}
                      onChange={(m) => onConfigChange({ ...config, ollamaVisionModel: m })}
                    />
                  </div>

                  {/* Recommended Models */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-2">Available Models</label>
                    <div className="space-y-1.5">
                      {RECOMMENDED_MODELS.map((rm) => {
                        const installed = isInstalled(rm.name);
                        const isPulling = pulling?.model === rm.name;
                        return (
                          <div
                            key={rm.name}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                              installed ? 'bg-neutral-900' : 'bg-neutral-900/50 border border-dashed border-neutral-700'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-neutral-200 font-medium">{rm.label}</span>
                                <RoleBadge role={rm.role} />
                                {installed && <CheckCircle className="w-3 h-3 text-green-500" />}
                              </div>
                              <p className="text-neutral-500 text-[10px] mt-0.5">{rm.desc}</p>
                            </div>
                            {!installed && !isPulling && (
                              <button
                                onClick={() => handlePull(rm.name)}
                                disabled={!!pulling}
                                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium disabled:opacity-30"
                              >
                                <Download className="w-3 h-3" />
                                Pull
                              </button>
                            )}
                            {isPulling && (
                              <div className="shrink-0 text-right">
                                <div className="flex items-center gap-1 text-blue-400">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span className="text-[10px]">{pulling.percent != null ? `${pulling.percent}%` : '...'}</span>
                                </div>
                              </div>
                            )}
                            {installed && !isPulling && (
                              <div className="shrink-0 flex gap-1">
                                {(rm.role === 'text' || rm.role === 'both') && (
                                  <button
                                    onClick={() => onConfigChange({ ...config, ollamaTextModel: rm.name })}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      textModel === rm.name
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-neutral-700 text-neutral-400 hover:text-neutral-200'
                                    }`}
                                  >
                                    Text
                                  </button>
                                )}
                                {(rm.role === 'vision' || rm.role === 'both') && (
                                  <button
                                    onClick={() => onConfigChange({ ...config, ollamaVisionModel: rm.name })}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      visionModel === rm.name
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-neutral-700 text-neutral-400 hover:text-neutral-200'
                                    }`}
                                  >
                                    Vision
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pull progress bar */}
                  {pulling && (
                    <div className="bg-neutral-900 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono">{pulling.model}</span>
                        <span className="text-neutral-500">{pulling.percent != null ? `${pulling.percent}%` : pulling.status}</span>
                      </div>
                      {pulling.percent != null && (
                        <div className="h-1 bg-neutral-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{ width: `${pulling.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function RoleBadge({ role }: { role: 'text' | 'vision' | 'both' }) {
  if (role === 'text') return <span className="px-1 py-0 rounded text-[9px] bg-purple-900/50 text-purple-400">text</span>;
  if (role === 'vision') return <span className="px-1 py-0 rounded text-[9px] bg-teal-900/50 text-teal-400">vision</span>;
  return <span className="px-1 py-0 rounded text-[9px] bg-amber-900/50 text-amber-400">text+vision</span>;
}

function ModelDropdown({
  value,
  models,
  onChange,
}: {
  value: string;
  models: OllamaModelInfo[];
  onChange: (model: string) => void;
}) {
  const [dropOpen, setDropOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setDropOpen(!dropOpen)}
        className="w-full flex items-center justify-between bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 hover:border-neutral-600"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
      </button>
      {dropOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto">
          {models.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                onChange(m.name);
                setDropOpen(false);
              }}
              className={`flex items-center justify-between w-full px-3 py-1.5 text-sm text-left transition-colors ${
                value === m.name ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              <span className="truncate">{m.name}</span>
              <span className="text-[10px] text-neutral-500 shrink-0 ml-2">{formatSize(m.size)}</span>
            </button>
          ))}
          {models.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">No models installed</div>
          )}
        </div>
      )}
    </div>
  );
}
