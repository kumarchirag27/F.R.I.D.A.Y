import requests

def analyze_headers(url: str):
    """Analyze HTTP responses for missing security headers or server leakage."""
    if not url.startswith("http"):
        url = "https://" + url

    try:
        # Avoid following redirects strictly so we assess the target URL headers
        response = requests.get(url, timeout=10, allow_redirects=False)
        headers = response.headers
        
        findings = []
        
        # Typical security headers we want to see
        security_headers = {
            "Strict-Transport-Security": {"severity": "HIGH", "desc": "Missing HSTS (Strict-Transport-Security)"},
            "Content-Security-Policy": {"severity": "HIGH", "desc": "Missing CSP (Content-Security-Policy)"},
            "X-Frame-Options": {"severity": "MEDIUM", "desc": "Missing Clickjacking Protection (X-Frame-Options)"},
            "X-Content-Type-Options": {"severity": "LOW", "desc": "Missing MIME Sniffing Protection (X-Content-Type-Options)"}
        }

        for header, info in security_headers.items():
            if header not in headers:
                findings.append({
                    "header": header, 
                    "status": "Missing", 
                    "severity": info["severity"], 
                    "description": info["desc"]
                })
            else:
                findings.append({
                    "header": header, 
                    "status": "Present", 
                    "value": headers[header]
                })
        
        # Identify server/technology leakage which might help target profiling
        if "Server" in headers:
            findings.append({"header": "Server", "status": "Leakage", "severity": "INFO", "value": headers["Server"]})
        if "X-Powered-By" in headers:
            findings.append({"header": "X-Powered-By", "status": "Leakage", "severity": "INFO", "value": headers["X-Powered-By"]})

        return {
            "url": url,
            "status_code": response.status_code,
            "findings": findings
        }
    except Exception as e:
        return {"error": str(e)}
