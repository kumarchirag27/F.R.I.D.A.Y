import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Mic } from "lucide-react";

const navLinks = ["DASHBOARD", "RECON", "INTEL", "SETTINGS"] as const;

type VoiceState = "passive" | "listening" | "processing" | "responding";

interface NavBarProps {
  voiceState?: VoiceState;
  onAuditLog?: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const voiceStateConfig: Record<VoiceState, { color: string; label: string; glow: string }> = {
  passive:    { color: "rgba(52,211,153,0.5)",  label: "PASSIVE",    glow: "0 0 6px rgba(52,211,153,0.4)" },
  listening:  { color: "rgba(52,211,153,1)",     label: "LISTENING",  glow: "0 0 10px rgba(52,211,153,0.8)" },
  processing: { color: "rgba(0,212,255,1)",      label: "PROCESSING", glow: "0 0 10px rgba(0,212,255,0.8)" },
  responding: { color: "rgba(0,212,255,1)",      label: "RESPONDING", glow: "0 0 10px rgba(0,212,255,0.8)" },
};

const NavBar = ({ voiceState = "passive", onAuditLog, activeTab = "DASHBOARD", onTabChange }: NavBarProps) => {
  const [time, setTime] = useState(new Date());
  const activeLink = activeTab;

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const vsConfig = voiceStateConfig[voiceState];

  return (
    <motion.nav
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="navbar-glass border border-primary/30 chamfer glow-border px-6 py-3 flex items-center justify-between relative z-40"
    >
      {/* Left — Logo */}
      <div className="flex items-center gap-3 min-w-[180px]">
        <div className="relative flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 bg-primary" style={{ boxShadow: "0 0 6px rgba(0,212,255,0.8)" }} />
          </span>
          <span className="font-display text-lg tracking-[0.3em] text-primary glow-text">F.R.I.D.A.Y</span>
        </div>
        <div className="h-4 w-px bg-primary/20 ml-1" />
        <span className="hud-label hidden md:inline">V4.7</span>
      </div>

      {/* Center — Nav links */}
      <div className="flex items-center gap-1">
        {navLinks.map((link) => (
          <motion.button
            key={link}
            onClick={() => onTabChange?.(link)}
            whileHover={{ backgroundColor: "rgba(0, 212, 255, 0.15)", x: 2 }}
            transition={{ duration: 0 }}
            className={`relative px-4 py-2 font-display text-xs tracking-[0.15em] uppercase transition-none chamfer-sm ${
              activeLink === link
                ? "bg-primary/15 text-primary glow-text"
                : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {activeLink === link && (
              <motion.div
                layoutId="nav-active"
                className="absolute inset-0 border border-primary/40 chamfer-sm"
                transition={{ duration: 0.15 }}
              />
            )}
            {link}
          </motion.button>
        ))}
      </div>

      {/* Right — Status indicators + Voice state */}
      <div className="flex items-center gap-4 min-w-[220px] justify-end">
        {/* API status */}
        <div className="flex items-center gap-2">
          <div className="status-active" />
          <span className="hud-label hidden sm:inline">API</span>
        </div>

        <div className="h-4 w-px bg-primary/20" />

        {/* Audit Log button */}
        <button
          onClick={onAuditLog}
          className="border border-primary/20 px-2 py-1 font-display text-[9px] uppercase tracking-widest text-primary/40 hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-none chamfer-sm"
        >
          AUDIT
        </button>

        <div className="h-4 w-px bg-primary/20" />

        {/* Voice state indicator (always on, no click needed) */}
        <div className="relative flex items-center gap-2 px-3 py-1.5 border border-primary/20 chamfer-sm bg-primary/5">
          <Mic className="w-3.5 h-3.5" style={{ color: vsConfig.color }} />
          <span
            className="hidden sm:inline font-display text-[10px] tracking-[0.15em] uppercase"
            style={{ color: vsConfig.color }}
          >
            {vsConfig.label}
          </span>
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: vsConfig.color, boxShadow: vsConfig.glow }}
          />
          {/* Pulse ring when listening */}
          <AnimatePresence>
            {voiceState === "listening" && (
              <motion.div
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 border chamfer-sm"
                style={{ borderColor: vsConfig.color }}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="h-4 w-px bg-primary/20" />

        {/* Digital clock */}
        <div className="font-display text-sm text-primary/80 tracking-[0.2em] tabular-nums glow-text">
          {formatTime(time)}
        </div>
      </div>
    </motion.nav>
  );
};

export default NavBar;
