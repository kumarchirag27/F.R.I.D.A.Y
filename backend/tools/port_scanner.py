import socket

try:
    import nmap
    NMAP_AVAILABLE = True
except ImportError:
    NMAP_AVAILABLE = False

def _socket_scan(target_ip: str, port_range: str = '1-1000') -> dict:
    """Fallback socket-based port scan when nmap is not available."""
    try:
        start_port, end_port = map(int, port_range.split('-'))
    except ValueError:
        start_port, end_port = 1, 1000

    COMMON_SERVICES = {
        21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns',
        80: 'http', 110: 'pop3', 143: 'imap', 443: 'https',
        445: 'smb', 3306: 'mysql', 3389: 'rdp', 5432: 'postgresql',
        6379: 'redis', 8080: 'http-alt', 8443: 'https-alt',
    }
    results = []
    for port in range(start_port, min(end_port + 1, start_port + 200)):  # cap at 200 for speed
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex((target_ip, port))
            sock.close()
            if result == 0:
                results.append({
                    "port": port,
                    "protocol": "tcp",
                    "state": "open",
                    "service": COMMON_SERVICES.get(port, "unknown"),
                    "version": ""
                })
        except Exception:
            pass
    return {"target": target_ip, "scan_type": "socket_fallback", "ports": results}

def scan_ports(target_ip: str, port_range: str = '1-1000', scan_type: str = 'basic'):
    """
    WARNING: THIS TOOL MUST ONLY BE RUN AGAINST AUTHORIZED TARGETS.
    """
    if not NMAP_AVAILABLE:
        return _socket_scan(target_ip, port_range)
    try:
        nm = nmap.PortScanner()
        args = '-sV' if scan_type == 'service' else '-sS'
        
        nm.scan(hosts=target_ip, ports=port_range, arguments=args)
        
        results = []
        if target_ip in nm.all_hosts():
            for proto in nm[target_ip].all_protocols():
                lport = nm[target_ip][proto].keys()
                for port in sorted(lport):
                    state = nm[target_ip][proto][port]['state']
                    service = nm[target_ip][proto][port].get('name', '')
                    version = nm[target_ip][proto][port].get('version', '')
                    results.append({
                        "port": port,
                        "protocol": proto,
                        "state": state,
                        "service": service,
                        "version": version
                    })
        return {
            "target": target_ip,
            "scan_type": scan_type,
            "ports": results
        }
    except nmap.PortScannerError as e:
        # Fallback to socket scan if nmap binary is missing
        return _socket_scan(target_ip, port_range)
    except Exception as e:
        return {"error": str(e)}
