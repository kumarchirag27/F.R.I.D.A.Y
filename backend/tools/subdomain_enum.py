import os
import requests
import dns.resolver

TOP_SUBDOMAINS = [
    # Core / common
    "www", "mail", "ftp", "webmail", "smtp", "pop", "imap", "pop3", "ns", "ns1", "ns2", "ns3", "ns4",
    "m", "mobile", "www2", "www3", "blog", "forum", "news", "shop", "store", "app", "web",
    # Admin / management
    "admin", "cpanel", "whm", "webdisk", "portal", "panel", "manage", "dashboard", "console",
    "login", "sso", "auth", "accounts", "signup",
    # Email / messaging
    "mail2", "mail3", "mx", "mx1", "mx2", "relay", "autodiscover", "autoconfig", "owa", "exchange",
    "imap2", "smtp2", "postfix", "lists", "newsletter",
    # Development / staging
    "dev", "dev2", "test", "test2", "staging", "stage", "uat", "qa", "sandbox", "preview",
    "beta", "alpha", "demo", "new", "old", "legacy", "next",
    # API / services
    "api", "api2", "api3", "rest", "graphql", "ws", "wss", "rpc", "gateway", "proxy",
    "cdn", "static", "assets", "media", "images", "img", "files", "upload", "download",
    # Infrastructure
    "server", "server1", "server2", "host", "node", "node1", "node2", "backup", "bak",
    "db", "db1", "db2", "mysql", "postgres", "mongo", "redis", "elasticsearch", "sql",
    "oracle", "mssql", "cache", "queue", "kafka", "rabbit",
    # Security / VPN
    "vpn", "vpn2", "secure", "ssl", "firewall", "waf", "ids", "siem", "soc",
    # Cloud / services
    "cloud", "aws", "azure", "gcp", "k8s", "docker", "ci", "cd", "jenkins", "gitlab",
    "git", "svn", "repo", "registry", "artifactory",
    # Business
    "crm", "erp", "billing", "pay", "payment", "invoice", "hr", "helpdesk", "support",
    "ticket", "service", "services", "office", "intranet", "internal", "corp", "extranet",
    # Analytics / monitoring
    "stats", "analytics", "monitor", "monitoring", "grafana", "kibana", "prometheus",
    "status", "health", "nagios", "zabbix", "log", "logs", "syslog",
    # Misc
    "wiki", "docs", "documentation", "help", "faq", "kb", "knowledge",
    "calendar", "meet", "chat", "slack", "teams", "video", "conference",
    "public", "private", "remote", "workspace", "tools", "labs", "research",
]

def brute_force_subdomains(domain: str):
    found = []
    for sub in TOP_SUBDOMAINS:
        target = f"{sub}.{domain}"
        try:
            dns.resolver.resolve(target, 'A')
            found.append({"subdomain": target, "status": "alive", "source": "brute_force"})
        except Exception:
            continue
    return found

def security_trails_subdomains(domain: str):
    api_key = os.getenv("SECURITYTRAILS_API_KEY")
    if not api_key or api_key == "your_securitytrails_api_key_here":
        return []
    try:
        url = f"https://api.securitytrails.com/v1/domain/{domain}/subdomains"
        headers = {"APIKEY": api_key, "accept": "application/json"}
        r = requests.get(url, headers=headers)
        if r.status_code == 200:
            data = r.json()
            return [{"subdomain": f"{sub}.{domain}", "status": "unknown", "source": "security_trails"} for sub in data.get("subdomains", [])]
        return []
    except Exception:
        return []

def run_subdomain_enum(domain: str):
    """Enumerate subdomains using brute force and SecurityTrails API."""
    results = brute_force_subdomains(domain)
    st_results = security_trails_subdomains(domain)
    
    # Deduplicate by subdomain
    seen = {r["subdomain"]: r for r in results}
    for st in st_results:
        if st["subdomain"] not in seen:
            seen[st["subdomain"]] = st
            
    return list(seen.values())
