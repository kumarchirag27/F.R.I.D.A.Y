import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  Plug,
  Wifi,
  Terminal,
  RefreshCw,
  Power,
  PowerOff,
  Settings2,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { API_BASE } from "@/lib/config";
const API = API_BASE;

interface MCPTool {
  name: string;
  description: string;
  enabled: boolean;
}

interface MCPServer {
  name: string;
  url_or_command: string;
  transport: "sse" | "stdio";
  enabled: boolean;
  status: "connected" | "disconnected" | "error" | "connecting";
  error_message: string;
  tools: MCPTool[];
  tool_count: number;
  env: Record<string, string>;
  args: string[];
  last_connected: number;
}

interface MCPStats {
  total_servers: number;
  connected: number;
  enabled: number;
  total_tools: number;
}

const statusConfig: Record<string, { bg: string; glow: string; label: string; icon: typeof CheckCircle2 }> = {
  connected: { bg: "#00ff88", glow: "0 0 6px rgba(0,255,136,0.6)", label: "CONNECTED", icon: CheckCircle2 },
  disconnected: { bg: "#666666", glow: "0 0 4px rgba(102,102,102,0.4)", label: "DISCONNECTED", icon: PowerOff },
  connecting: { bg: "#00d4ff", glow: "0 0 6px rgba(0,212,255,0.6)", label: "CONNECTING", icon: Loader2 },
  error: { bg: "#ff2e2e", glow: "0 0 6px rgba(255,46,46,0.6)", label: "ERROR", icon: AlertCircle },
};

/* ── Toggle Switch Component ── */
const Toggle = ({
  enabled,
  onToggle,
  size = "md",
}: {
  enabled: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
}) => {
  const w = size === "sm" ? "w-7" : "w-9";
  const h = size === "sm" ? "h-3.5" : "h-4.5";
  const dot = size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  const onPos = size === "sm" ? "left-[14px]" : "left-[19px]";

  return (
    <button
      onClick={onToggle}
      className={`relative ${w} ${h} rounded-full transition-none shrink-0 ${
        enabled ? "bg-primary/30" : "bg-primary/10"
      }`}
    >
      <div
        className={`absolute top-0.5 ${dot} rounded-full transition-all duration-150 ${
          enabled ? `${onPos} bg-primary` : "left-0.5 bg-foreground/30"
        }`}
        style={enabled ? { boxShadow: "0 0 6px rgba(0,212,255,0.6)" } : undefined}
      />
    </button>
  );
};

