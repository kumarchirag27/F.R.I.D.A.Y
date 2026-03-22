import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { API_BASE } from "@/lib/config";

const scanTypes = [
  "DNS RECON",
  "IP INTEL",
  "PORT SCAN",
  "SUBDOMAIN ENUM",
  "HEADER ANALYSIS",
  "FULL OSINT",
] as const;

const ReconPanel = () => {
  const [target, setTarget] = useState("");
  const [scanType, setScanType] = useState<string>(scanTypes[0]);
  const [authorized, setAuthorized] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [allowedTargets, setAllowedTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState("");
  const [showTargetMgr, setShowTargetMgr] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/targets`)
      .then(r => r.json())
      .then(d => setAllowedTargets(d.targets || []))
      .catch(() => {});
  }, []);

  const handleAddTarget = async () => {
    const t = newTarget.trim();
    if (!t) return;
    try {
      const res = await fetch(`${API_BASE}/api/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: t })
      });
      const data = await res.json();
      setAllowedTargets(data.targets || []);
      setNewTarget("");
    } catch (e) { console.error(e); }
  };

  const canExecute = target.trim().length > 0 && authorized;

  const handleExecute = async () => {
    if (!canExecute) return;
    
    // push initial line
    if ((window as any).__fridayTerminal) {
      (window as any).__fridayTerminal.pushLines([
        { text: `\n[SYS] INITIATING ${scanType} ON ${target}...`, type: "info" }
      ]);
    }
    // Signal scan start to progress widget
    window.dispatchEvent(new CustomEvent("fridayScanEvent", { detail: { type: "start" } }));

    try {
      const resp = await fetch(`${API_BASE}/api/friday`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `Run ${scanType} against ${target}`,
          target: target,
          mode: scanType,
          authorized: authorized
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || "Execution failed");
      }

      const data = await resp.json();

      // Store result for IntelReportPanel
      if (data.result) {
        (window as any).__fridayLastResult = {
          target,
          timestamp: new Date().toISOString(),
          riskScore: data.result.risk_score ?? 50,
          executiveSummary: data.message ?? "Scan complete.",
          dnsRecords: data.result.dns_records ?? [],
          openPorts: data.result.open_ports ?? [],
          osintFindings: data.result.osint_findings ?? [],
          securityHeaders: data.result.security_headers ?? [],
        };
      }

      if ((window as any).__fridayTerminal) {
        (window as any).__fridayTerminal.pushLines([
          { text: `[SYS] ${data.message}`, type: "success" }
        ]);
      }
      window.dispatchEvent(new CustomEvent("fridayScanEvent", { detail: { type: "done" } }));
    } catch (error: any) {
      if ((window as any).__fridayTerminal) {
        (window as any).__fridayTerminal.pushLines([
          { text: `[ERR] ${error.message}`, type: "error" }
        ]);
      }
      window.dispatchEvent(new CustomEvent("fridayScanEvent", { detail: { type: "done" } }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: 0.25 }}
      className="border border-primary/30 bg-primary/5 chamfer glow-border p-5"
    >
      <div className="hud-label mb-4 flex items-center gap-2">
        <div className="status-active" />
        RECON_PANEL
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4 mb-4">
        {/* Target input */}
        <div>
          <label className="hud-label mb-2 block">TARGET</label>
          <div className="border border-primary/30 bg-primary/[0.03] chamfer-sm">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="ENTER TARGET (DOMAIN / IP)"
              className="w-full bg-transparent px-4 py-3 text-foreground placeholder-primary/25 focus:outline-none font-display text-xs uppercase tracking-widest"
            />
          </div>
        </div>

        {/* Scan type dropdown */}
        <div>
          <label className="hud-label mb-2 block">SCAN_TYPE</label>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full border border-primary/30 bg-primary/[0.03] chamfer-sm px-4 py-3 text-left font-display text-xs uppercase tracking-widest text-foreground/80 flex items-center justify-between hover:bg-primary/10 transition-none"
            >
              {scanType}
              <svg width="10" height="6" viewBox="0 0 10 6" className="text-primary/60">
                <path d="M0 0L5 6L10 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>

            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.1 }}
                className="absolute z-50 w-full mt-1 border border-primary/30 bg-background/95 backdrop-blur-md chamfer-sm overflow-hidden"
                style={{ boxShadow: "0 0 12px rgba(0,212,255,0.2)" }}
              >
                {scanTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => { setScanType(type); setDropdownOpen(false); }}
                    className={`w-full px-4 py-2.5 text-left font-display text-xs uppercase tracking-widest transition-none ${
                      scanType === type
                        ? "bg-primary/15 text-primary"
                        : "text-foreground/60 hover:bg-primary/10 hover:text-foreground/90"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Authorization + Execute row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Authorization checkbox */}
        <label className="flex items-center gap-3 cursor-pointer group">
          <div
            onClick={() => setAuthorized(!authorized)}
            className={`w-4 h-4 border flex items-center justify-center transition-none ${
              authorized
                ? "border-primary bg-primary/20"
                : "border-primary/40 bg-primary/[0.03]"
            }`}
          >
            {authorized && (
              <motion.svg
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.1 }}
                width="10" height="8" viewBox="0 0 10 8"
              >
                <path d="M1 4L4 7L9 1" fill="none" stroke="hsl(191,100%,50%)" strokeWidth="1.5" />
              </motion.svg>
            )}
          </div>
          <span className="text-xs uppercase tracking-wider text-foreground/50 group-hover:text-foreground/70 transition-none">
            I CONFIRM I AM AUTHORIZED TO SCAN THIS TARGET
          </span>
        </label>

        {/* Execute button */}
        <motion.button
          onClick={handleExecute}
          whileHover={canExecute ? { backgroundColor: "rgba(0, 212, 255, 0.3)", x: 2 } : {}}
          whileTap={canExecute ? { scale: 0.98 } : {}}
          transition={{ duration: 0 }}
          disabled={!canExecute}
          className={`chamfer-sm font-display text-xs uppercase tracking-[0.2em] px-8 py-3 border transition-none ${
            canExecute
              ? "border-primary bg-primary/15 text-primary glow-border cursor-pointer hover:bg-primary/25"
              : "border-primary/20 bg-primary/[0.03] text-primary/30 cursor-not-allowed"
          }`}
        >
          ▶ EXECUTE
        </motion.button>
      </div>

      {/* Allowed Targets Manager */}
      <div className="mt-5 border-t border-primary/10 pt-4">
        <button
          onClick={() => setShowTargetMgr(!showTargetMgr)}
          className="hud-label flex items-center gap-2 hover:text-primary transition-none"
        >
          <span style={{ color: showTargetMgr ? "#00d4ff" : undefined }}>▶</span>
          ALLOWED_TARGETS ({allowedTargets.length})
        </button>
        {showTargetMgr && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {allowedTargets.map((t) => (
                <span key={t} className="font-display text-[9px] tracking-widest border border-primary/30 bg-primary/5 px-2 py-1 text-primary/70">
                  {t}
                </span>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddTarget()}
                placeholder="ADD AUTHORIZED TARGET..."
                className="flex-1 bg-primary/[0.03] border border-primary/20 px-3 py-2 text-xs uppercase tracking-widest font-display text-foreground/70 placeholder-primary/20 focus:outline-none focus:border-primary/50"
              />
              <button
                onClick={handleAddTarget}
                className="border border-primary/40 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/70 hover:bg-primary/10 hover:text-primary transition-none"
              >
                + ADD
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default ReconPanel;
