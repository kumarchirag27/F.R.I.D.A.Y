import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Zap,
  Mic,
  MessageSquare,
  FlaskConical,
  Check,
  RefreshCw,
  AlertTriangle,
  Settings2,
  CircleDot,
  Eye,
  EyeOff,
} from "lucide-react";

import { API_BASE } from "@/lib/config";
const API = API_BASE;

interface SlotConfig {
  provider: string;
  model: string;
  api_key: string;
  base_url: string;
  temperature: number;
}

interface ModelOption {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  description: string;
  local?: boolean;
}

const PROVIDERS: Provider[] = [
  { id: "groq", name: "GROQ", description: "Ultra-fast cloud inference" },
  { id: "ollama", name: "OLLAMA", description: "Local models, no API key", local: true },
  { id: "google", name: "GOOGLE GEMINI", description: "Google's Gemini models" },
  { id: "openai", name: "OPENAI", description: "GPT-4o, o3, and more" },
  { id: "anthropic", name: "ANTHROPIC", description: "Claude Sonnet & Haiku" },
  { id: "openai-compatible", name: "CUSTOM ENDPOINT", description: "LM Studio, vLLM, etc.", local: true },
];

const SLOT_META = {
  rest: {
    label: "RECON ENGINE",
    desc: "Powers tool-calling recon scans with full intelligence",
    icon: Zap,
    color: "#00ff88",
  },
  voice: {
    label: "VOICE AGENT",
    desc: "Drives real-time voice conversations via LiveKit",
    icon: Mic,
    color: "#00d4ff",
  },
  chat: {
    label: "QUICK CHAT",
    desc: "Fast responses for the chat interface, no tools",
    icon: MessageSquare,
    color: "#ffaa00",
  },
} as const;

type SlotKey = "rest" | "voice" | "chat";

/* ── Provider Selector — visual grid instead of dropdown ── */
const ProviderGrid = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) => (
  <div className="grid grid-cols-3 gap-2">
    {PROVIDERS.map((p) => (
      <button
        key={p.id}
        onClick={() => onChange(p.id)}
        className={`relative border chamfer-sm px-3 py-2.5 text-left transition-none group ${
          value === p.id
            ? "border-primary bg-primary/15 glow-border"
            : "border-primary/15 bg-primary/[0.02] hover:border-primary/30 hover:bg-primary/5"
        }`}
      >
        <div className="flex items-center gap-2 mb-0.5">
          {value === p.id && (
            <CircleDot className="w-3 h-3 text-primary shrink-0" />
          )}
          <span
            className={`font-display text-[10px] tracking-[0.12em] uppercase ${
              value === p.id ? "text-primary glow-text" : "text-foreground/60 group-hover:text-foreground/80"
            }`}
          >
            {p.name}
          </span>
        </div>
        <span className="text-[8px] text-foreground/30 font-body block">
          {p.description}
        </span>
        {p.local && (
          <span className="absolute top-1 right-1.5 text-[7px] font-display tracking-widest text-green-400/50 uppercase">
            local
          </span>
        )}
      </button>
    ))}
  </div>
);

