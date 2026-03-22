import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/config";

interface AuditLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const severityColor = (line: string) => {
  if (line.includes("UNAUTHORIZED") || line.includes("WARNING") || line.includes("out-of-scope"))
    return "#ff2e2e";
  if (line.includes("Authorized") || line.includes("scan initiated"))
    return "#00ff88";
  if (line.includes("target added"))
    return "#ffaa00";
  return "rgba(200,220,230,0.6)";
};

const AuditLogViewer = ({ isOpen, onClose }: AuditLogViewerProps) => {
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/auditlog?lines=200`)
      .then(r => r.json())
      .then(d => setEntries((d.entries || []).reverse()))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isOpen) fetchLogs();
  }, [isOpen, fetchLogs]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[60]"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed right-0 top-0 h-full w-full max-w-[640px] z-[70] border-l border-primary/30 glow-border flex flex-col"
            style={{ background: "rgba(5, 5, 10, 0.97)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-primary/20 bg-primary/[0.03] shrink-0">
              <div className="flex items-center gap-3">
                <div className="status-active" />
                <span className="font-display text-[11px] tracking-[0.2em] text-primary uppercase">
                  AUDIT_LOG
                </span>
                <span className="font-display text-[9px] text-primary/40 tracking-widest">
                  {entries.length} ENTRIES
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchLogs}
                  className="border border-primary/30 px-3 py-1 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
                >
                  ↻ REFRESH
                </button>
                <button
                  onClick={onClose}
                  className="border border-primary/30 w-7 h-7 flex items-center justify-center text-primary/60 hover:bg-primary/10 hover:text-primary transition-none font-display text-xs"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Log body */}
            <div className="flex-1 overflow-y-auto p-4 font-mono">
              {loading && (
                <div className="text-primary/40 text-xs tracking-widest animate-pulse">LOADING AUDIT LOG...</div>
              )}
              {!loading && entries.length === 0 && (
                <div className="text-foreground/30 text-xs uppercase tracking-widest">NO AUDIT LOG ENTRIES FOUND</div>
              )}
              {entries.map((entry, i) => (
                <div
                  key={i}
                  className="text-[10px] leading-5 border-b border-primary/5 py-1"
                  style={{ color: severityColor(entry) }}
                >
                  {entry}
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AuditLogViewer;
