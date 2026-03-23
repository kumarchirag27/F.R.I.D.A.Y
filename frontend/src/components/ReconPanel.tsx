import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Trash2, ChevronDown, ChevronRight, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
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
  const [scanHistory, setScanHistory] = useState<
    { target: string; mode: string; time: string; date: string; status: string; summary: string }[]
  >([]);
  const [showHistory, setShowHistory] = useState(true);

  const fetchHistory = () => {
    fetch(`${API_BASE}/api/history`)
      .then((r) => r.json())
      .then((d) => setScanHistory(d.history || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/targets`)
      .then(r => r.json())
      .then(d => setAllowedTargets(d.targets || []))
      .catch(() => {});
    fetchHistory();
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

  const handleDeleteScan = async (index: number) => {
    try {
      await fetch(`${API_BASE}/api/history/${index}`, { method: "DELETE" });
      fetchHistory();
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch(`${API_BASE}/api/history`, { method: "DELETE" });
      fetchHistory();
    } catch (e) {
      console.error(e);
    }
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
        const r = data.result;
        const dns = r.run_dns_recon || {};
        const whois = r.run_whois_lookup || {};
        const ports = r.scan_ports || {};
        const headers = r.analyze_headers || {};
        const osint = r.run_osint_aggregator || {};
        const subs = r.run_subdomain_enum || {};
        const ipRecon = r.run_ip_recon || {};

        // Build DNS records — handle both {records:{A:[...]}} and flat {A:"val"} formats
        const dnsRecords: { type: string; name: string; value: string; ttl: string }[] = [];
        const dnsSource = dns.records || dns;
        Object.entries(dnsSource).forEach(([type, val]: [string, any]) => {
          if (type === "error" || type === "domain") return;
          if (Array.isArray(val)) {
            val.forEach((v: any) => dnsRecords.push({ type, name: target, value: String(v), ttl: "" }));
          } else if (val && String(val).trim()) {
            dnsRecords.push({ type, name: target, value: String(val), ttl: "" });
          }
        });

        // Build open ports — handle {open_ports:[...]}, {ports:"22,80"}, or {ports:[...]}
        let openPorts: any[] = [];
        if (Array.isArray(ports.open_ports)) {
          openPorts = ports.open_ports.map((p: any) => ({ port: p.port ?? p, service: p.service ?? "unknown", state: "open", risk: "LOW" }));
        } else if (ports.ports && typeof ports.ports === "string" && ports.ports.trim()) {
          openPorts = ports.ports.split(",").filter(Boolean).map((p: string) => ({ port: p.trim(), service: "unknown", state: "open", risk: "LOW" }));
        }

        // Build security headers
        const securityHeaders: any[] = [];
        if (Array.isArray(headers.missing_headers)) {
          headers.missing_headers.forEach((h: string) => securityHeaders.push({ header: h, status: "MISSING", value: "" }));
        }
        if (headers.headers && typeof headers.headers === "object") {
          Object.entries(headers.headers).forEach(([k, v]: [string, any]) => securityHeaders.push({ header: k, status: "PRESENT", value: String(v).slice(0, 80) }));
        }

        // Build OSINT findings
        const osintFindings: { finding: string; severity: string }[] = [];
        if (osint.virustotal) osintFindings.push({ finding: `VirusTotal: ${typeof osint.virustotal === "string" ? osint.virustotal : JSON.stringify(osint.virustotal).slice(0, 150)}`, severity: "MEDIUM" });
        const subList = Array.isArray(subs) ? subs : subs.subdomains;
        if (subList && subList.length > 0) osintFindings.push({ finding: `${subList.length} subdomains found`, severity: "LOW" });
        if (whois.registrar) osintFindings.push({ finding: `Registrar: ${whois.registrar}`, severity: "LOW" });
        if (whois.expiration_date) osintFindings.push({ finding: `Expires: ${whois.expiration_date}`, severity: "LOW" });
        const geo = ipRecon.geolocation;
        if (geo) osintFindings.push({ finding: `Location: ${typeof geo === "string" ? geo : JSON.stringify(geo).slice(0, 100)}`, severity: "LOW" });
        const shodan = ipRecon.shodan;
        if (shodan) osintFindings.push({ finding: `Shodan: ${typeof shodan === "string" ? shodan : JSON.stringify(shodan).slice(0, 120)}`, severity: "MEDIUM" });

        (window as any).__fridayLastResult = {
          target,
          timestamp: new Date().toISOString(),
          riskScore: securityHeaders.filter((h: any) => h.status === "MISSING").length > 3 ? 65 : 35,
          executiveSummary: data.message ?? "Scan complete.",
          dnsRecords,
          openPorts,
          osintFindings,
          securityHeaders,
        };
      }

      if ((window as any).__fridayTerminal) {
        (window as any).__fridayTerminal.pushLines([
          { text: `[SYS] ${data.message}`, type: "success" }
        ]);
      }
      window.dispatchEvent(new CustomEvent("fridayScanEvent", { detail: { type: "done" } }));
      fetchHistory(); // Refresh scan history table
    } catch (error: any) {
      if ((window as any).__fridayTerminal) {
        (window as any).__fridayTerminal.pushLines([
          { text: `[ERR] ${error.message}`, type: "error" }
        ]);
      }
      window.dispatchEvent(new CustomEvent("fridayScanEvent", { detail: { type: "done" } }));
      fetchHistory(); // Refresh even on error
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

      {/* ── Scan History Table ── */}
      <div className="mt-5 border-t border-primary/10 pt-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="hud-label flex items-center gap-2 hover:text-primary transition-none w-full"
        >
          {showHistory ? (
            <ChevronDown className="w-3 h-3 text-primary" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <Clock className="w-3 h-3" />
          SCAN_HISTORY ({scanHistory.length})
          {scanHistory.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleClearHistory(); }}
              className="ml-auto font-display text-[8px] tracking-widest text-red-400/40 hover:text-red-400 uppercase transition-none"
            >
              CLEAR ALL
            </button>
          )}
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              {scanHistory.length === 0 ? (
                <div className="mt-3 border border-primary/10 bg-primary/[0.02] chamfer-sm p-4 text-center">
                  <p className="font-display text-[9px] tracking-widest text-foreground/25 uppercase">
                    No scans executed yet
                  </p>
                </div>
              ) : (
                <div className="mt-3 border border-primary/15 chamfer-sm overflow-hidden max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,212,255,0.2) transparent" }}>
                  <table className="w-full text-[9px] uppercase tracking-wider">
                    <thead>
                      <tr className="bg-primary/[0.05] border-b border-primary/15 sticky top-0">
                        <th className="text-left px-3 py-2 text-primary/60 font-display">TARGET</th>
                        <th className="text-left px-3 py-2 text-primary/60 font-display">TYPE</th>
                        <th className="text-left px-3 py-2 text-primary/60 font-display">TIME</th>
                        <th className="text-left px-3 py-2 text-primary/60 font-display">STATUS</th>
                        <th className="text-right px-3 py-2 text-primary/60 font-display w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...scanHistory].reverse().map((scan, i) => {
                        const realIdx = scanHistory.length - 1 - i;
                        const statusIcon = scan.status === "done" ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />
                        ) : scan.status === "error" ? (
                          <AlertCircle className="w-3 h-3 text-red-400/60" />
                        ) : (
                          <Loader2 className="w-3 h-3 text-primary/40 animate-spin" />
                        );
                        return (
                          <tr
                            key={`${scan.date}-${i}`}
                            className="border-b border-primary/5 hover:bg-primary/[0.03] group"
                          >
                            <td className="px-3 py-1.5 text-primary/70 font-display truncate max-w-[120px]">
                              {scan.target}
                            </td>
                            <td className="px-3 py-1.5 text-foreground/40">{scan.mode}</td>
                            <td className="px-3 py-1.5 text-foreground/30 font-mono">{scan.time}</td>
                            <td className="px-3 py-1.5">{statusIcon}</td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                onClick={() => handleDeleteScan(realIdx)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-red-400/40 hover:text-red-400 transition-none"
                                title="Delete scan"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default ReconPanel;
