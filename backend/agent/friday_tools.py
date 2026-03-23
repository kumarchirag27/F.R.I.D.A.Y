"""
F.R.I.D.A.Y. recon tools wrapped as LiveKit @function_tool for the voice agent.

Each tool directly imports the existing Python function from backend/tools/
and wraps it with the LiveKit function_tool decorator.
"""

import os
import sys
import json
import asyncio
import logging

# Ensure backend root is on the path so we can import tools
_backend_dir = os.path.join(os.path.dirname(__file__), "..")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from livekit.agents import function_tool

from tools.dns_recon import run_dns_recon
from tools.whois_tool import run_whois_lookup
from tools.ip_recon import run_ip_recon
from tools.port_scanner import scan_ports
from tools.subdomain_enum import run_subdomain_enum
from tools.header_analyzer import analyze_headers
from tools.osint_aggregator import run_osint_aggregator
from tools.cyber_news import get_cyber_news

logger = logging.getLogger("friday.tools")


def _run_sync(func, *args, **kwargs) -> str:
    """Run a synchronous tool in a thread and return JSON result."""
    result = func(*args, **kwargs)
    return json.dumps(result, indent=2, default=str)


@function_tool(name="run_dns_recon", description="Run full DNS reconnaissance on a target domain. Returns A, MX, NS, TXT, and CNAME records.")
async def friday_dns_recon(domain: str) -> str:
    """Run DNS recon on the given domain."""
    logger.info(f"[TOOL] DNS Recon -> {domain}")
    return await asyncio.to_thread(_run_sync, run_dns_recon, domain)


@function_tool(name="run_whois_lookup", description="Perform a WHOIS lookup to get domain registration details including registrar, dates, nameservers, and organization.")
async def friday_whois_lookup(domain: str) -> str:
    """Run WHOIS lookup on the given domain."""
    logger.info(f"[TOOL] WHOIS Lookup -> {domain}")
    return await asyncio.to_thread(_run_sync, run_whois_lookup, domain)


@function_tool(name="run_ip_recon", description="Run IP intelligence gathering including geolocation (country, city, ISP, ASN) and Shodan data (open ports, OS, vulnerabilities).")
async def friday_ip_recon(ip: str) -> str:
    """Run IP recon on the given IP address."""
    logger.info(f"[TOOL] IP Recon -> {ip}")
    return await asyncio.to_thread(_run_sync, run_ip_recon, ip)


@function_tool(name="scan_ports", description="Scan open ports on a target IP. Specify port_range like '1-1000' and scan_type as 'basic' or 'service'.")
async def friday_port_scan(target_ip: str, port_range: str = "1-1000", scan_type: str = "basic") -> str:
    """Scan ports on the target IP."""
    logger.info(f"[TOOL] Port Scan -> {target_ip} ({port_range}, {scan_type})")
    return await asyncio.to_thread(_run_sync, scan_ports, target_ip, port_range, scan_type)


@function_tool(name="run_subdomain_enum", description="Enumerate subdomains using brute force wordlist and SecurityTrails API. Returns discovered subdomains with their status.")
async def friday_subdomain_enum(domain: str) -> str:
    """Enumerate subdomains for the given domain."""
    logger.info(f"[TOOL] Subdomain Enum -> {domain}")
    return await asyncio.to_thread(_run_sync, run_subdomain_enum, domain)


@function_tool(name="analyze_headers", description="Analyze HTTP security headers of a URL. Checks for missing headers like HSTS, CSP, X-Frame-Options, and detects server/technology leakage.")
async def friday_header_analysis(url: str) -> str:
    """Analyze HTTP headers for the given URL."""
    logger.info(f"[TOOL] Header Analysis -> {url}")
    return await asyncio.to_thread(_run_sync, analyze_headers, url)


@function_tool(name="run_osint_aggregator", description="Aggregate OSINT data from VirusTotal and Have I Been Pwned for a domain or IP address. Set is_ip=true for IP targets.")
async def friday_osint_aggregator(target: str, is_ip: bool = False) -> str:
    """Run OSINT aggregation on the target."""
    logger.info(f"[TOOL] OSINT Aggregator -> {target} (is_ip={is_ip})")
    return await asyncio.to_thread(_run_sync, run_osint_aggregator, target, is_ip)


