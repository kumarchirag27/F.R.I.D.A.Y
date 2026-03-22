import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { API_BASE, WS_URL } from "@/lib/config";
import NavBar from "@/components/NavBar";
import CoreBlob, { type BlobState } from "@/components/CoreBlob";
import ReconPanel from "@/components/ReconPanel";
import TerminalPanel from "@/components/TerminalPanel";
import StatusWidgets from "@/components/StatusWidgets";
import IntelReportPanel from "@/components/IntelReportPanel";
import VoiceInterface from "@/components/VoiceInterface";
import AuditLogViewer from "@/components/AuditLogViewer";
import SettingsPanel from "@/components/settings/SettingsPanel";

const TelemetryItem = ({ label, value, unit = "" }: { label: string; value: string; unit?: string }) => (
  <div className="flex items-center justify-between gap-4 py-1">
    <span className="hud-label">{label}</span>
    <span className="font-display text-sm text-primary glow-text tracking-wider">
      {value}<span className="text-primary/50 text-xs ml-1">{unit}</span>
    </span>
  </div>
);

const StatusDot = ({ active = true }: { active?: boolean }) => (
  <div className={active ? "status-active" : "status-idle"} />
);

const ModuleCard = ({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, scale: 1.05 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.15, delay }}
    className="border border-primary/30 bg-primary/5 p-3 chamfer glow-border"
  >
    <div className="hud-label mb-2 flex items-center gap-2">
      <StatusDot />
      {title}
    </div>
    {children}
  </motion.div>
);

const WaveformBar = ({ height, delay }: { height: number; delay: number }) => (
  <motion.div
    className="w-[2px] bg-primary/60"
    animate={{ height: [height * 0.3, height, height * 0.5, height * 0.8, height * 0.3] }}
    transition={{ duration: 1.5, repeat: Infinity, delay, ease: "easeInOut" }}
  />
);

const Waveform = () => (
  <div className="flex items-end gap-[2px] h-8">
    {Array.from({ length: 32 }).map((_, i) => (
      <WaveformBar key={i} height={20 + Math.random() * 12} delay={i * 0.05} />
    ))}
  </div>
);

const blobStates: BlobState[] = ["idle", "listening", "processing", "responding"];

