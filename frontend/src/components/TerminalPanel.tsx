import { motion } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import "@fontsource/jetbrains-mono/400.css";

export interface TerminalLine {
  text: string;
  type?: "info" | "success" | "error" | "system" | "data";
}

const lineColors: Record<string, string> = {
  info: "#00d4ff",
  success: "#00ff88",
  error: "#ff2e2e",
  system: "#888",
  data: "#00ff88",
};

const INITIAL_LINES: TerminalLine[] = [
  { text: "F.R.I.D.A.Y TERMINAL v1.0 — TACTICAL INTELLIGENCE SYSTEM", type: "system" },
  { text: "================================================", type: "system" },
  { text: "[SYS] BOOT SEQUENCE COMPLETE", type: "info" },
  { text: "[SYS] NEURAL CORE ONLINE", type: "info" },
  { text: "[SYS] ENCRYPTION LAYER: AES-512 ACTIVE", type: "success" },
  { text: "[SYS] AWAITING SCAN DIRECTIVE...", type: "system" },
  { text: "", type: "system" },
];

const TerminalPanel = () => {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stream initial lines on mount
  useEffect(() => {
    setLines(INITIAL_LINES);
  }, []);

  // Typing effect — reveal lines one by one
  useEffect(() => {
    if (visibleCount < lines.length) {
      const timer = setTimeout(() => {
        setVisibleCount((c) => c + 1);
      }, 80 + Math.random() * 60);
      return () => clearTimeout(timer);
    }
  }, [visibleCount, lines.length]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleCount]);

  // Public method to push lines (exposed via window for demo)
  const pushLines = useCallback((newLines: TerminalLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
  }, []);

  // Expose to window for cross-component use
  useEffect(() => {
    (window as any).__fridayTerminal = { pushLines };
    return () => { delete (window as any).__fridayTerminal; };
  }, [pushLines]);

  // WebSocket is managed by Index.tsx (with auto-reconnect).
  // Messages reach this terminal via window.__fridayTerminal.pushLines().

  const handleCopy = () => {
    const text = lines
      .slice(0, visibleCount)
      .map((l) => l.text)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: 0.1 }}
      className="flex flex-col border border-primary/30 glow-border chamfer overflow-hidden h-full"
      style={{ background: "rgba(5, 5, 10, 0.9)" }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/20 bg-primary/[0.03] shrink-0">
        <div className="flex items-center gap-2">
          <div className="status-active" />
          <span className="font-display text-[10px] tracking-[0.2em] text-primary/80 uppercase">
            F.R.I.D.A.Y TERMINAL V1.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] tracking-wider text-primary/40 uppercase font-display">
            {visibleCount}/{lines.length} LINES
          </span>
          <button
            onClick={handleCopy}
            className="border border-primary/30 px-2 py-0.5 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
          >
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-0.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", lineHeight: "1.6" }}
      >
        {lines.slice(0, visibleCount).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.05 }}
            className="whitespace-pre-wrap"
            style={{ color: lineColors[line.type || "data"] }}
          >
            {line.text || "\u00A0"}
          </motion.div>
        ))}
        {visibleCount >= lines.length && (
          <div className="flex items-center gap-1">
            <span style={{ color: "#00ff88" }}>{">"}</span>
            <span className="animate-blink" style={{ color: "#00ff88" }}>█</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default TerminalPanel;
