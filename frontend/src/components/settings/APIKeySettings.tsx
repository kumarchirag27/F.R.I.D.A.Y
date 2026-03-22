import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Save, Check, Shield } from "lucide-react";

import { API_BASE } from "@/lib/config";
const API = API_BASE;

const KEY_META: { key: string; label: string; description: string; category: "llm" | "recon" }[] = [
  { key: "GROQ_API_KEY", label: "GROQ", description: "Groq Cloud LLM API", category: "llm" },
  { key: "GOOGLE_API_KEY", label: "GOOGLE", description: "Google Gemini API", category: "llm" },
  { key: "OPENAI_API_KEY", label: "OPENAI", description: "OpenAI API", category: "llm" },
  { key: "ANTHROPIC_API_KEY", label: "ANTHROPIC", description: "Anthropic Claude API", category: "llm" },
  { key: "SHODAN_API_KEY", label: "SHODAN", description: "Shodan Internet Search Engine", category: "recon" },
  { key: "VIRUSTOTAL_API_KEY", label: "VIRUSTOTAL", description: "VirusTotal Threat Intelligence", category: "recon" },
  { key: "SECURITYTRAILS_API_KEY", label: "SECURITYTRAILS", description: "SecurityTrails DNS Intelligence", category: "recon" },
  { key: "HIBP_API_KEY", label: "HIBP", description: "Have I Been Pwned Breach Database", category: "recon" },
];

interface KeyStatus {
  configured: boolean;
  source: string;
  masked: string;
}

const APIKeySettings = () => {
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/settings/api-keys/status`)
      .then((r) => r.json())
      .then((data) => setKeyStatus(data.keys || {}))
      .catch(() => {});
  }, []);

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleEdit = (key: string) => {
    setEditingKey(key);
    setEditValues((prev) => ({ ...prev, [key]: "" }));
  };

  const handleSave = async () => {
    setSaving(true);
    // Only send keys that have been edited
    const toSave: Record<string, string> = {};
    for (const [k, v] of Object.entries(editValues)) {
      if (v.trim()) toSave[k] = v.trim();
    }

    if (Object.keys(toSave).length === 0) {
      setSaving(false);
      return;
    }

    try {
      await fetch(`${API}/api/settings/api-keys`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: toSave }),
      });
      // Refresh status
      const resp = await fetch(`${API}/api/settings/api-keys/status`);
      const data = await resp.json();
      setKeyStatus(data.keys || {});
      setEditingKey(null);
      setEditValues({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  };

  const llmKeys = KEY_META.filter((k) => k.category === "llm");
  const reconKeys = KEY_META.filter((k) => k.category === "recon");

  const renderKeyCard = (meta: typeof KEY_META[0]) => {
    const status = keyStatus[meta.key];
    const isEditing = editingKey === meta.key;
    const isRevealed = revealedKeys.has(meta.key);

    return (
      <motion.div
        key={meta.key}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="border border-primary/20 bg-primary/[0.02] chamfer-sm p-3"
      >
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: status?.configured ? "#00ff88" : "#ff2e2e",
                boxShadow: status?.configured
                  ? "0 0 6px rgba(0,255,136,0.6)"
                  : "0 0 6px rgba(255,46,46,0.6)",
              }}
            />
            <span className="font-display text-[10px] tracking-[0.15em] text-foreground/80">
              {meta.label}
            </span>
          </div>
          <span
            className="font-display text-[8px] tracking-widest uppercase"
            style={{ color: status?.configured ? "#00ff88" : "#ff2e2e" }}
          >
            {status?.configured ? "CONFIGURED" : "MISSING"}
            {status?.source === "env" && status?.configured && (
              <span className="text-primary/30 ml-1">(ENV)</span>
            )}
          </span>
        </div>

        {/* Description */}
        <p className="text-[9px] text-foreground/30 font-body mb-2">{meta.description}</p>

        {/* Value display / Edit */}
        {isEditing ? (
          <div className="border border-primary/30 bg-primary/[0.03] chamfer-sm">
            <input
              type="text"
              value={editValues[meta.key] || ""}
              onChange={(e) => setEditValues((prev) => ({ ...prev, [meta.key]: e.target.value }))}
              placeholder="PASTE NEW API KEY..."
              className="w-full bg-transparent px-3 py-2 text-foreground placeholder-primary/25 focus:outline-none font-display text-[10px] tracking-widest"
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-display text-[9px] tracking-wider text-foreground/40 flex-1 truncate">
              {status?.masked && status.configured
                ? isRevealed
                  ? status.masked
                  : "•".repeat(20)
                : "—"}
            </span>
            {status?.configured && (
              <button
                onClick={() => toggleReveal(meta.key)}
                className="p-1 text-primary/30 hover:text-primary transition-none"
              >
                {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            )}
            <button
              onClick={() => handleEdit(meta.key)}
              className="border border-primary/20 px-2 py-1 font-display text-[8px] uppercase tracking-widest text-primary/40 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm"
            >
              EDIT
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-4">
      {/* LLM Provider Keys */}
      <div className="border border-primary/30 bg-primary/5 chamfer glow-border p-4">
        <div className="hud-label mb-3 flex items-center gap-2">
          <div className="status-active" />
          LLM_PROVIDER_KEYS
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {llmKeys.map(renderKeyCard)}
        </div>
      </div>

      {/* Recon Tool Keys */}
      <div className="border border-primary/30 bg-primary/5 chamfer glow-border p-4">
        <div className="hud-label mb-3 flex items-center gap-2">
          <Shield className="w-3 h-3 text-primary" />
          RECON_TOOL_KEYS
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reconKeys.map(renderKeyCard)}
        </div>
      </div>

      {/* Save button */}
      {Object.keys(editValues).some((k) => editValues[k]?.trim()) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
          <motion.button
            onClick={handleSave}
            disabled={saving}
            whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.3)" }}
            transition={{ duration: 0 }}
            className="flex items-center gap-2 chamfer-sm font-display text-[10px] uppercase tracking-[0.15em] px-6 py-2.5 border border-primary bg-primary/15 text-primary glow-border transition-none"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "SAVING..." : saved ? "KEYS SAVED" : "SAVE ALL KEYS"}
          </motion.button>
        </motion.div>
      )}
    </div>
  );
};

export default APIKeySettings;
