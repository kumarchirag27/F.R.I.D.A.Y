import socket
from datetime import datetime

def _raw_whois(domain: str) -> dict:
    """Fallback: raw socket WHOIS query via port 43."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(10)
        s.connect(("whois.iana.org", 43))
        s.send((domain + "\r\n").encode())
        response = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            response += chunk
        s.close()
        text = response.decode("utf-8", errors="ignore")
        return {"raw_whois": text[:2000], "source": "socket_fallback"}
    except Exception as e:
        return {"error": f"Raw WHOIS failed: {str(e)}"}

def run_whois_lookup(domain: str):
    """Perform a WHOIS lookup. Falls back to raw socket if python-whois fails."""
    try:
        import whois as whois_lib
        w = whois_lib.whois(domain)

        def format_date(d):
            if d is None:
                return None
            if isinstance(d, list):
                d = d[0] if d else None
            if d is None:
                return None
            if isinstance(d, datetime):
                return d.isoformat()
            return str(d)

        return {
            "registrar": getattr(w, 'registrar', None),
            "creation_date": format_date(getattr(w, 'creation_date', None)),
            "expiration_date": format_date(getattr(w, 'expiration_date', None)),
            "registrant_org": getattr(w, 'org', None),
            "name_servers": getattr(w, 'name_servers', []),
            "country": getattr(w, 'country', None)
        }
    except Exception:
        return _raw_whois(domain)