@function_tool(name="run_full_recon", description="Run a COMPLETE reconnaissance scan on a domain using ALL available tools: DNS recon, WHOIS lookup, subdomain enumeration (SecurityTrails), header analysis, OSINT (VirusTotal), IP recon (Shodan), and port scanning. Use this when the user says 'run recon', 'full scan', 'scan this target', or any general recon request. This is the preferred tool for comprehensive scanning.")
async def friday_full_recon(domain: str) -> str:
    """Run ALL recon tools on the target domain and return combined results."""
    import socket
    import httpx

    logger.info(f"[TOOL] FULL RECON -> {domain}")
    results = {}
    total_tools = 7
    completed_count = 0

    async def _safe_run(name, label, fn):
        nonlocal completed_count
        try:
            data = await asyncio.to_thread(lambda: fn())
            completed_count += 1
            pct = int((completed_count / total_tools) * 100)
            logger.info(f"[RECON] {label} done ({pct}%)")
            # Push progress to frontend via WebSocket
            try:
                async with httpx.AsyncClient(timeout=2.0) as c:
                    await c.post("http://localhost:8000/api/ws-broadcast", json={
                        "message": f"[RECON] {label} complete — {pct}% done",
                        "type": "info"
                    })
            except Exception:
                pass
            return name, data
        except Exception as e:
            completed_count += 1
            return name, {"error": str(e)[:200]}

    domain_tasks = [
        _safe_run("run_dns_recon", "DNS RECON", lambda: run_dns_recon(domain)),
        _safe_run("run_whois_lookup", "WHOIS LOOKUP", lambda: run_whois_lookup(domain)),
        _safe_run("run_subdomain_enum", "SUBDOMAIN ENUM", lambda: run_subdomain_enum(domain)),
        _safe_run("analyze_headers", "HEADER ANALYSIS", lambda: analyze_headers(f"https://{domain}")),
        _safe_run("run_osint_aggregator", "OSINT / VIRUSTOTAL", lambda: run_osint_aggregator(domain, is_ip=False)),
    ]

    # Resolve IP for Shodan + port scan
    try:
        ip = socket.gethostbyname(domain)
        domain_tasks.append(_safe_run("run_ip_recon", "IP RECON / SHODAN", lambda: run_ip_recon(ip)))
        domain_tasks.append(_safe_run("scan_ports", "PORT SCAN", lambda: scan_ports(ip, "1-100", "basic")))
        results["resolved_ip"] = ip
    except Exception:
        results["resolved_ip"] = None
        total_tools = 5  # No IP-based tools

    # Run all concurrently
    completed = await asyncio.gather(*domain_tasks)
    for name, data in completed:
        results[name] = data

    # POST results to backend so the frontend INTEL tab can show them
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            await c.post("http://localhost:8000/api/scan-result", json={
                "target": domain,
                "result": results,
            })
        logger.info("[RECON] Results posted to backend for INTEL tab")
    except Exception as e:
        logger.warning(f"[RECON] Failed to post results to backend: {e}")

    # Build summary for LLM
    summary_parts = [f"Full recon on {domain} complete."]
    dns = results.get("run_dns_recon", {})
    if isinstance(dns, dict) and dns.get("records"):
        record_count = sum(len(v) for v in dns["records"].values() if isinstance(v, list))
        summary_parts.append(f"{record_count} DNS records found.")
    subs = results.get("run_subdomain_enum", {})
    if isinstance(subs, dict) and subs.get("subdomains"):
        summary_parts.append(f"{len(subs['subdomains'])} subdomains discovered.")
    hdrs = results.get("analyze_headers", {})
    if isinstance(hdrs, dict) and hdrs.get("missing_headers"):
        summary_parts.append(f"{len(hdrs['missing_headers'])} security headers missing.")
    if results.get("resolved_ip"):
        summary_parts.append(f"Resolved IP: {results['resolved_ip']}.")

    return json.dumps({"summary": " ".join(summary_parts), "details": results}, indent=2, default=str)


@function_tool(name="get_cyber_news", description="Get the latest cybersecurity news headlines from The Hacker News, BleepingComputer, CISA, and Krebs on Security. Use when the user asks for news, latest threats, cyber updates, or security headlines.")
async def friday_cyber_news(count: int = 5) -> str:
    """Fetch latest cybersecurity news."""
    logger.info(f"[TOOL] Cyber News -> fetching {count} articles")
    return await asyncio.to_thread(_run_sync, get_cyber_news, count)


# Export all tools as a list for easy registration
ALL_TOOLS = [
    friday_full_recon,
    friday_cyber_news,
    friday_dns_recon,
    friday_whois_lookup,
    friday_ip_recon,
    friday_port_scan,
    friday_subdomain_enum,
    friday_header_analysis,
    friday_osint_aggregator,
]
