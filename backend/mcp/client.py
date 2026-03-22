"""
F.R.I.D.A.Y. MCP Client Manager
Manages connections to MCP (Model Context Protocol) servers.
Supports SSE and stdio transports, tool discovery, and tool execution.
Inspired by Open WebUI's connection management patterns.
"""

import asyncio
import json
import logging
import os
import subprocess
import time
import httpx
from typing import Any, Optional

logger = logging.getLogger("friday.mcp")


class MCPConnection:
    """A single MCP server connection with enable/disable and auto-reconnect."""

    def __init__(
        self,
        name: str,
        url_or_command: str,
        transport: str = "sse",
        enabled: bool = True,
        env: Optional[dict[str, str]] = None,
        args: Optional[list[str]] = None,
    ):
        self.name = name
        self.url_or_command = url_or_command
        self.transport = transport  # "sse" or "stdio"
        self.enabled = enabled
        self.env = env or {}  # Extra environment variables for stdio
        self.args = args or []  # Extra arguments for stdio command
        self.status = "disconnected"  # disconnected | connecting | connected | error
        self.tools: list[dict] = []
        self.error_message: str = ""
        self.last_connected: float = 0
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def connect(self) -> bool:
        """Connect to the MCP server and discover tools."""
        if not self.enabled:
            self.status = "disconnected"
            return False

        self.status = "connecting"
        self.error_message = ""
        try:
            if self.transport == "sse":
                return await self._connect_sse()
            elif self.transport == "stdio":
                return await self._connect_stdio()
            else:
                self.status = "error"
                self.error_message = f"Unknown transport: {self.transport}"
                return False
        except Exception as e:
            self.status = "error"
            self.error_message = str(e)[:200]
            logger.error("MCP connect failed for %s: %s", self.name, e)
            return False

    async def _connect_sse(self) -> bool:
        """Connect via SSE transport (HTTP-based MCP server)."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Initialize handshake
                init_payload = {
                    "jsonrpc": "2.0",
                    "id": self._next_id(),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "friday", "version": "1.0"},
                    },
                }
                resp = await client.post(self.url_or_command, json=init_payload)
                resp.raise_for_status()

                # Discover tools
                tools_payload = {
                    "jsonrpc": "2.0",
                    "id": self._next_id(),
                    "method": "tools/list",
                    "params": {},
                }
                resp = await client.post(self.url_or_command, json=tools_payload)
                resp.raise_for_status()
                result = resp.json()

                tools_data = result.get("result", {}).get("tools", [])
                self._update_tools(tools_data)
                self.status = "connected"
                self.last_connected = time.time()
                logger.info("MCP SSE connected to %s — %d tools", self.name, len(self.tools))
                return True

        except httpx.ConnectError:
            self.status = "error"
            self.error_message = f"Cannot connect to {self.url_or_command}"
            return False
        except Exception as e:
            self.status = "error"
            self.error_message = str(e)[:200]
            return False

    async def _connect_stdio(self) -> bool:
        """Connect via stdio transport (subprocess)."""
        try:
            # Kill existing process if any
            if self._process:
                try:
                    self._process.terminate()
                    self._process.wait(timeout=3)
                except Exception:
                    pass
                self._process = None

            # Build command
            parts = self.url_or_command.split()
            if self.args:
                parts.extend(self.args)

            # Build environment
            proc_env = os.environ.copy()
            proc_env.update(self.env)

            self._process = subprocess.Popen(
                parts,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=proc_env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )

            # Initialize handshake
            init_msg = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "friday", "version": "1.0"},
                },
            }
            response = await self._stdio_request(init_msg)
            if not response:
                self.status = "error"
                self.error_message = "No response to initialize"
                return False

            # Send initialized notification
            await self._stdio_notify({"jsonrpc": "2.0", "method": "notifications/initialized"})

            # Discover tools
            tools_msg = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "tools/list",
                "params": {},
            }
            response = await self._stdio_request(tools_msg)
            tools_data = (response or {}).get("result", {}).get("tools", [])
            self._update_tools(tools_data)
            self.status = "connected"
            self.last_connected = time.time()
            logger.info("MCP stdio connected to %s — %d tools", self.name, len(self.tools))
            return True

        except Exception as e:
            self.status = "error"
            self.error_message = str(e)[:200]
            return False

    def _update_tools(self, tools_data: list[dict]) -> None:
        """Update tool list, preserving enabled/disabled state from previous discovery."""
        # Build lookup of previous enabled states
        prev_states = {t["name"]: t.get("enabled", True) for t in self.tools}

        self.tools = [
            {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "input_schema": t.get("inputSchema", {}),
                "enabled": prev_states.get(t.get("name", ""), True),
            }
            for t in tools_data
        ]

    async def _stdio_request(self, msg: dict) -> Optional[dict]:
        """Send JSON-RPC request via stdio and read response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            return None
        line = json.dumps(msg) + "\n"
        self._process.stdin.write(line.encode())
        self._process.stdin.flush()

        loop = asyncio.get_event_loop()
        try:
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, self._process.stdout.readline), timeout=10.0
            )
            return json.loads(raw.decode()) if raw else None
        except asyncio.TimeoutError:
            return None

    async def _stdio_notify(self, msg: dict) -> None:
        if self._process and self._process.stdin:
            line = json.dumps(msg) + "\n"
            self._process.stdin.write(line.encode())
            self._process.stdin.flush()

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """Execute a tool call on this MCP server."""
        if self.status != "connected":
            return {"error": f"Server {self.name} not connected"}
        if not self.enabled:
            return {"error": f"Server {self.name} is disabled"}

        try:
            if self.transport == "sse":
                return await self._call_tool_sse(tool_name, arguments)
            elif self.transport == "stdio":
                return await self._call_tool_stdio(tool_name, arguments)
            else:
                return {"error": f"Unknown transport: {self.transport}"}
        except Exception as e:
            return {"error": str(e)[:200]}

    async def _call_tool_sse(self, tool_name: str, arguments: dict) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }
            resp = await client.post(self.url_or_command, json=payload)
            resp.raise_for_status()
            result = resp.json()
            return result.get("result", result)

    async def _call_tool_stdio(self, tool_name: str, arguments: dict) -> dict:
        msg = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        response = await self._stdio_request(msg)
        if response:
            return response.get("result", response)
        return {"error": "No response from MCP server"}

    async def disconnect(self) -> None:
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=5)
            except Exception:
                pass
            self._process = None
        self.status = "disconnected"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "url_or_command": self.url_or_command,
            "transport": self.transport,
            "enabled": self.enabled,
            "status": self.status,
            "error_message": self.error_message,
            "tools": self.tools,
            "tool_count": len(self.tools),
            "env": self.env,
            "args": self.args,
            "last_connected": self.last_connected,
        }


