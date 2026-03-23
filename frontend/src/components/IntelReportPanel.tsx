import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { API_BASE } from "@/lib/config";

// ── Empty report template (shown when no scan has been run yet) ──
const emptyReport = {
  target: "NO_TARGET",
  timestamp: new Date().toISOString(),
  riskScore: 0,
  executiveSummary: "NO SCAN DATA AVAILABLE. EXECUTE A RECONNAISSANCE SCAN TO GENERATE AN INTELLIGENCE REPORT.",
  dnsRecords: [] as { type: string; name: string; value: string; ttl: string }[],
  openPorts: [] as { port: number; service: string; state: string; risk: string }[],
  osintFindings: [] as { finding: string; severity: string }[],
  securityHeaders: [] as { header: string; status: string; value: string }[],
};

const severityColor: Record<string, { text: string; bg: string; border: string }> = {
  LOW: { text: "#00ff88", bg: "rgba(0,255,136,0.1)", border: "rgba(0,255,136,0.4)" },
  MEDIUM: { text: "#ffaa00", bg: "rgba(255,170,0,0.1)", border: "rgba(255,170,0,0.4)" },
  HIGH: { text: "#ff6622", bg: "rgba(255,102,34,0.1)", border: "rgba(255,102,34,0.4)" },
  CRITICAL: { text: "#ff2e2e", bg: "rgba(255,46,46,0.1)", border: "rgba(255,46,46,0.4)" },
};

const SeverityBadge = ({ severity }: { severity: string }) => {
  const c = severityColor[severity] || severityColor.LOW;
  return (
    <span
      className="font-display text-[9px] tracking-widest px-2 py-0.5 border uppercase"
      style={{ color: c.text, backgroundColor: c.bg, borderColor: c.border }}
    >
      {severity}
    </span>
  );
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="hud-label text-[11px] mb-2 mt-5 flex items-center gap-2 first:mt-0">
    <div className="status-active" />
    {children}
  </div>
);

// ── Risk gauge ──
const RiskGauge = ({ score }: { score: number }) => {
  const angle = (score / 100) * 180 - 90; // -90 to 90
  const color =
    score < 30 ? "#00ff88" : score < 60 ? "#ffaa00" : score < 80 ? "#ff6622" : "#ff2e2e";

  return (
    <div className="flex flex-col items-center py-3">
      <svg viewBox="0 0 200 110" className="w-48 h-24">
        {/* Background arc */}
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(0,212,255,0.1)" strokeWidth="8" />
        {/* Colored arc segments */}
        <path d="M 20 100 A 80 80 0 0 1 60 34" fill="none" stroke="#00ff88" strokeWidth="3" opacity="0.3" />
        <path d="M 60 34 A 80 80 0 0 1 100 20" fill="none" stroke="#ffaa00" strokeWidth="3" opacity="0.3" />
        <path d="M 100 20 A 80 80 0 0 1 140 34" fill="none" stroke="#ff6622" strokeWidth="3" opacity="0.3" />
        <path d="M 140 34 A 80 80 0 0 1 180 100" fill="none" stroke="#ff2e2e" strokeWidth="3" opacity="0.3" />
        {/* Needle */}
        <line
          x1="100" y1="100"
          x2={100 + 65 * Math.cos((angle * Math.PI) / 180)}
          y2={100 + 65 * Math.sin((angle * Math.PI) / 180)}
          stroke={color}
          strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
        <circle cx="100" cy="100" r="4" fill={color} />
      </svg>
      <div className="font-display text-2xl tracking-[0.3em] mt-1" style={{ color, textShadow: `0 0 10px ${color}` }}>
        {score}
      </div>
      <div className="hud-label mt-1">RISK_SCORE</div>
    </div>
  );
};

interface IntelReportPanelProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;
}