/* ── Model Selector — dropdown with better styling ── */
const ModelSelector = ({
  provider,
  value,
  models,
  onChange,
}: {
  provider: string;
  value: string;
  models: ModelOption[];
  onChange: (val: string) => void;
}) => {
  const isTextInput = provider === "openai-compatible";

  if (isTextInput) {
    return (
      <div className="border border-primary/30 bg-primary/[0.03] chamfer-sm">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            provider === "ollama"
              ? "e.g. gemma3:1b, llama3.1:8b, deepseek-r1:8b"
              : "Enter model name..."
          }
          className="w-full bg-transparent px-4 py-2.5 text-foreground placeholder-primary/20 focus:outline-none font-display text-[10px] tracking-widest"
          style={{ textTransform: "none" }}
        />
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-primary/30 bg-background/80 chamfer-sm px-4 py-2.5 text-foreground font-display text-[10px] uppercase tracking-widest focus:outline-none focus:border-primary/60 cursor-pointer appearance-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2300d4ff' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      <option value="" disabled>
        SELECT MODEL...
      </option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
};

/* ── Slot Editor Card ── */
const SlotEditor = ({
  slot,
  config,
  expanded,
  onToggle,
  onUpdate,
}: {
  slot: SlotKey;
  config: SlotConfig;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (slot: SlotKey, data: Partial<SlotConfig>) => void;
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<{
    status: string;
    message: string;
  } | null>(null);
  const meta = SLOT_META[slot];
  const Icon = meta.icon;
  const providerName =
    PROVIDERS.find((p) => p.id === config.provider)?.name || config.provider;

  // Fetch models when provider changes
  useEffect(() => {
    if (!config.provider || config.provider === "openai-compatible") return;
    fetch(`${API}/api/settings/llm/models/${config.provider}`)
      .then((r) => r.json())
      .then((data) => setModels(data.models || []))
      .catch(() => setModels([]));
  }, [config.provider]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${API}/api/settings/llm/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          model: config.model,
          api_key: config.api_key,
          base_url: config.base_url,
        }),
      });
      const data = await resp.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/api/settings/llm`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: slot, ...config }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  };

  const handleRestartAgent = async () => {
    setRestarting(true);
    setRestartResult(null);
    try {
      const resp = await fetch(`${API}/api/settings/restart-voice-agent`, {
        method: "POST",
      });
      const data = await resp.json();
      setRestartResult(data);
      setTimeout(() => setRestartResult(null), 5000);
    } catch (e: any) {
      setRestartResult({ status: "error", message: e.message });
    }
    setRestarting(false);
  };

  const needsApiKey =
    config.provider !== "ollama" && config.provider !== "openai-compatible";
  const needsBaseUrl =
    config.provider === "ollama" || config.provider === "openai-compatible";

  return (
    <div
      className={`border chamfer overflow-hidden transition-none ${
        expanded
          ? "border-primary/40 bg-primary/[0.03] glow-border"
          : "border-primary/15 bg-primary/[0.01]"
      }`}
    >
      {/* ── Header ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-primary/5 transition-none"
      >
        {/* Slot color indicator */}
        <div
          className="w-1.5 h-8 rounded-full shrink-0"
          style={{ backgroundColor: meta.color, opacity: expanded ? 1 : 0.4 }}
        />

        <Icon className="w-4.5 h-4.5" style={{ color: meta.color }} />

        <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
          <span
            className={`font-display text-[11px] tracking-[0.15em] uppercase ${
              expanded ? "text-foreground glow-text" : "text-foreground/70"
            }`}
          >
            {meta.label}
          </span>
          <span className="text-[9px] text-foreground/30 font-body">
            {meta.desc}
          </span>
        </div>

        {/* Current config badge */}
        <div className="flex items-center gap-2 mr-2 shrink-0">
          <span className="font-display text-[9px] tracking-widest text-primary/50 border border-primary/15 px-2 py-0.5 chamfer-sm bg-primary/[0.03]">
            {providerName}
          </span>
          <span className="font-display text-[9px] tracking-wider text-foreground/40 max-w-[140px] truncate">
            {config.model || "not set"}
          </span>
        </div>

        {expanded ? (
          <ChevronDown className="w-4 h-4 text-primary/40 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-primary/20 shrink-0" />
        )}
      </button>

      {/* ── Expanded Config Panel ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 border-t border-primary/10 pt-4">
              {/* Step 1: Provider */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-5 h-5 flex items-center justify-center border border-primary/30 chamfer-sm font-display text-[9px] text-primary/60">
                    1
                  </span>
                  <label className="hud-label">SELECT PROVIDER</label>
                </div>
                <ProviderGrid
                  value={config.provider}
                  onChange={(v) => {
                    onUpdate(slot, {
                      provider: v,
                      model: "",
                      base_url:
                        v === "ollama"
                          ? "http://localhost:11434/v1"
                          : v === "openai-compatible"
                          ? "http://localhost:11434/v1"
                          : "",
                    });
                    setTestResult(null);
                  }}
                />
              </div>

              {/* Step 2: Model */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-5 h-5 flex items-center justify-center border border-primary/30 chamfer-sm font-display text-[9px] text-primary/60">
                    2
                  </span>
                  <label className="hud-label">CHOOSE MODEL</label>
                </div>
                <ModelSelector
                  provider={config.provider}
                  value={config.model}
                  models={models}
                  onChange={(v) => {
                    onUpdate(slot, { model: v });
                    setTestResult(null);
                  }}
                />
              </div>

              {/* Step 3: Configuration (API key, base URL, temperature) */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-5 h-5 flex items-center justify-center border border-primary/30 chamfer-sm font-display text-[9px] text-primary/60">
                    3
                  </span>
                  <label className="hud-label">CONFIGURE</label>
                </div>

                <div className="space-y-3 pl-7">
                  {/* API Key — only for cloud providers */}
                  {needsApiKey && (
                    <div>
                      <label className="text-[9px] text-foreground/40 font-display tracking-widest uppercase block mb-1">
                        API KEY
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1 border border-primary/20 bg-primary/[0.02] chamfer-sm flex items-center">
                          <input
                            type={showKey ? "text" : "password"}
                            value={config.api_key}
                            onChange={(e) =>
                              onUpdate(slot, { api_key: e.target.value })
                            }
                            placeholder="Leave empty to use .env key"
                            className="w-full bg-transparent px-3 py-2 text-foreground placeholder-primary/15 focus:outline-none font-display text-[10px] tracking-widest"
                            style={{ textTransform: "none" }}
                          />
                        </div>
                        <button
                          onClick={() => setShowKey(!showKey)}
                          className="border border-primary/20 px-2.5 py-2 text-primary/30 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm"
                        >
                          {showKey ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Base URL — for local/custom endpoints */}
                  {needsBaseUrl && (
                    <div>
                      <label className="text-[9px] text-foreground/40 font-display tracking-widest uppercase block mb-1">
                        ENDPOINT URL
                      </label>
                      <div className="border border-primary/20 bg-primary/[0.02] chamfer-sm">
                        <input
                          type="text"
                          value={config.base_url}
                          onChange={(e) =>
                            onUpdate(slot, { base_url: e.target.value })
                          }
                          placeholder="http://localhost:11434/v1"
                          className="w-full bg-transparent px-3 py-2 text-foreground placeholder-primary/15 focus:outline-none font-display text-[10px] tracking-widest"
                          style={{ textTransform: "none" }}
                        />
                      </div>
                      <p className="text-[8px] text-foreground/20 mt-1 font-body pl-1">
                        {config.provider === "ollama"
                          ? "Default: http://localhost:11434/v1"
                          : "Ollama: :11434/v1  |  LM Studio: :1234/v1  |  vLLM: :8000/v1"}
                      </p>
                    </div>
                  )}

                  {/* Temperature */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] text-foreground/40 font-display tracking-widest uppercase">
                        TEMPERATURE
                      </label>
                      <span className="text-primary font-display text-[10px] tabular-nums">
                        {config.temperature.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={config.temperature}
                      onChange={(e) =>
                        onUpdate(slot, {
                          temperature: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-primary h-1 bg-primary/20 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:rounded-none"
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[7px] text-foreground/15 font-display tracking-widest">
                        PRECISE
                      </span>
                      <span className="text-[7px] text-foreground/15 font-display tracking-widest">
                        CREATIVE
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
                <motion.button
                  onClick={handleTest}
                  disabled={testing || !config.model}
                  whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.12)" }}
                  transition={{ duration: 0 }}
                  className="flex items-center gap-2 chamfer-sm font-display text-[9px] uppercase tracking-[0.15em] px-4 py-2.5 border border-primary/25 text-primary/60 hover:text-primary transition-none disabled:opacity-30"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  {testing ? "TESTING..." : "TEST"}
                </motion.button>

                <motion.button
                  onClick={handleSave}
                  disabled={saving || !config.model}
                  whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.3)" }}
                  transition={{ duration: 0 }}
                  className="flex items-center gap-2 chamfer-sm font-display text-[9px] uppercase tracking-[0.15em] px-5 py-2.5 border border-primary bg-primary/15 text-primary glow-border transition-none disabled:opacity-30"
                >
                  {saved ? <Check className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                  {saving ? "SAVING..." : saved ? "SAVED" : "APPLY"}
                </motion.button>

                {/* Test result inline */}
                {testResult && (
                  <div className="flex items-center gap-2 ml-1">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: testResult.success
                          ? "#00ff88"
                          : "#ff2e2e",
                        boxShadow: testResult.success
                          ? "0 0 6px rgba(0,255,136,0.6)"
                          : "0 0 6px rgba(255,46,46,0.6)",
                      }}
                    />
                    <span
                      className="font-display text-[9px] tracking-widest"
                      style={{
                        color: testResult.success ? "#00ff88" : "#ff2e2e",
                      }}
                    >
                      {testResult.message?.substring(0, 40)}
                    </span>
                  </div>
                )}

                {/* Saved indicator */}
                {saved && !testResult && (
                  <span className="font-display text-[9px] tracking-widest text-green-400">
                    CONFIGURATION APPLIED
                  </span>
                )}
              </div>

              {/* Voice agent restart banner */}
              {slot === "voice" && (
                <div className="border border-yellow-500/20 bg-yellow-500/[0.04] chamfer-sm p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-500/60 shrink-0" />
                      <span className="text-[9px] text-yellow-500/60 font-body">
                        Voice agent requires restart after changes
                      </span>
                    </div>
                    <motion.button
                      onClick={handleRestartAgent}
                      disabled={restarting}
                      whileHover={{ backgroundColor: "rgba(255,170,0,0.12)" }}
                      transition={{ duration: 0 }}
                      className="flex items-center gap-2 chamfer-sm font-display text-[8px] uppercase tracking-[0.15em] px-3 py-1.5 border border-yellow-500/30 text-yellow-500/60 hover:text-yellow-500 transition-none disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${restarting ? "animate-spin" : ""}`}
                      />
                      {restarting ? "RESTARTING..." : "RESTART"}
                    </motion.button>
                  </div>
                  {restartResult && (
                    <span
                      className="font-display text-[8px] tracking-widest mt-1 block pl-6"
                      style={{
                        color:
                          restartResult.status === "ok" ? "#00ff88" : "#ff2e2e",
                      }}
                    >
                      {restartResult.message?.substring(0, 60)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Main Component ── */
const EMPTY_SLOT: SlotConfig = {
  provider: "",
  model: "",
  api_key: "",
  base_url: "",
  temperature: 0.6,
};

const LLMSettings = () => {
  const [slots, setSlots] = useState<Record<SlotKey, SlotConfig>>({
    rest: { ...EMPTY_SLOT },
    voice: { ...EMPTY_SLOT },
    chat: { ...EMPTY_SLOT },
  });
  const [loaded, setLoaded] = useState(false);
  const [expandedSlot, setExpandedSlot] = useState<SlotKey | null>(null);

  // Load settings on mount — always fetch from backend (no hardcoded defaults)
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        if (data.llm) {
          setSlots({
            rest: { ...EMPTY_SLOT, ...data.llm.rest },
            voice: { ...EMPTY_SLOT, ...data.llm.voice },
            chat: { ...EMPTY_SLOT, ...data.llm.chat },
          });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleUpdate = (slot: SlotKey, data: Partial<SlotConfig>) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], ...data },
    }));
  };

  return (
    <div className="space-y-2">
      {/* Quick summary — always visible */}
      <div className="border border-primary/20 bg-primary/[0.03] chamfer px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <Settings2 className="w-3.5 h-3.5 text-primary/50" />
          <span className="hud-label">ACTIVE CONFIGURATION</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(["rest", "voice", "chat"] as SlotKey[]).map((s) => {
            const m = SLOT_META[s];
            const Icon = m.icon;
            const prov = PROVIDERS.find((p) => p.id === slots[s].provider);
            return (
              <button
                key={s}
                onClick={() =>
                  setExpandedSlot(expandedSlot === s ? null : s)
                }
                className={`border chamfer-sm p-2.5 text-left transition-none ${
                  expandedSlot === s
                    ? "border-primary/40 bg-primary/10"
                    : "border-primary/10 bg-primary/[0.02] hover:border-primary/25 hover:bg-primary/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3 h-3" style={{ color: m.color }} />
                  <span className="font-display text-[9px] tracking-[0.12em] uppercase text-foreground/60">
                    {m.label}
                  </span>
                </div>
                <div className="font-display text-[10px] tracking-widest text-primary truncate">
                  {prov?.name || slots[s].provider || "—"}
                </div>
                <div className="text-[8px] text-foreground/30 font-body truncate">
                  {slots[s].model || (loaded ? "not configured" : "...")}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[8px] text-foreground/20 font-body mt-2.5 text-center tracking-wide">
          Click a card above or expand a section below to configure
        </p>
      </div>

      {/* Slot editors — accordion, only one open at a time */}
      {(["rest", "voice", "chat"] as SlotKey[]).map((slot) => (
        <SlotEditor
          key={slot}
          slot={slot}
          config={slots[slot]}
          expanded={expandedSlot === slot}
          onToggle={() =>
            setExpandedSlot(expandedSlot === slot ? null : slot)
          }
          onUpdate={handleUpdate}
        />
      ))}
    </div>
  );
};

export default LLMSettings;
