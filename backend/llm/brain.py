from groq import Groq
from dotenv import load_dotenv
from .prompts import SYSTEM_PROMPT
import json
import asyncio

from tools.dns_recon import run_dns_recon
from tools.whois_tool import run_whois_lookup
from tools.ip_recon import run_ip_recon
from tools.port_scanner import scan_ports
from tools.subdomain_enum import run_subdomain_enum
from tools.header_analyzer import analyze_headers
from tools.osint_aggregator import run_osint_aggregator

load_dotenv()

from typing import Optional
from config.token_tracker import token_tracker
from mcp.client import mcp_manager

class FridayBrain:
    def __init__(self):
        self.client = Groq()
        self.model = "llama-3.3-70b-versatile"
        self.temperature = 0.7
        self._load_from_settings()

    def _load_from_settings(self):
        """Load LLM config from settings.json if available."""
        try:
            from config.settings_manager import settings_manager
            from config.llm_factory import create_llm_client
            rest_cfg = settings_manager.get_llm_slot("rest")
            if rest_cfg and rest_cfg.get("provider"):
                self.model = rest_cfg.get("model", self.model)
                self.temperature = rest_cfg.get("temperature", 0.7)
                api_key = rest_cfg.get("api_key") or settings_manager.get_api_key(
                    f"{rest_cfg['provider'].upper()}_API_KEY"
                )
                self.client = create_llm_client(
                    provider=rest_cfg["provider"],
                    api_key=api_key,
                    base_url=rest_cfg.get("base_url", ""),
                )
        except Exception:
            pass  # Fall back to default Groq

    def reconfigure(self, provider: str, model: str, api_key: str = "",
                    base_url: str = "", temperature: float = 0.7):
        """Hot-swap the LLM client at runtime."""
        from config.llm_factory import create_llm_client
        self.client = create_llm_client(provider, api_key, base_url)
        self.model = model
        self.temperature = temperature

    def process_query(self, user_query: str, target: Optional[str] = None, stream_callback=None, on_scan_callback=None):
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]
        
        if target:
            messages.append({"role": "user", "content": f"Target: {target}\nCommand: {user_query}"})
        else:
            messages.append({"role": "user", "content": user_query})

        if stream_callback:
            stream_callback(f"[SYS] INITIALIZING NEURAL LINK...", "info")

        # Define tools for LLM tool calling feature
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "run_dns_recon",
                    "description": "Run full DNS reconnaissance on a target domain including A, MX, NS, TXT, and CNAME records.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "The target domain name (e.g., example.com)"}
                        },
                        "required": ["domain"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_whois_lookup",
                    "description": "Perform a WHOIS lookup and extract key registration details.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "The target domain name"}
                        },
                        "required": ["domain"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_ip_recon",
                    "description": "Run full IP intelligence gathering including geolocation and Shodan data.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ip": {"type": "string", "description": "The target IP address"}
                        },
                        "required": ["ip"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "scan_ports",
                    "description": "Scan open ports on a target IP address.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "target_ip": {"type": "string", "description": "The target IP address"},
                            "port_range": {"type": "string", "description": "The port range to scan, default '1-1000'"},
                            "scan_type": {"type": "string", "description": "Scan type, 'basic' or 'service'", "enum": ["basic", "service"]}
                        },
                        "required": ["target_ip"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_subdomain_enum",
                    "description": "Enumerate subdomains using brute force and SecurityTrails API.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "The target domain name"}
                        },
                        "required": ["domain"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "analyze_headers",
                    "description": "Analyze HTTP responses for missing security headers or server leakage.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "The target URL including protocol (e.g., https://example.com)"}
                        },
                        "required": ["url"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_osint_aggregator",
                    "description": "Aggregate OSINT from VirusTotal for a domain or IP.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "target": {"type": "string", "description": "The target domain or IP"},
                            "is_ip": {"type": "boolean", "description": "True if target is an IP, False if domain"}
                        },
                        "required": ["target"]
                    }
                }
            }
        ]
        
        # Mapping names to python functions
        available_functions = {
            "run_dns_recon": run_dns_recon,
            "run_whois_lookup": run_whois_lookup,
            "run_ip_recon": run_ip_recon,
            "scan_ports": scan_ports,
            "run_subdomain_enum": run_subdomain_enum,
            "analyze_headers": analyze_headers,
            "run_osint_aggregator": run_osint_aggregator
        }

        # ── Inject MCP tools ──────────────────────────────────────────
        mcp_name_map = {}  # prefixed_name → (server, tool_name)
        try:
            mcp_tools = mcp_manager.get_all_tools()
            for mt in mcp_tools:
                prefixed = f"mcp__{mt['server']}__{mt['name']}"
                mcp_name_map[prefixed] = (mt["server"], mt["name"])
                tools.append({
                    "type": "function",
                    "function": {
                        "name": prefixed,
                        "description": mt.get("description", ""),
                        "parameters": mt.get("input_schema", {"type": "object", "properties": {}}),
                    }
                })
        except Exception:
            pass  # MCP unavailable — continue with built-in tools only

        try:
            # First LLM call
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                max_tokens=4096
            )
            token_tracker.record_from_response("rest", response)

            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls
            
            if tool_calls:
                messages.append(response_message)
                
                # Execute tools matching the tool calls
                for tool_call in tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)

                    if stream_callback:
                        stream_callback(f"[SYS] EXECUTING MODULE: {function_name.upper()}...", "info")

                    # ── Built-in recon tools ──
                    if function_name in available_functions:
                        function_to_call = available_functions[function_name]
                        if function_name == "run_osint_aggregator":
                            function_response = function_to_call(
                                target=function_args.get("target"),
                                is_ip=function_args.get("is_ip", False)
                            )
                        elif function_name == "scan_ports":
                            function_response = function_to_call(
                                target_ip=function_args.get("target_ip"),
                                port_range=function_args.get("port_range", "1-1000"),
                                scan_type=function_args.get("scan_type", "basic")
                            )
                        elif function_name in ["run_dns_recon", "run_whois_lookup", "run_subdomain_enum"]:
                            function_response = function_to_call(domain=function_args.get("domain"))
                        elif function_name == "run_ip_recon":
                            function_response = function_to_call(ip=function_args.get("ip"))
                        elif function_name == "analyze_headers":
                            function_response = function_to_call(url=function_args.get("url"))
                        else:
                            function_response = function_to_call(**function_args)

                    # ── MCP tools (external servers) ──
                    elif function_name in mcp_name_map:
                        server_name, tool_name = mcp_name_map[function_name]
                        if stream_callback:
                            stream_callback(f"[SYS] CALLING MCP TOOL: {tool_name} @ {server_name}", "info")
                        try:
                            function_response = asyncio.run(
                                mcp_manager.call_tool(server_name, tool_name, function_args)
                            )
                        except Exception as e:
                            function_response = {"error": f"MCP tool error: {str(e)[:200]}"}
                    else:
                        function_response = {"error": f"Unknown function: {function_name}"}

                    # Report scan to listener
                    if on_scan_callback and isinstance(function_response, dict) and "error" not in function_response:
                        scan_target = function_args.get("domain") or function_args.get("ip") or function_args.get("target_ip") or function_args.get("url") or function_args.get("target")
                        on_scan_callback(scan_target, function_name, function_response)

                    if stream_callback:
                        stream_callback(f"[SYS] MODULE {function_name.upper()} COMPLETED.", "success")

                    messages.append(
                        {
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": json.dumps(function_response),
                        }
                    )
                
                if stream_callback:
                    stream_callback(f"[SYS] ASSIMILATING INTELLIGENCE...", "info")
                
                # Second LLM call with tool results
                second_response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    max_tokens=4096
                )
                token_tracker.record_from_response("rest", second_response)
                return second_response.choices[0].message.content
                
            return response_message.content
        except Exception as e:
            return {"error": str(e)}