const IntelReportPanel = ({ isOpen, onClose, inline }: IntelReportPanelProps) => {
  // Poll for voice-triggered scan results
  const [voiceResult, setVoiceResult] = useState<any>(null);

  useEffect(() => {
    if (!inline) return;
    const poll = () => {
      fetch(`${API_BASE}/api/scan-result/latest`)
        .then((r) => r.json())
        .then((data) => {
          if (data && data.result) {
            const r = data.result;
            const dns = r.run_dns_recon || {};
            const whois = r.run_whois_lookup || {};
            const ports = r.scan_ports || {};
            const headers = r.analyze_headers || {};
            const osint = r.run_osint_aggregator || {};
            const subs = r.run_subdomain_enum || {};
            const ipRecon = r.run_ip_recon || {};

            // DNS — handle flat {A:"val"} or {records:{A:[...]}}
            const dnsRecords: any[] = [];
            const dnsSource = dns.records || dns;
            Object.entries(dnsSource).forEach(([type, val]: [string, any]) => {
              if (type === "error" || type === "domain") return;
              if (Array.isArray(val)) val.forEach((v: any) => dnsRecords.push({ type, name: data.target, value: String(v), ttl: "" }));
              else if (val && String(val).trim()) dnsRecords.push({ type, name: data.target, value: String(val), ttl: "" });
            });

            // Ports
            let openPorts: any[] = [];
            if (Array.isArray(ports.open_ports)) openPorts = ports.open_ports.map((p: any) => ({ port: p.port ?? p, service: p.service ?? "unknown", state: "open", risk: "LOW" }));
            else if (ports.ports && typeof ports.ports === "string" && ports.ports.trim()) openPorts = ports.ports.split(",").filter(Boolean).map((p: string) => ({ port: p.trim(), service: "unknown", state: "open", risk: "LOW" }));

            // Headers
            const securityHeaders: any[] = [];
            if (Array.isArray(headers.missing_headers)) headers.missing_headers.forEach((h: string) => securityHeaders.push({ header: h, status: "MISSING", value: "" }));
            if (headers.headers) Object.entries(headers.headers).forEach(([k, v]: [string, any]) => securityHeaders.push({ header: k, status: "PRESENT", value: String(v).slice(0, 80) }));

            // OSINT
            const osintFindings: any[] = [];
            if (osint.virustotal) osintFindings.push({ finding: `VirusTotal: ${typeof osint.virustotal === "string" ? osint.virustotal : JSON.stringify(osint.virustotal).slice(0, 150)}`, severity: "MEDIUM" });
            const subList = Array.isArray(subs) ? subs : subs.subdomains;
            if (subList?.length > 0) osintFindings.push({ finding: `${subList.length} subdomains found`, severity: "LOW" });
            if (whois.registrar) osintFindings.push({ finding: `Registrar: ${whois.registrar}`, severity: "LOW" });
            if (ipRecon.geolocation) osintFindings.push({ finding: `Location: ${typeof ipRecon.geolocation === "string" ? ipRecon.geolocation : JSON.stringify(ipRecon.geolocation).slice(0, 100)}`, severity: "LOW" });
            if (ipRecon.shodan) osintFindings.push({ finding: `Shodan: ${typeof ipRecon.shodan === "string" ? ipRecon.shodan : JSON.stringify(ipRecon.shodan).slice(0, 120)}`, severity: "MEDIUM" });

            const mapped = {
              target: data.target,
              timestamp: data.timestamp,
              riskScore: securityHeaders.filter((h: any) => h.status === "MISSING").length > 3 ? 65 : 35,
              executiveSummary: `Full recon on ${data.target}. ${dnsRecords.length} DNS records, ${openPorts.length} ports, ${osintFindings.length} OSINT findings.`,
              dnsRecords, openPorts, osintFindings, securityHeaders,
            };
            setVoiceResult(mapped);
            (window as any).__fridayLastResult = mapped;
          }
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [inline]);

  // Use voice result, window result, or empty report
  const report = voiceResult ?? (window as any).__fridayLastResult ?? emptyReport;

  // All stored scan results for browsing
  const [scanList, setScanList] = useState<{ id: number; target: string; timestamp: string; tool_count: number }[]>([]);

  useEffect(() => {
    if (!inline) return;
    const fetchList = () => {
      fetch(`${API_BASE}/api/scan-results`)
        .then((r) => r.json())
        .then((d) => setScanList(d.results || []))
        .catch(() => {});
    };
    fetchList();
    const id = setInterval(fetchList, 5000);
    return () => clearInterval(id);
  }, [inline]);

  const loadScanById = (id: number) => {
    fetch(`${API_BASE}/api/scan-results/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.result) {
          // Reuse the same mapping logic
          const r = data.result;
          const dns = r.run_dns_recon || {};
          const whois = r.run_whois_lookup || {};
          const ports = r.scan_ports || {};
          const headers = r.analyze_headers || {};
          const osint = r.run_osint_aggregator || {};
          const subs = r.run_subdomain_enum || {};
          const ipRecon = r.run_ip_recon || {};

          const dnsRecords: any[] = [];
          const dnsSource = dns.records || dns;
          Object.entries(dnsSource).forEach(([type, val]: [string, any]) => {
            if (type === "error" || type === "domain") return;
            if (Array.isArray(val)) val.forEach((v: any) => dnsRecords.push({ type, name: data.target, value: String(v), ttl: "" }));
            else if (val && String(val).trim()) dnsRecords.push({ type, name: data.target, value: String(val), ttl: "" });
          });

          let openPorts: any[] = [];
          if (Array.isArray(ports.open_ports)) openPorts = ports.open_ports.map((p: any) => ({ port: p.port ?? p, service: p.service ?? "unknown", state: "open", risk: "LOW" }));
          else if (ports.ports && typeof ports.ports === "string" && ports.ports.trim()) openPorts = ports.ports.split(",").filter(Boolean).map((p: string) => ({ port: p.trim(), service: "unknown", state: "open", risk: "LOW" }));

          const securityHeaders: any[] = [];
          if (Array.isArray(headers.missing_headers)) headers.missing_headers.forEach((h: string) => securityHeaders.push({ header: h, status: "MISSING", value: "" }));
          if (headers.headers) Object.entries(headers.headers).forEach(([k, v]: [string, any]) => securityHeaders.push({ header: k, status: "PRESENT", value: String(v).slice(0, 80) }));

          const osintFindings: any[] = [];
          if (osint.virustotal) osintFindings.push({ finding: `VirusTotal: ${typeof osint.virustotal === "string" ? osint.virustotal : JSON.stringify(osint.virustotal).slice(0, 150)}`, severity: "MEDIUM" });
          const subList = Array.isArray(subs) ? subs : subs.subdomains;
          if (subList?.length > 0) osintFindings.push({ finding: `${subList.length} subdomains found`, severity: "LOW" });
          if (whois.registrar) osintFindings.push({ finding: `Registrar: ${whois.registrar}`, severity: "LOW" });
          if (ipRecon.geolocation) osintFindings.push({ finding: `Location: ${typeof ipRecon.geolocation === "string" ? ipRecon.geolocation : JSON.stringify(ipRecon.geolocation).slice(0, 100)}`, severity: "LOW" });
          if (ipRecon.shodan) osintFindings.push({ finding: `Shodan: ${typeof ipRecon.shodan === "string" ? ipRecon.shodan : JSON.stringify(ipRecon.shodan).slice(0, 120)}`, severity: "MEDIUM" });

          const mapped = {
            target: data.target,
            timestamp: data.timestamp,
            riskScore: securityHeaders.filter((h: any) => h.status === "MISSING").length > 3 ? 65 : 35,
            executiveSummary: `Full recon on ${data.target}. ${dnsRecords.length} DNS records, ${openPorts.length} ports, ${osintFindings.length} OSINT findings.`,
            dnsRecords, openPorts, osintFindings, securityHeaders,
          };
          setVoiceResult(mapped);
          (window as any).__fridayLastResult = mapped;
          // Reset analysis so it regenerates for new target
          setAnalysis("");
          setAnalysisTarget("");
        }
      })
      .catch(() => {});
  };

  // LLM-generated detailed analysis
  const [analysis, setAnalysis] = useState<string>("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisTarget, setAnalysisTarget] = useState("");

  useEffect(() => {
    if (report.target === "NO_TARGET" || report.target === analysisTarget) return;
    if (report.dnsRecords.length === 0 && report.osintFindings.length === 0) return;

    setAnalysisLoading(true);
    setAnalysisTarget(report.target);
    fetch(`${API_BASE}/api/intel-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: report.target, scan_data: report }),
    })
      .then((r) => r.json())
      .then((data) => setAnalysis(data.analysis || ""))
      .catch(() => setAnalysis("Failed to generate analysis."))
      .finally(() => setAnalysisLoading(false));
  }, [report.target, report.dnsRecords.length]);
  
  const deleteScanById = (id: number) => {
    fetch(`${API_BASE}/api/scan-results/${id}`, { method: "DELETE" })
      .then(() => {
        setScanList((prev) => prev.filter((s) => s.id !== id));
        if (report.target !== "NO_TARGET") {
          setVoiceResult(null);
          (window as any).__fridayLastResult = null;
        }
      })
      .catch(() => {});
  };

  const handleCopyJson = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  }, [report]);

  const handleExportPdf = useCallback(() => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 20;

    // ── Theme colors ──────────────────────────────────────────────────────
    const colorPrimary: [number, number, number] = [0, 212, 255];   // #00d4ff
    const colorGreen:   [number, number, number] = [0, 255, 136];   // #00ff88
    const colorOrange:  [number, number, number] = [255, 170, 0];   // #ffaa00
    const colorRed:     [number, number, number] = [255, 46, 46];   // #ff2e2e
    const colorBg:      [number, number, number] = [5, 5, 10];      // #05050a
    const colorText:    [number, number, number] = [200, 220, 230]; // light
    const colorMuted:   [number, number, number] = [100, 130, 150];

    const severityColorMap: Record<string, [number, number, number]> = {
      LOW: colorGreen, MEDIUM: colorOrange, HIGH: [255, 102, 34], CRITICAL: colorRed,
    };

    // ── Background ─────────────────────────────────────────────────────────
    doc.setFillColor(...colorBg);
    doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), "F");

    // ── Header ─────────────────────────────────────────────────────────────
    doc.setFillColor(...colorPrimary);
    doc.rect(0, 0, pageW, 14, "F");
    doc.setTextColor(5, 5, 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("F.R.I.D.A.Y.  INTELLIGENCE REPORT", margin, 9);
    doc.text(new Date().toUTCString(), pageW - margin, 9, { align: "right" });
    y = 22;

    // ── Target + Risk score ────────────────────────────────────────────────
    doc.setTextColor(...colorPrimary);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(report.target.toUpperCase(), margin, y);
    y += 7;
    const riskColor = report.riskScore < 30 ? colorGreen : report.riskScore < 60 ? colorOrange : colorRed;
    doc.setTextColor(...riskColor);
    doc.setFontSize(10);
    doc.text(`RISK SCORE: ${report.riskScore}/100`, margin, y);
    y += 8;

    // ── Helper: section header ─────────────────────────────────────────────
    const sectionHeader = (title: string) => {
      if (y > 260) { doc.addPage(); doc.setFillColor(...colorBg); doc.rect(0,0,pageW,297,"F"); y = 15; }
      doc.setFillColor(0, 40, 55);
      doc.rect(margin, y, pageW - margin * 2, 6, "F");
      doc.setTextColor(...colorPrimary);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(`▶  ${title}`, margin + 2, y + 4);
      y += 9;
    };

    // ── Helper: row ───────────────────────────────────────────────────────
    const row = (cols: string[], widths: number[], colors?: ([number,number,number] | null)[]) => {
      if (y > 265) { doc.addPage(); doc.setFillColor(...colorBg); doc.rect(0,0,pageW,297,"F"); y = 15; }
      let x = margin;
      cols.forEach((col, i) => {
        const c = colors?.[i];
        doc.setTextColor(...(c ?? colorText));
        doc.text(String(col), x, y, { maxWidth: widths[i] - 2 });
        x += widths[i];
      });
      y += 5;
    };

    // ── Executive Summary ─────────────────────────────────────────────────
    sectionHeader("EXECUTIVE SUMMARY");
    doc.setTextColor(...colorMuted);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    const summaryLines = doc.splitTextToSize(report.executiveSummary, pageW - margin * 2);
    doc.text(summaryLines, margin, y);
    y += summaryLines.length * 4 + 5;

    // ── DNS Records ───────────────────────────────────────────────────────
    sectionHeader("DNS RECORDS");
    doc.setFontSize(6.5);
    row(["TYPE","NAME","VALUE","TTL"], [18,40,100,22], [colorGreen, null, null, null]);
    report.dnsRecords.forEach(r => row([r.type, r.name, r.value, r.ttl], [18,40,100,22], [colorGreen, null, null, colorMuted]));
    y += 3;

    // ── Open Ports ───────────────────────────────────────────────────────
    sectionHeader("OPEN PORTS");
    row(["PORT","SERVICE","STATE","RISK"], [20,40,40,40]);
    report.openPorts.forEach(p => row(
      [String(p.port), p.service, p.state, p.risk], [20,40,40,40],
      [colorPrimary, null, null, severityColorMap[p.risk] ?? colorText]
    ));
    y += 3;

    // ── OSINT Findings ────────────────────────────────────────────────────
    sectionHeader("OSINT FINDINGS");
    report.osintFindings.forEach(f => row(
      [f.finding, f.severity], [140, 30],
      [colorMuted, severityColorMap[f.severity] ?? colorText]
    ));
    y += 3;

    // ── Security Headers ─────────────────────────────────────────────────
    sectionHeader("SECURITY HEADERS");
    report.securityHeaders.forEach(h => row(
      [h.header, h.status, h.value], [80,25,70],
      [colorText, h.status === "PRESENT" ? colorGreen : colorRed, colorMuted]
    ));

    // ── Footer ────────────────────────────────────────────────────────────
    const pageCount = (doc.internal as any).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(...colorBg);
      doc.rect(0, 288, pageW, 10, "F");
      doc.setTextColor(...colorMuted);
      doc.setFontSize(6);
      doc.text("F.R.I.D.A.Y. — CLASSIFIED — FOR AUTHORIZED SECURITY RESEARCH ONLY", pageW / 2, 294, { align: "center" });
      doc.text(`PAGE ${i} / ${pageCount}`, pageW - margin, 294, { align: "right" });
    }

    doc.save(`FRIDAY_report_${report.target}_${Date.now()}.pdf`);
  }, [report]);

  // ── Inline mode: render directly in the tab ──
  if (inline) {
    return (
      <div className="border border-primary/30 bg-primary/5 chamfer glow-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/20 bg-primary/[0.03] shrink-0">
          <div className="flex items-center gap-3">
            <div className="status-active" />
            <span className="font-display text-[11px] tracking-[0.2em] text-primary uppercase">
              INTELLIGENCE_REPORT
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="border border-primary/30 px-3 py-1 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
            >
              COPY JSON
            </button>
            <button
              onClick={handleExportPdf}
              className="border border-primary/30 px-3 py-1 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
            >
              EXPORT PDF
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 p-5">
          {/* Past scans selector */}
          {scanList.length > 0 && (
            <div className="mb-4 border border-primary/15 bg-primary/[0.02] chamfer-sm p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="hud-label">SCAN_ARCHIVE ({scanList.length})</span>
                <button
                  onClick={() => scanList.forEach((s) => deleteScanById(s.id))}
                  className="text-[7px] tracking-widest text-red-400/30 hover:text-red-400 uppercase transition-none font-display"
                >
                  CLEAR ALL
                </button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-[80px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,212,255,0.2) transparent" }}>
                {scanList.map((s) => (
                  <div key={s.id} className="relative group">
                  <button
                    onClick={() => loadScanById(s.id)}
                    className={`border chamfer-sm px-3 py-1.5 text-left transition-none ${
                      report.target === s.target && report.timestamp === s.timestamp
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-primary/15 bg-primary/[0.03] text-foreground/40 hover:border-primary/30 hover:text-foreground/60"
                    }`}
                  >
                    <span className="font-display text-[9px] tracking-widest uppercase block">{s.target}</span>
                    <span className="text-[7px] text-foreground/25 font-mono">{new Date(s.timestamp).toLocaleString()}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteScanById(s.id); }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-background border border-red-400/30 text-red-400/40 hover:text-red-400 hover:bg-red-400/10 text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-none"
                    title="Delete scan"
                  >
                    x
                  </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Target info */}
          <div className="flex items-center justify-between mb-1">
            <span className="font-display text-sm tracking-[0.2em] text-primary glow-text">{report.target}</span>
            <span className="hud-label">{new Date(report.timestamp).toLocaleString()}</span>
          </div>

          <RiskGauge score={report.riskScore} />

          <SectionTitle>EXECUTIVE_SUMMARY</SectionTitle>
          <div className="border border-primary/20 bg-primary/[0.02] p-3 chamfer-sm text-xs text-foreground/70 leading-relaxed tracking-wider uppercase">
            {report.executiveSummary}
          </div>

          {/* LLM-Generated Intelligence Assessment */}
          {(analysis || analysisLoading) && (
            <>
              <SectionTitle>INTELLIGENCE_ASSESSMENT</SectionTitle>
              <div className="border border-primary/20 bg-primary/[0.02] p-4 chamfer-sm">
                {analysisLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 bg-primary animate-pulse" style={{ boxShadow: "0 0 6px rgba(0,212,255,0.8)" }} />
                    <span className="font-display text-[9px] tracking-[0.15em] text-primary/40 uppercase animate-pulse">
                      GENERATING INTELLIGENCE ASSESSMENT...
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-foreground/60 leading-relaxed font-body whitespace-pre-line">
                    {analysis}
                  </p>
                )}
              </div>
            </>
          )}

          <SectionTitle>DNS_RECORDS</SectionTitle>
          <div className="border border-primary/20 chamfer-sm overflow-hidden">
            <table className="w-full text-[10px] uppercase tracking-wider">
              <thead>
                <tr className="bg-primary/[0.05] border-b border-primary/15">
                  <th className="text-left px-3 py-2 text-primary/60 font-display">TYPE</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">NAME</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">VALUE</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">TTL</th>
                </tr>
              </thead>
              <tbody>
                {report.dnsRecords.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                    <td className="px-3 py-1.5 text-primary/80 font-display">{r.type}</td>
                    <td className="px-3 py-1.5 text-foreground/60">{r.name}</td>
                    <td className="px-3 py-1.5 text-foreground/50 font-mono text-[9px]">{r.value}</td>
                    <td className="px-3 py-1.5 text-foreground/40">{r.ttl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>OPEN_PORTS</SectionTitle>
          <div className="border border-primary/20 chamfer-sm overflow-hidden">
            <table className="w-full text-[10px] uppercase tracking-wider">
              <thead>
                <tr className="bg-primary/[0.05] border-b border-primary/15">
                  <th className="text-left px-3 py-2 text-primary/60 font-display">PORT</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">SERVICE</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">STATE</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">RISK</th>
                </tr>
              </thead>
              <tbody>
                {report.openPorts.map((p: any, i: number) => (
                  <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                    <td className="px-3 py-1.5 text-primary/80 font-display">{p.port}</td>
                    <td className="px-3 py-1.5 text-foreground/60">{p.service}</td>
                    <td className="px-3 py-1.5 text-foreground/50">{p.state}</td>
                    <td className="px-3 py-1.5"><SeverityBadge severity={p.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>OSINT_FINDINGS</SectionTitle>
          <div className="space-y-1.5">
            {report.osintFindings.map((f: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-3 border border-primary/15 bg-primary/[0.02] p-2.5 chamfer-sm">
                <span className="text-[10px] uppercase tracking-wider text-foreground/60 flex-1">{f.finding}</span>
                <SeverityBadge severity={f.severity} />
              </div>
            ))}
          </div>

          <SectionTitle>SECURITY_HEADERS</SectionTitle>
          <div className="border border-primary/20 chamfer-sm overflow-hidden">
            <table className="w-full text-[10px] uppercase tracking-wider">
              <thead>
                <tr className="bg-primary/[0.05] border-b border-primary/15">
                  <th className="text-left px-3 py-2 text-primary/60 font-display">HEADER</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">STATUS</th>
                  <th className="text-left px-3 py-2 text-primary/60 font-display">VALUE</th>
                </tr>
              </thead>
              <tbody>
                {report.securityHeaders.map((h: any, i: number) => (
                  <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                    <td className="px-3 py-1.5 text-foreground/60 font-display">{h.header}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className="font-display text-[9px] tracking-widest px-2 py-0.5 border"
                        style={{
                          color: h.status === "PRESENT" ? "#00ff88" : "#ff2e2e",
                          backgroundColor: h.status === "PRESENT" ? "rgba(0,255,136,0.1)" : "rgba(255,46,46,0.1)",
                          borderColor: h.status === "PRESENT" ? "rgba(0,255,136,0.4)" : "rgba(255,46,46,0.4)",
                        }}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-foreground/40 text-[9px]">{h.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="h-8" />
        </div>
      </div>
    );
  }

  // ── Overlay/slide-in mode (original) ──
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
            className="fixed right-0 top-0 h-full w-full max-w-[600px] z-[70] border-l border-primary/30 glow-border flex flex-col"
            style={{ background: "rgba(5, 5, 10, 0.97)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-primary/20 bg-primary/[0.03] shrink-0">
              <div className="flex items-center gap-3">
                <div className="status-active" />
                <span className="font-display text-[11px] tracking-[0.2em] text-primary uppercase">
                  INTELLIGENCE_REPORT
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="border border-primary/30 px-3 py-1 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
                >
                  COPY JSON
                </button>
                <button
                  onClick={handleExportPdf}
                  className="border border-primary/30 px-3 py-1 text-[9px] font-display uppercase tracking-widest text-primary/60 hover:bg-primary/10 hover:text-primary transition-none"
                >
                  EXPORT PDF
                </button>
                <button
                  onClick={onClose}
                  className="border border-primary/30 w-7 h-7 flex items-center justify-center text-primary/60 hover:bg-primary/10 hover:text-primary transition-none font-display text-xs"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* Target info */}
              <div className="flex items-center justify-between mb-1">
                <span className="font-display text-sm tracking-[0.2em] text-primary glow-text">{report.target}</span>
                <span className="hud-label">{new Date(report.timestamp).toLocaleString()}</span>
              </div>

              {/* Risk gauge */}
              <RiskGauge score={report.riskScore} />

              {/* Executive Summary */}
              <SectionTitle>EXECUTIVE_SUMMARY</SectionTitle>
              <div className="border border-primary/20 bg-primary/[0.02] p-3 chamfer-sm text-xs text-foreground/70 leading-relaxed tracking-wider uppercase">
                {report.executiveSummary}
              </div>

              {/* DNS Records */}
              <SectionTitle>DNS_RECORDS</SectionTitle>
              <div className="border border-primary/20 chamfer-sm overflow-hidden">
                <table className="w-full text-[10px] uppercase tracking-wider">
                  <thead>
                    <tr className="bg-primary/[0.05] border-b border-primary/15">
                      <th className="text-left px-3 py-2 text-primary/60 font-display">TYPE</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">NAME</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">VALUE</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">TTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dnsRecords.map((r, i) => (
                      <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                        <td className="px-3 py-1.5 text-primary/80 font-display">{r.type}</td>
                        <td className="px-3 py-1.5 text-foreground/60">{r.name}</td>
                        <td className="px-3 py-1.5 text-foreground/50 font-mono text-[9px]">{r.value}</td>
                        <td className="px-3 py-1.5 text-foreground/40">{r.ttl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Open Ports */}
              <SectionTitle>OPEN_PORTS</SectionTitle>
              <div className="border border-primary/20 chamfer-sm overflow-hidden">
                <table className="w-full text-[10px] uppercase tracking-wider">
                  <thead>
                    <tr className="bg-primary/[0.05] border-b border-primary/15">
                      <th className="text-left px-3 py-2 text-primary/60 font-display">PORT</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">SERVICE</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">STATE</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">RISK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.openPorts.map((p, i) => (
                      <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                        <td className="px-3 py-1.5 text-primary/80 font-display">{p.port}</td>
                        <td className="px-3 py-1.5 text-foreground/60">{p.service}</td>
                        <td className="px-3 py-1.5 text-foreground/50">{p.state}</td>
                        <td className="px-3 py-1.5"><SeverityBadge severity={p.risk} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* OSINT Findings */}
              <SectionTitle>OSINT_FINDINGS</SectionTitle>
              <div className="space-y-1.5">
                {report.osintFindings.map((f, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 border border-primary/15 bg-primary/[0.02] p-2.5 chamfer-sm">
                    <span className="text-[10px] uppercase tracking-wider text-foreground/60 flex-1">{f.finding}</span>
                    <SeverityBadge severity={f.severity} />
                  </div>
                ))}
              </div>

              {/* Security Headers */}
              <SectionTitle>SECURITY_HEADERS</SectionTitle>
              <div className="border border-primary/20 chamfer-sm overflow-hidden">
                <table className="w-full text-[10px] uppercase tracking-wider">
                  <thead>
                    <tr className="bg-primary/[0.05] border-b border-primary/15">
                      <th className="text-left px-3 py-2 text-primary/60 font-display">HEADER</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">STATUS</th>
                      <th className="text-left px-3 py-2 text-primary/60 font-display">VALUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.securityHeaders.map((h, i) => (
                      <tr key={i} className="border-b border-primary/10 hover:bg-primary/[0.03]">
                        <td className="px-3 py-1.5 text-foreground/60 font-display">{h.header}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className="font-display text-[9px] tracking-widest px-2 py-0.5 border"
                            style={{
                              color: h.status === "PRESENT" ? "#00ff88" : "#ff2e2e",
                              backgroundColor: h.status === "PRESENT" ? "rgba(0,255,136,0.1)" : "rgba(255,46,46,0.1)",
                              borderColor: h.status === "PRESENT" ? "rgba(0,255,136,0.4)" : "rgba(255,46,46,0.4)",
                            }}
                          >
                            {h.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-foreground/40 text-[9px]">{h.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom spacer */}
              <div className="h-8" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default IntelReportPanel;