class MCPManager:
    """Manages multiple MCP server connections with Open WebUI-inspired patterns."""

    def __init__(self):
        self.connections: dict[str, MCPConnection] = {}

    async def load_from_config(self, mcp_configs: list[dict]) -> None:
        """Load MCP servers from settings. Does NOT auto-connect (call connect_all separately)."""
        for cfg in mcp_configs:
            name = cfg.get("name", "")
            if not name:
                continue
            conn = MCPConnection(
                name=name,
                url_or_command=cfg.get("url_or_command", ""),
                transport=cfg.get("transport", "sse"),
                enabled=cfg.get("enabled", True),
                env=cfg.get("env", {}),
                args=cfg.get("args", []),
            )
            # Restore tool states from saved config
            if "tools" in cfg:
                conn.tools = cfg["tools"]
            self.connections[name] = conn

    async def connect_all(self) -> dict[str, bool]:
        """Auto-connect all enabled servers. Returns {name: success} map."""
        results = {}
        tasks = []
        for name, conn in self.connections.items():
            if conn.enabled and conn.status != "connected":
                tasks.append((name, conn.connect()))

        if not tasks:
            return results

        logger.info("Auto-connecting %d MCP servers...", len(tasks))
        completed = await asyncio.gather(
            *[t[1] for t in tasks], return_exceptions=True
        )
        for (name, _), result in zip(tasks, completed):
            if isinstance(result, Exception):
                results[name] = False
                logger.error("MCP auto-connect failed for %s: %s", name, result)
            else:
                results[name] = result
                logger.info("MCP %s: %s", name, "connected" if result else "failed")

        return results

    async def add_server(
        self,
        name: str,
        url_or_command: str,
        transport: str = "sse",
        enabled: bool = True,
        env: Optional[dict[str, str]] = None,
        args: Optional[list[str]] = None,
    ) -> MCPConnection:
        """Add a new server and attempt connection."""
        conn = MCPConnection(
            name=name,
            url_or_command=url_or_command,
            transport=transport,
            enabled=enabled,
            env=env or {},
            args=args or [],
        )
        if enabled:
            await conn.connect()
        self.connections[name] = conn
        return conn

    async def remove_server(self, name: str) -> bool:
        conn = self.connections.pop(name, None)
        if conn:
            await conn.disconnect()
            return True
        return False

    async def toggle_server(self, name: str, enabled: bool) -> dict:
        """Enable or disable a server (like Open WebUI's per-connection toggle)."""
        conn = self.connections.get(name)
        if not conn:
            return {"success": False, "message": f"Server '{name}' not found"}

        conn.enabled = enabled
        if enabled and conn.status != "connected":
            success = await conn.connect()
            return {
                "success": success,
                "message": f"Enabled & {'connected' if success else 'connection failed'}",
                "status": conn.status,
            }
        elif not enabled:
            await conn.disconnect()
            return {"success": True, "message": "Server disabled", "status": "disconnected"}

        return {"success": True, "message": "No change", "status": conn.status}

    async def reconnect_server(self, name: str) -> dict:
        """Force reconnect a server (rediscovers tools)."""
        conn = self.connections.get(name)
        if not conn:
            return {"success": False, "message": f"Server '{name}' not found"}
        if not conn.enabled:
            return {"success": False, "message": "Server is disabled — enable it first"}

        # Disconnect first
        await conn.disconnect()
        # Reconnect
        success = await conn.connect()
        return {
            "success": success,
            "message": conn.error_message if not success else f"Reconnected — {len(conn.tools)} tools found",
            "tools": conn.tools if success else [],
            "status": conn.status,
        }

    async def test_server(self, name: str) -> dict:
        conn = self.connections.get(name)
        if not conn:
            return {"success": False, "message": f"Server '{name}' not found"}
        success = await conn.connect()
        return {
            "success": success,
            "message": conn.error_message if not success else f"Connected — {len(conn.tools)} tools found",
            "tools": conn.tools if success else [],
            "status": conn.status,
        }

    def get_all_tools(self) -> list[dict]:
        """Get all enabled tools across all connected+enabled servers, for LLM injection."""
        tools = []
        for name, conn in self.connections.items():
            if conn.status != "connected" or not conn.enabled:
                continue
            for tool in conn.tools:
                if tool.get("enabled", True):
                    tools.append({
                        "server": name,
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "input_schema": tool.get("input_schema", {}),
                    })
        return tools

    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> dict:
        conn = self.connections.get(server_name)
        if not conn:
            return {"error": f"Server '{server_name}' not found"}
        return await conn.call_tool(tool_name, arguments)

    def get_all_servers(self) -> list[dict]:
        return [conn.to_dict() for conn in self.connections.values()]

    def get_stats(self) -> dict:
        """Summary stats for display."""
        total = len(self.connections)
        connected = sum(1 for c in self.connections.values() if c.status == "connected")
        enabled = sum(1 for c in self.connections.values() if c.enabled)
        total_tools = len(self.get_all_tools())
        return {
            "total_servers": total,
            "connected": connected,
            "enabled": enabled,
            "total_tools": total_tools,
        }

    async def shutdown(self) -> None:
        """Gracefully disconnect all servers."""
        for conn in self.connections.values():
            await conn.disconnect()
        logger.info("All MCP servers disconnected")


# Module-level singleton
mcp_manager = MCPManager()
