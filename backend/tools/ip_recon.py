import os
import requests

def get_ip_geolocation(ip: str):
    try:
        url = f"https://ipapi.co/{ip}/json/"
        r = requests.get(url, headers={"User-Agent": "FRIDAY-Agent"})
        if r.status_code == 200:
            data = r.json()
            return {
                "country": data.get("country_name"),
                "city": data.get("city"),
                "isp": data.get("org"),
                "asn": data.get("asn")
            }
        return {"error": "Failed to fetch geolocation"}
    except Exception as e:
        return {"error": str(e)}

def get_shodan_intel(ip: str):
    api_key = os.getenv("SHODAN_API_KEY")
    if not api_key or api_key == "your_shodan_api_key_here":
        return {"error": "SHODAN_API_KEY not configured or missing"}
    try:
        url = f"https://api.shodan.io/shodan/host/{ip}?key={api_key}"
        r = requests.get(url)
        if r.status_code == 200:
            data = r.json()
            return {
                "os": data.get("os"),
                "ports": data.get("ports", []),
                "hostnames": data.get("hostnames", []),
                "vulns": data.get("vulns", [])
            }
        return {"error": f"Failed to fetch Shodan intel: {r.status_code}"}
    except Exception as e:
        return {"error": str(e)}

def run_ip_recon(ip: str):
    """Run full IP intelligence gathering."""
    return {
        "geolocation": get_ip_geolocation(ip),
        "shodan": get_shodan_intel(ip)
    }