/* ── Add Server Form ── */
const AddServerForm = ({
  onAdd,
  onCancel,
}: {
  onAdd: (server: {
    name: string;
    url_or_command: string;
    transport: "sse" | "stdio";
    env: Record<string, string>;
    args: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) => {
  const [name, setName] = useState("");
  const [urlOrCommand, setUrlOrCommand] = useState("");
  const [transport, setTransport] = useState<"sse" | "stdio">("sse");
  const [envText, setEnvText] = useState("");
  const [argsText, setArgsText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adding, setAdding] = useState(false);

  const parseEnv = (text: string): Record<string, string> => {
    const env: Record<string, string> = {};
    text.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    });
    return env;
  };

  const handleSubmit = async () => {
    if (!name.trim() || !urlOrCommand.trim()) return;
    setAdding(true);
    await onAdd({
      name: name.trim().toUpperCase().replace(/\s+/g, "-"),
      url_or_command: urlOrCommand.trim(),
      transport,
      env: parseEnv(envText),
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
    });
    setAdding(false);
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
    >
      <div className="border border-primary/20 bg-primary/[0.02] chamfer-sm p-4 mb-3 space-y-3">
        {/* Row 1: Name + Transport */}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className="hud-label mb-1.5 block">SERVER NAME</label>
            <div className="border border-primary/30 bg-primary/[0.03] chamfer-sm">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MY-MCP-SERVER"
                className="w-full bg-transparent px-4 py-2.5 text-foreground placeholder-primary/25 focus:outline-none font-display text-[10px] uppercase tracking-widest"
              />
            </div>
          </div>

          <div>
            <label className="hud-label mb-1.5 block">TRANSPORT</label>
            <div className="flex border border-primary/30 chamfer-sm overflow-hidden">
              <button
                onClick={() => setTransport("sse")}
                className={`flex items-center gap-1.5 px-3 py-2.5 font-display text-[9px] uppercase tracking-widest transition-none ${
                  transport === "sse"
                    ? "bg-primary/20 text-primary"
                    : "bg-primary/[0.03] text-foreground/40 hover:text-foreground/70"
                }`}
              >
                <Wifi className="w-3 h-3" />
                SSE
              </button>
              <button
                onClick={() => setTransport("stdio")}
                className={`flex items-center gap-1.5 px-3 py-2.5 font-display text-[9px] uppercase tracking-widest transition-none ${
                  transport === "stdio"
                    ? "bg-primary/20 text-primary"
                    : "bg-primary/[0.03] text-foreground/40 hover:text-foreground/70"
                }`}
              >
                <Terminal className="w-3 h-3" />
                STDIO
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: URL / Command */}
        <div>
          <label className="hud-label mb-1.5 block">
            {transport === "sse" ? "SERVER URL" : "COMMAND"}
          </label>
          <div className="border border-primary/30 bg-primary/[0.03] chamfer-sm">
            <input
              type="text"
              value={urlOrCommand}
              onChange={(e) => setUrlOrCommand(e.target.value)}
              placeholder={
                transport === "sse"
                  ? "http://localhost:3001/mcp"
                  : "npx -y @modelcontextprotocol/server-everything"
              }
              className="w-full bg-transparent px-4 py-2.5 text-foreground placeholder-primary/25 focus:outline-none font-display text-[10px] tracking-widest"
              style={{ textTransform: "none" }}
            />
          </div>
          <p className="text-[8px] text-foreground/20 mt-1 font-body pl-1">
            {transport === "sse"
              ? "HTTP endpoint for the MCP server (JSON-RPC over HTTP)"
              : "Command to spawn the MCP server process (JSON-RPC over stdin/stdout)"}
          </p>
        </div>

        {/* Advanced: Env vars + Args (for stdio) */}
        {transport === "stdio" && (
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[9px] text-primary/40 hover:text-primary font-display tracking-widest uppercase transition-none mb-2"
            >
              <Settings2 className="w-3 h-3" />
              {showAdvanced ? "HIDE" : "SHOW"} ADVANCED
              {showAdvanced ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="overflow-hidden space-y-3"
                >
                  <div>
                    <label className="text-[9px] text-foreground/40 font-display tracking-widest uppercase block mb-1">
                      ENVIRONMENT VARIABLES
                    </label>
                    <div className="border border-primary/20 bg-primary/[0.02] chamfer-sm">
                      <textarea
                        value={envText}
                        onChange={(e) => setEnvText(e.target.value)}
                        placeholder={"API_KEY=sk-xxx\nDATABASE_URL=postgres://..."}
                        rows={3}
                        className="w-full bg-transparent px-3 py-2 text-foreground placeholder-primary/15 focus:outline-none font-mono text-[10px] resize-none"
                        style={{ textTransform: "none" }}
                      />
                    </div>
                    <p className="text-[8px] text-foreground/20 mt-0.5 font-body pl-1">
                      One per line: KEY=VALUE
                    </p>
                  </div>

                  <div>
                    <label className="text-[9px] text-foreground/40 font-display tracking-widest uppercase block mb-1">
                      EXTRA ARGUMENTS
                    </label>
                    <div className="border border-primary/20 bg-primary/[0.02] chamfer-sm">
                      <input
                        type="text"
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder="--verbose --port 3001"
                        className="w-full bg-transparent px-3 py-2 text-foreground placeholder-primary/15 focus:outline-none font-display text-[10px] tracking-widest"
                        style={{ textTransform: "none" }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={onCancel}
            className="font-display text-[9px] uppercase tracking-widest text-foreground/40 hover:text-foreground/60 transition-none px-3 py-2"
          >
            CANCEL
          </button>
          <motion.button
            onClick={handleSubmit}
            disabled={adding || !name.trim() || !urlOrCommand.trim()}
            whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.3)" }}
            transition={{ duration: 0 }}
            className="flex items-center gap-2 chamfer-sm font-display text-[9px] uppercase tracking-[0.15em] px-5 py-2.5 border border-primary bg-primary/15 text-primary glow-border transition-none disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {adding ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            {adding ? "CONNECTING..." : "ADD & CONNECT"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

/* ── Server Card ── */
const ServerCard = ({
  server,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onTest,
  onReconnect,
  onRemove,
  onToggleTool,
  testing,
  reconnecting,
}: {
  server: MCPServer;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onTest: () => void;
  onReconnect: () => void;
  onRemove: () => void;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  testing: boolean;
  reconnecting: boolean;
}) => {
  const sc = statusConfig[server.status] || statusConfig.disconnected;
  const StatusIcon = sc.icon;
  const enabledTools = server.tools.filter((t) => t.enabled).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border chamfer-sm overflow-hidden transition-none ${
        !server.enabled
          ? "border-primary/10 bg-primary/[0.01] opacity-60"
          : expanded
          ? "border-primary/30 bg-primary/[0.03] glow-border"
          : "border-primary/20 bg-primary/[0.02]"
      }`}
    >
      {/* ── Server Header ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Enable/Disable toggle */}
        <Toggle enabled={server.enabled} onToggle={onToggleEnabled} size="sm" />

        {/* Expand arrow */}
        <button onClick={onToggleExpand} className="shrink-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-primary/60" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-primary/30" />
          )}
        </button>

        {/* Status dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: sc.bg, boxShadow: sc.glow }}
        />

        {/* Name + transport */}
        <button onClick={onToggleExpand} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="font-display text-[10px] tracking-[0.15em] text-foreground/80 uppercase truncate">
            {server.name}
          </span>
          <span className="font-display text-[8px] tracking-widest text-primary/30 border border-primary/15 px-1.5 py-0.5 shrink-0">
            {server.transport.toUpperCase()}
          </span>
        </button>

        {/* Status label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusIcon
            className={`w-3 h-3 ${server.status === "connecting" ? "animate-spin" : ""}`}
            style={{ color: sc.bg }}
          />
          <span className="font-display text-[8px] tracking-widest" style={{ color: sc.bg }}>
            {sc.label}
          </span>
        </div>

        {/* Tool count badge */}
        {server.tool_count > 0 && (
          <span className="flex items-center gap-1 font-display text-[9px] tracking-widest text-primary/40 shrink-0">
            <Wrench className="w-3 h-3" />
            {enabledTools}/{server.tool_count}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex gap-1 ml-1 shrink-0">
          <button
            onClick={onReconnect}
            disabled={reconnecting || !server.enabled}
            className="p-1.5 border border-primary/20 text-primary/40 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm disabled:opacity-30"
            title="Reconnect (rediscover tools)"
          >
            <RefreshCw className={`w-3 h-3 ${reconnecting ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onTest}
            disabled={testing || !server.enabled}
            className="p-1.5 border border-primary/20 text-primary/40 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm disabled:opacity-30"
            title="Test connection"
          >
            {testing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FlaskConical className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 border border-primary/20 text-red-400/40 hover:text-red-400 hover:bg-red-400/10 transition-none chamfer-sm"
            title="Remove server"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Error message */}
      {server.error_message && server.status === "error" && (
        <div className="px-4 pb-2">
          <div className="flex items-start gap-2 border border-red-400/20 bg-red-400/[0.04] chamfer-sm p-2">
            <AlertCircle className="w-3 h-3 text-red-400/60 shrink-0 mt-0.5" />
            <span className="text-[9px] text-red-400/70 font-body">{server.error_message}</span>
          </div>
        </div>
      )}

      {/* ── Expanded: Tools List ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/10 px-4 py-3 space-y-2">
              {/* Connection info */}
              <div className="flex items-center justify-between mb-1">
                <span className="hud-label flex items-center gap-1.5">
                  <Wrench className="w-3 h-3 text-primary/50" />
                  AVAILABLE TOOLS
                </span>
                <span className="text-[8px] text-foreground/20 font-mono truncate max-w-[300px]">
                  {server.url_or_command}
                </span>
              </div>

              {server.tools.length === 0 ? (
                <div className="border border-primary/10 bg-primary/[0.02] chamfer-sm p-4 text-center">
                  <p className="text-[9px] text-foreground/30 font-body">
                    No tools discovered.{" "}
                    {server.status !== "connected"
                      ? "Connect the server first."
                      : "The server may not expose any tools."}
                  </p>
                  {server.status !== "connected" && server.enabled && (
                    <button
                      onClick={onReconnect}
                      className="mt-2 font-display text-[8px] tracking-widest uppercase text-primary/50 hover:text-primary transition-none"
                    >
                      CLICK TO CONNECT
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {server.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className={`flex items-center gap-3 py-2 px-3 border chamfer-sm transition-none ${
                        tool.enabled
                          ? "border-primary/15 bg-primary/[0.03]"
                          : "border-primary/5 bg-primary/[0.01]"
                      }`}
                    >
                      <Toggle
                        enabled={tool.enabled}
                        onToggle={() => onToggleTool(tool.name, !tool.enabled)}
                        size="sm"
                      />

                      <div className="flex-1 min-w-0">
                        <span
                          className={`font-display text-[9px] tracking-widest uppercase ${
                            tool.enabled ? "text-foreground/70" : "text-foreground/30"
                          }`}
                        >
                          {tool.name}
                        </span>
                        {tool.description && (
                          <p className="text-[8px] text-foreground/25 font-body truncate mt-0.5">
                            {tool.description}
                          </p>
                        )}
                      </div>

                      <span
                        className="font-display text-[8px] tracking-widest shrink-0"
                        style={{ color: tool.enabled ? "#00ff88" : "rgba(255,46,46,0.3)" }}
                      >
                        {tool.enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Env vars display (if any) */}
              {Object.keys(server.env || {}).length > 0 && (
                <div className="border-t border-primary/10 pt-2 mt-2">
                  <span className="text-[8px] text-foreground/20 font-display tracking-widest uppercase">
                    ENVIRONMENT ({Object.keys(server.env).length} vars)
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ── Main MCP Settings Component ── */
const MCPSettings = () => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [stats, setStats] = useState<MCPStats>({ total_servers: 0, connected: 0, enabled: 0, total_tools: 0 });
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [reconnectingServer, setReconnectingServer] = useState<string | null>(null);

  const fetchServers = () => {
    fetch(`${API}/api/settings/mcp/servers`)
      .then((r) => r.json())
      .then((data) => {
        setServers(data.servers || []);
        setStats(data.stats || { total_servers: 0, connected: 0, enabled: 0, total_tools: 0 });
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleAdd = async (server: {
    name: string;
    url_or_command: string;
    transport: "sse" | "stdio";
    env: Record<string, string>;
    args: string[];
  }) => {
    try {
      await fetch(`${API}/api/settings/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(server),
      });
      setShowAddForm(false);
      fetchServers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await fetch(`${API}/api/settings/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
      fetchServers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleEnabled = async (name: string, currentEnabled: boolean) => {
    try {
      await fetch(`${API}/api/settings/mcp/servers/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      fetchServers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTest = async (name: string) => {
    setTestingServer(name);
    try {
      await fetch(`${API}/api/settings/mcp/servers/${encodeURIComponent(name)}/test`, { method: "POST" });
      fetchServers();
    } catch (e) {
      console.error(e);
    }
    setTestingServer(null);
  };

  const handleReconnect = async (name: string) => {
    setReconnectingServer(name);
    try {
      await fetch(`${API}/api/settings/mcp/servers/${encodeURIComponent(name)}/reconnect`, { method: "POST" });
      fetchServers();
    } catch (e) {
      console.error(e);
    }
    setReconnectingServer(null);
  };

  const handleToggleTool = async (serverName: string, toolName: string, enabled: boolean) => {
    try {
      await fetch(`${API}/api/settings/mcp/servers/${encodeURIComponent(serverName)}/tools`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tools: { [toolName]: enabled } }),
      });
      fetchServers();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── Header with Stats ── */}
      <div className="border border-primary/30 bg-primary/5 chamfer glow-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="hud-label flex items-center gap-2">
            <Plug className="w-3 h-3 text-primary" />
            MCP_SERVER_MANAGEMENT
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 border border-primary/30 px-3 py-1.5 font-display text-[9px] uppercase tracking-widest text-primary/60 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm"
          >
            <Plus className="w-3 h-3" />
            ADD SERVER
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label: "SERVERS", value: stats.total_servers, color: "#00d4ff" },
            { label: "CONNECTED", value: stats.connected, color: "#00ff88" },
            { label: "ENABLED", value: stats.enabled, color: "#ffaa00" },
            { label: "TOOLS", value: stats.total_tools, color: "#00d4ff" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="border border-primary/15 bg-primary/[0.02] chamfer-sm px-3 py-2 text-center"
            >
              <div className="font-display text-[14px] tabular-nums" style={{ color: stat.color }}>
                {stat.value}
              </div>
              <div className="font-display text-[7px] tracking-[0.15em] text-foreground/30 uppercase">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Add form */}
        <AnimatePresence>
          {showAddForm && (
            <AddServerForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
          )}
        </AnimatePresence>

        {!showAddForm && (
          <p className="text-[8px] text-foreground/20 font-body text-center tracking-wide">
            MCP servers extend F.R.I.D.A.Y. with external tools and capabilities
          </p>
        )}
      </div>

      {/* ── Server List ── */}
      {servers.length === 0 ? (
        <div className="border border-primary/10 bg-primary/[0.02] chamfer-sm p-8 text-center">
          <Plug className="w-8 h-8 text-primary/15 mx-auto mb-3" />
          <p className="font-display text-[10px] tracking-widest text-foreground/30 uppercase mb-1">
            No MCP servers configured
          </p>
          <p className="text-[9px] text-foreground/20 font-body max-w-xs mx-auto">
            Add an MCP server to extend F.R.I.D.A.Y. with external tools like database access,
            file systems, web browsing, and more.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-3 flex items-center gap-1.5 mx-auto border border-primary/20 px-4 py-2 font-display text-[9px] uppercase tracking-widest text-primary/50 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm"
          >
            <Plus className="w-3 h-3" />
            ADD YOUR FIRST SERVER
          </button>
        </div>
      ) : (
        servers.map((server) => (
          <ServerCard
            key={server.name}
            server={server}
            expanded={expandedServer === server.name}
            onToggleExpand={() =>
              setExpandedServer(expandedServer === server.name ? null : server.name)
            }
            onToggleEnabled={() => handleToggleEnabled(server.name, server.enabled)}
            onTest={() => handleTest(server.name)}
            onReconnect={() => handleReconnect(server.name)}
            onRemove={() => handleRemove(server.name)}
            onToggleTool={(toolName, enabled) => handleToggleTool(server.name, toolName, enabled)}
            testing={testingServer === server.name}
            reconnecting={reconnectingServer === server.name}
          />
        ))
      )}
    </div>
  );
};

export default MCPSettings;
