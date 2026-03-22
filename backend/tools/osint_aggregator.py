import os
import requests

def check_virustotal(target: str, is_ip: bool = False):
    api_key = os.getenv("VIRUSTOTAL_API_KEY")
    if not api_key or api_key == "your_virustotal_api_key_here":
        return {"error": "VIRUSTOTAL_API_KEY not configured"}
    
    endpoint = f"ip_addresses/{target}" if is_ip else f"domains/{target}"
    url = f"https://www.virustotal.com/api/v3/{endpoint}"
    headers = {"x-apikey": api_key}
    
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json().get("data", {}).get("attributes", {})
            return {
                "reputation": data.get("reputation"),
                "malicious_votes": data.get("last_analysis_stats", {}).get("malicious", 0),
                "suspicious_votes": data.get("last_analysis_stats", {}).get("suspicious", 0)
            }
        return {"error": f"VirusTotal API error: {r.status_code}"}
    except Exception as e:
        return {"error": str(e)}

def check_hibp(domain: str):
    """Check Have I Been Pwned for breaches related to a domain."""
    api_key = os.getenv("HIBP_API_KEY", "")
    if not api_key:
        return {"error": "HIBP_API_KEY not configured"}
    headers = {
        "hibp-api-key": api_key,
        "user-agent": "FRIDAY-Recon-Tool"
    }
    try:
        url = f"https://haveibeenpwned.com/api/v3/breacheddomain/{domain}"
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            breaches = r.json()
            return {"breaches": breaches, "count": len(breaches)}
        elif r.status_code == 404:
            return {"breaches": [], "count": 0, "status": "No breaches found"}
        elif r.status_code == 401:
            return {"error": "HIBP_API_KEY invalid or missing"}
        return {"error": f"HIBP API error: {r.status_code}"}
    except Exception as e:
        return {"error": str(e)}

def run_osint_aggregator(target: str, is_ip: bool = False):
    """Aggregate OSINT from VirusTotal and Have I Been Pwned."""
    result = {
        "virustotal": check_virustotal(target, is_ip)
    }
    if not is_ip:
        result["hibp"] = check_hibp(target)
    return result