const Index = () => {
  const [activeTab, setActiveTab] = useState("DASHBOARD");
  const [input, setInput] = useState("");
  const [blobState, setBlobState] = useState<BlobState>("idle");
  const [reportOpen, setReportOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<"passive" | "listening" | "processing" | "responding">("passive");

  // WebSocket with auto-reconnect
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        attempt = 0;
        if ((window as any).__fridayTerminal) {
          (window as any).__fridayTerminal.pushLines([{ text: "[SYS] WEBSOCKET CONNECTED TO BACKEND", type: "success" }]);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "info" && (window as any).__fridayTerminal) {
            (window as any).__fridayTerminal.pushLines([{ text: data.message, type: "data" }]);
          }
        } catch {
          if ((window as any).__fridayTerminal) {
            (window as any).__fridayTerminal.pushLines([{ text: event.data, type: "data" }]);
          }
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt++;
        if ((window as any).__fridayTerminal) {
          (window as any).__fridayTerminal.pushLines([{ text: `[SYS] WEBSOCKET DISCONNECTED. RECONNECTING IN ${delay / 1000}s...`, type: "error" }]);
        }
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // Real system metrics polling
  const [metrics, setMetrics] = useState({ cpu_percent: 0, memory_used_gb: 0, core_temp: null as number | null, threads: 0 });
  const [network, setNetwork] = useState({ latency_ms: null as number | null, active_interfaces: 0, bytes_sent: 0, bytes_recv: 0, uplink: false });

  useEffect(() => {
    const fetchMetrics = () => {
      fetch(`${API_BASE}/api/metrics`).then(r => r.json()).then(setMetrics).catch(() => {});
      fetch(`${API_BASE}/api/network`).then(r => r.json()).then(setNetwork).catch(() => {});
    };
    fetchMetrics();
    const id = setInterval(fetchMetrics, 3000);
    return () => clearInterval(id);
  }, []);

  const handleToggle = () => {
    setBlobState(s => {
      const idx = blobStates.indexOf(s);
      return blobStates[(idx + 1) % blobStates.length];
    });
  };

  const handleVoiceStateChange = (state: "passive" | "listening" | "processing" | "responding") => {
    setVoiceState(state);
    if (state === "listening") setBlobState("listening");
    else if (state === "processing") setBlobState("processing");
    else if (state === "responding") setBlobState("responding");
    else setBlobState("idle");
  };

  return (
    <div className="min-h-svh bg-background text-foreground font-body relative overflow-hidden">
      {/* Background layers */}
      <div className="fixed inset-0 bg-grid-animated pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none z-50" />

      {/* Main content */}
      <div className="relative z-10 min-h-svh flex flex-col p-3 md:p-6 gap-3">
        
        <NavBar voiceState={voiceState} onAuditLog={() => setAuditLogOpen(true)} activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Dashboard grid — 3 columns */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[240px_1fr_300px] gap-3 min-h-0">
          
          {/* Left column — Telemetry + Status Widgets */}
          <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100svh-140px)] pr-1">
            <ModuleCard title="SYSTEM_METRICS" delay={0.05}>
              <div className="space-y-1">
                <TelemetryItem label="CPU_LOAD" value={String(metrics.cpu_percent)} unit="%" />
                <TelemetryItem label="MEMORY" value={String(metrics.memory_used_gb)} unit="GB" />
                <TelemetryItem label="CORE_TEMP" value={metrics.core_temp !== null ? String(metrics.core_temp) : "N/A"} unit={metrics.core_temp !== null ? "°C" : ""} />
                <TelemetryItem label="THREADS" value={metrics.threads.toLocaleString()} />
              </div>
            </ModuleCard>

            <ModuleCard title="NETWORK_STATUS" delay={0.1}>
              <div className="space-y-1">
                <TelemetryItem label="UPLINK" value={network.uplink ? "ONLINE" : "OFFLINE"} />
                <TelemetryItem label="LATENCY" value={network.latency_ms !== null ? String(network.latency_ms) : "N/A"} unit={network.latency_ms !== null ? "MS" : ""} />
                <TelemetryItem label="SENT" value={(network.bytes_sent / (1024 ** 2)).toFixed(1)} unit="MB" />
                <TelemetryItem label="INTERFACES" value={String(network.active_interfaces)} />
              </div>
            </ModuleCard>

            <ModuleCard title="SIGNAL_ANALYSIS" delay={0.15}>
              <Waveform />
              <div className="mt-2 hud-label">FREQ: 2.4GHZ // AMPLITUDE: NOMINAL</div>
            </ModuleCard>

            {/* Status widgets inline */}
            <StatusWidgets />
          </div>

          {activeTab === "SETTINGS" ? (
            /* Settings panel — spans center + right columns */
            <div className="lg:col-span-2 flex flex-col min-h-0 overflow-y-auto max-h-[calc(100svh-140px)] pr-1">
              <SettingsPanel />
            </div>
          ) : (
            <>
              {/* Center column — Blob + Recon + Command */}
              <div className="flex flex-col gap-3 min-h-0">
                <div className="flex-1 border border-primary/20 bg-primary/[0.02] chamfer relative min-h-[280px]">
                  <CoreBlob state={blobState} onToggleListen={handleToggle} />
                </div>
                <VoiceInterface onStateChange={handleVoiceStateChange} />
                <ReconPanel />

                {/* Bottom command bar */}
                <div className="flex gap-2 items-center">
                  {/* Command input */}
                  <div className="flex-1 bg-primary/5 border border-primary/30 glow-border chamfer">
                    <div className="flex items-center">
                      <span className="text-primary/40 font-display text-xs pl-3 pr-1 tracking-widest">&gt;</span>
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="AWAITING COMMAND..."
                        className="w-full bg-transparent border-none py-2.5 px-2 text-foreground placeholder-primary/25 focus:outline-none font-display uppercase tracking-widest text-xs"
                      />
                      <span className="text-primary animate-blink font-display text-sm px-2">_</span>
                      <div className="flex items-center gap-1.5 pr-3 shrink-0">
                        {[true, true, true, false].map((active, i) => (
                          <StatusDot key={i} active={active} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Intel report button */}
                  <button
                    onClick={() => setReportOpen(true)}
                    className="chamfer-sm font-display text-[9px] uppercase tracking-[0.15em] px-4 py-2.5 border border-primary/30 bg-primary/5 text-primary/50 glow-border hover:bg-primary/15 hover:text-primary transition-none whitespace-nowrap shrink-0"
                  >
                    ◆ INTEL REPORT
                  </button>
                </div>
              </div>

              {/* Right column — Terminal */}
              <div className="flex flex-col min-h-[400px] max-h-[calc(100svh-140px)]">
                <TerminalPanel />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Intelligence Report slide-in panel */}
      <IntelReportPanel isOpen={reportOpen} onClose={() => setReportOpen(false)} />

      {/* Audit Log Viewer */}
      <AuditLogViewer isOpen={auditLogOpen} onClose={() => setAuditLogOpen(false)} />
    </div>
  );
};

export default Index;
