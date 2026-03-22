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


# Export all tools as a list for easy registration
ALL_TOOLS = [
    friday_dns_recon,
    friday_whois_lookup,
    friday_ip_recon,
    friday_port_scan,
    friday_subdomain_enum,
    friday_header_analysis,
    friday_osint_aggregator,
]
