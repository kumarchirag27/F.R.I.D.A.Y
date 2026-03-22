import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Cpu, Key, Server } from "lucide-react";
import LLMSettings from "./LLMSettings";
import MCPSettings from "./MCPSettings";
import APIKeySettings from "./APIKeySettings";

const settingsTabs = [
  { id: "LLM_CONFIG", label: "LLM CONFIG", icon: Cpu },
  { id: "MCP_SERVERS", label: "MCP SERVERS", icon: Server },
  { id: "API_KEYS", label: "API KEYS", icon: Key },
] as const;

const SettingsPanel = () => {
  const [activeSection, setActiveSection] = useState<string>("LLM_CONFIG");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col gap-3 h-full"
    >
      {/* Header */}
      <div className="border border-primary/30 bg-primary/5 chamfer glow-border px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-4 h-4 text-primary" />
            <span className="font-display text-sm tracking-[0.2em] text-primary glow-text">
              SYSTEM_CONFIGURATION
            </span>
          </div>
          <span className="hud-label">V4.7 // SETTINGS_MODULE</span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border border-primary/30 bg-primary/5 chamfer p-2">
        {settingsTabs.map(({ id, label, icon: Icon }) => (
          <motion.button
            key={id}
            onClick={() => setActiveSection(id)}
            whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.15)" }}
            transition={{ duration: 0 }}
            className={`relative flex items-center gap-2 px-4 py-2.5 font-display text-[10px] tracking-[0.15em] uppercase chamfer-sm transition-none ${
              activeSection === id
                ? "bg-primary/15 text-primary glow-text border border-primary/40"
                : "text-foreground/50 hover:text-foreground/80 border border-transparent"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </motion.button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pr-1">
        <AnimatePresence mode="wait">
          {activeSection === "LLM_CONFIG" && (
            <motion.div
              key="llm"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.12 }}
            >
              <LLMSettings />
            </motion.div>
          )}
          {activeSection === "MCP_SERVERS" && (
            <motion.div
              key="mcp"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.12 }}
            >
              <MCPSettings />
            </motion.div>
          )}
          {activeSection === "API_KEYS" && (
            <motion.div
              key="api"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.12 }}
            >
              <APIKeySettings />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default SettingsPanel;
