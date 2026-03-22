import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface WidgetCardProps {
  title: string;
  children: React.ReactNode;
  delay?: number;
}

const WidgetCard = ({ title, children, delay = 0 }: WidgetCardProps) => (
  <motion.div
    initial={{ opacity: 0, scale: 1.05 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.15, delay }}
    className="border border-primary/30 bg-primary/5 p-3 chamfer-sm glow-border"
  >
    <div className="hud-label mb-2 flex items-center gap-2">
      <div className="status-active" />
      {title}
    </div>
    {children}
  </motion.div>
);

// ── System Status (live from backend) ──
const SystemStatusWidget = () => {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${API_BASE}/api/status`)
        .then(r => r.json())
        .then(d => setStatus(d))
        .catch(() => setStatus(null));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const isOnline = !!status;

  return (
    <WidgetCard title="SYSTEM_STATUS" delay={0.2}>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">F.R.I.D.A.Y</span>
          <span
            className={`font-display text-[10px] tracking-widest px-2 py-0.5 border ${
              isOnline ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-destructive/40 text-destructive bg-destructive/10"
            }`}
          >{isOnline ? "ONLINE" : "OFFLINE"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">UPTIME</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">{status?.uptime ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">SCANS RUN</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">{status?.scan_count ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">TARGETS</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">{status?.allowed_targets_count ?? 0}</span>
        </div>
      </div>
    </WidgetCard>
  );
};

// ── Scan Progress (reflects current WS activity) ──
const ScanProgressWidget = () => {
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [label, setLabel] = useState("IDLE");

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.type === "start") { setScanning(true); setProgress(0); setLabel("SCANNING"); }
      if (e.detail?.type === "progress") setProgress(p => Math.min(p + 15, 95));
      if (e.detail?.type === "done") { setScanning(false); setProgress(100); setLabel("COMPLETE"); }
    };
    window.addEventListener("fridayScanEvent" as any, handler);
    return () => window.removeEventListener("fridayScanEvent" as any, handler);
  }, []);

  return (
    <WidgetCard title="SCAN_PROGRESS" delay={0.25}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">{label}</span>
          <span className="font-display text-xs text-primary glow-text tracking-wider">{Math.floor(progress)}%</span>
        </div>
        <div className="h-1.5 bg-primary/10 w-full relative overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
            style={{ boxShadow: "0 0 8px rgba(0,212,255,0.5)" }}
          />
        </div>
        {scanning && (
          <div className="font-display text-[9px] text-primary/50 tracking-widest animate-pulse">◉ RUNNING</div>
        )}
      </div>
    </WidgetCard>
  );
};

// ── Threat Level ──
const threatLevels = [
  { level: "LOW", color: "#00ff88", bg: "rgba(0,255,136,0.1)", border: "rgba(0,255,136,0.4)" },
  { level: "MEDIUM", color: "#ffaa00", bg: "rgba(255,170,0,0.1)", border: "rgba(255,170,0,0.4)" },
  { level: "HIGH", color: "#ff6622", bg: "rgba(255,102,34,0.1)", border: "rgba(255,102,34,0.4)" },
  { level: "CRITICAL", color: "#ff2e2e", bg: "rgba(255,46,46,0.1)", border: "rgba(255,46,46,0.4)" },
] as const;

const ThreatLevelWidget = () => {
  const [threatIdx, setThreatIdx] = useState(0);
  const threat = threatLevels[threatIdx];
  return (
    <WidgetCard title="THREAT_LEVEL" delay={0.3}>
      <div className="space-y-2">
        <div
          className="flex items-center justify-center py-2 border font-display text-sm tracking-[0.3em]"
          style={{ color: threat.color, backgroundColor: threat.bg, borderColor: threat.border, textShadow: `0 0 10px ${threat.color}` }}
        >{threat.level}</div>
        <div className="flex gap-1">
          {threatLevels.map((t, i) => (
            <button key={t.level} onClick={() => setThreatIdx(i)}
              className="flex-1 py-1 border text-[8px] font-display uppercase tracking-wider transition-none"
              style={{
                borderColor: threatIdx === i ? t.border : "rgba(0,212,255,0.1)",
                color: threatIdx === i ? t.color : "rgba(255,255,255,0.2)",
                backgroundColor: threatIdx === i ? t.bg : "transparent",
              }}
            >{t.level.slice(0, 3)}</button>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
};

// ── Scan History (live from backend) ──
const ScanHistoryWidget = () => {
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = () => {
      fetch(`${API_BASE}/api/history`)
        .then(r => r.json())
        .then(d => setHistory((d.history || []).reverse()))
        .catch(() => {});
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <WidgetCard title="SCAN_HISTORY" delay={0.35}>
      <div className="space-y-1">
        {history.length === 0 && (
          <div className="text-[10px] text-foreground/30 uppercase tracking-wider">NO SCANS YET</div>
        )}
        {history.slice(0, 5).map((scan, i) => (
          <div key={i} className="flex items-center gap-2 px-1 py-1">
            <div className="status-active" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-foreground/70 truncate">{scan.target}</div>
              <div className="text-[8px] uppercase tracking-wider text-foreground/30">{scan.mode} // {scan.time}</div>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
};

// ── Token Usage (live from backend) ──
interface TokenSlotData {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  requests: number;
}

interface TokenUsageData {
  slots: Record<string, TokenSlotData>;
  totals: TokenSlotData;
  session_uptime_seconds: number;
}

const TokenUsageWidget = () => {
  const [usage, setUsage] = useState<TokenUsageData | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const fetchUsage = () => {
      fetch(`${API_BASE}/api/token-usage`)
        .then((r) => {
          if (!r.ok) return null;
          return r.json();
        })
        .then((d) => {
          if (d && d.slots && d.totals) setUsage(d);
        })
        .catch(() => {});
    };
    fetchUsage();
    const interval = setInterval(fetchUsage, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      await fetch(`${API_BASE}/api/token-usage/reset`, { method: "POST" });
      const r = await fetch(`${API_BASE}/api/token-usage`);
      if (r.ok) {
        const d = await r.json();
        if (d && d.slots && d.totals) setUsage(d);
      }
    } catch {
      // ignore
    }
    setResetting(false);
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const totals = usage?.totals;

  return (
    <WidgetCard title="TOKEN_USAGE" delay={0.4}>
      <div className="space-y-2">
        {/* Totals */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">TOTAL TOKENS</span>
          <span className="font-display text-xs text-primary glow-text tracking-wider">
            {totals ? formatNumber(totals.total_tokens) : "0"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">PROMPT</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">
            {totals ? formatNumber(totals.prompt_tokens) : "0"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">COMPLETION</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">
            {totals ? formatNumber(totals.completion_tokens) : "0"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50">REQUESTS</span>
          <span className="font-display text-[10px] text-primary/70 tracking-wider">
            {totals ? totals.requests : 0}
          </span>
        </div>

        {/* Per-slot mini bars */}
        <div className="border-t border-primary/10 pt-2 space-y-1.5">
          {usage?.slots &&
            (["rest", "chat", "voice"] as const).map((slot) => {
              const s = usage.slots[slot];
              if (!s) return null;
              const pct = totals && totals.total_tokens > 0
                ? Math.round((s.total_tokens / totals.total_tokens) * 100)
                : 0;
              return (
                <div key={slot}>
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[8px] tracking-widest text-foreground/40 uppercase">
                      {slot}
                    </span>
                    <span className="font-display text-[8px] tracking-wider text-primary/50">
                      {formatNumber(s.total_tokens)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1 bg-primary/10 w-full relative overflow-hidden mt-0.5">
                    <motion.div
                      className="h-full bg-primary/40"
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              );
            })}
        </div>

        {/* Reset button */}
        <div className="flex justify-end pt-1">
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1 border border-primary/20 px-2 py-0.5 font-display text-[8px] uppercase tracking-widest text-primary/30 hover:text-primary hover:bg-primary/10 transition-none chamfer-sm disabled:opacity-30"
          >
            <RotateCcw className={`w-2.5 h-2.5 ${resetting ? "animate-spin" : ""}`} />
            RESET
          </button>
        </div>
      </div>
    </WidgetCard>
  );
};

const StatusWidgets = () => (
  <div className="flex flex-col gap-3">
    <SystemStatusWidget />
    <ScanProgressWidget />
    <TokenUsageWidget />
    <ThreatLevelWidget />
    <ScanHistoryWidget />
  </div>
);

export default StatusWidgets;
