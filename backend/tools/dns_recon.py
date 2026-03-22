import dns.resolver

def get_a_records(domain: str):
    try:
        answers = dns.resolver.resolve(domain, 'A')
        return [str(rdata) for rdata in answers]
    except Exception:
        return []

def get_mx_records(domain: str):
    try:
        answers = dns.resolver.resolve(domain, 'MX')
        return [{"preference": rdata.preference, "exchange": str(rdata.exchange)} for rdata in answers]
    except Exception:
        return []

def get_ns_records(domain: str):
    try:
        answers = dns.resolver.resolve(domain, 'NS')
        return [str(rdata) for rdata in answers]
    except Exception:
        return []

def get_txt_records(domain: str):
    try:
        answers = dns.resolver.resolve(domain, 'TXT')
        return [str(rdata) for rdata in answers]
    except Exception:
        return []

def get_cname_records(domain: str):
    try:
        answers = dns.resolver.resolve(domain, 'CNAME')
        return [str(rdata) for rdata in answers]
    except Exception:
        return []

def run_dns_recon(domain: str):
    """Run full DNS reconnaissance on a target domain."""
    return {
        "A": get_a_records(domain),
        "MX": get_mx_records(domain),
        "NS": get_ns_records(domain),
        "TXT": get_txt_records(domain),
        "CNAME": get_cname_records(domain)
    }
