"""
F.R.I.D.A.Y. Settings Manager
Persists LLM config, API keys, and MCP server settings to settings.json.
"""

import json
import os
import logging
from pathlib import Path
from typing import Any, Callable, Optional
from copy import deepcopy

logger = logging.getLogger("friday.settings")

SETTINGS_DIR = Path(__file__).parent
SETTINGS_FILE = SETTINGS_DIR / "settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "llm": {
        "rest": {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "api_key": "",
            "base_url": "",
            "temperature": 0.7,
        },
        "voice": {
            "provider": "google",
            "model": "gemini-2.0-flash-001",
            "api_key": "",
            "base_url": "",
            "temperature": 0.6,
        },
        "chat": {
            "provider": "groq",
            "model": "llama-3.1-8b-instant",
            "api_key": "",
            "base_url": "",
            "temperature": 0.6,
        },
    },
    "api_keys": {
        "GROQ_API_KEY": "",
        "GOOGLE_API_KEY": "",
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "SHODAN_API_KEY": "",
        "VIRUSTOTAL_API_KEY": "",
        "SECURITYTRAILS_API_KEY": "",
        "HIBP_API_KEY": "",
    },
    "mcp_servers": [],
}


class SettingsManager:
    """Singleton settings manager. Load/save from JSON, notify on change."""

    def __init__(self):
        self._settings: dict[str, Any] = self._load()
        self._change_callbacks: list[Callable[[str], None]] = []

    # ── persistence ──

    def _load(self) -> dict[str, Any]:
        if SETTINGS_FILE.exists():
            try:
                with open(SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                # Merge with defaults so new keys are always present
                merged = deepcopy(DEFAULT_SETTINGS)
                for section in merged:
                    if section in data:
                        if isinstance(merged[section], dict):
                            merged[section].update(data[section])
                        else:
                            merged[section] = data[section]
                logger.info("Settings loaded from %s", SETTINGS_FILE)
                return merged
            except Exception as e:
                logger.warning("Failed to load settings: %s — using defaults", e)
        return deepcopy(DEFAULT_SETTINGS)

    def save(self) -> None:
        SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, "w") as f:
            json.dump(self._settings, f, indent=2)
        logger.info("Settings saved to %s", SETTINGS_FILE)

    # ── getters / setters ──

    def get_all(self) -> dict[str, Any]:
        return deepcopy(self._settings)

    def get(self, section: str) -> Any:
        return deepcopy(self._settings.get(section))

    def update_section(self, section: str, data: Any) -> None:
        if isinstance(self._settings.get(section), dict) and isinstance(data, dict):
            self._settings[section].update(data)
        else:
            self._settings[section] = data
        self.save()
        self._notify(section)

    def update_llm_slot(self, slot: str, data: dict) -> None:
        """Update a specific LLM slot (rest/voice/chat)."""
        if slot not in ("rest", "voice", "chat"):
            raise ValueError(f"Invalid LLM slot: {slot}")
        self._settings["llm"][slot].update(data)
        self.save()
        self._notify(f"llm.{slot}")

    def get_llm_slot(self, slot: str) -> dict:
        return deepcopy(self._settings["llm"].get(slot, {}))

    # ── API keys ──

    def get_api_key(self, key_name: str) -> str:
        """Get API key — settings.json value takes priority, fallback to env."""
        settings_val = self._settings.get("api_keys", {}).get(key_name, "")
        if settings_val:
            return settings_val
        return os.getenv(key_name, "")

    def update_api_keys(self, keys: dict[str, str]) -> None:
        for k, v in keys.items():
            self._settings["api_keys"][k] = v
            # Also update os.environ so existing code picks it up
            if v:
                os.environ[k] = v
        self.save()
        self._notify("api_keys")

    def get_api_key_status(self) -> dict[str, dict]:
        """Return status of each API key (configured or missing)."""
        result = {}
        for key_name in DEFAULT_SETTINGS["api_keys"]:
            val = self.get_api_key(key_name)
            result[key_name] = {
                "configured": bool(val and val != f"your_{key_name.lower()}_here"),
                "source": "settings" if self._settings["api_keys"].get(key_name) else ("env" if os.getenv(key_name) else "none"),
                "masked": self._mask_key(val) if val else "",
            }
        return result

    @staticmethod
    def _mask_key(key: str) -> str:
        if not key or len(key) < 8:
            return "***"
        return key[:4] + "•" * (len(key) - 7) + key[-3:]

    # ── MCP servers ──

    def get_mcp_servers(self) -> list[dict]:
        return deepcopy(self._settings.get("mcp_servers", []))

    def add_mcp_server(self, server: dict) -> None:
        servers = self._settings.get("mcp_servers", [])
        # Don't add duplicates by name
        servers = [s for s in servers if s.get("name") != server["name"]]
        servers.append(server)
        self._settings["mcp_servers"] = servers
        self.save()
        self._notify("mcp_servers")

    def remove_mcp_server(self, name: str) -> bool:
        servers = self._settings.get("mcp_servers", [])
        before = len(servers)
        self._settings["mcp_servers"] = [s for s in servers if s.get("name") != name]
        self.save()
        self._notify("mcp_servers")
        return len(self._settings["mcp_servers"]) < before

    def update_mcp_server(self, name: str, updates: dict) -> bool:
        """Update an MCP server's config (enabled, env, args, etc.)."""
        for server in self._settings.get("mcp_servers", []):
            if server.get("name") == name:
                for k, v in updates.items():
                    server[k] = v
                self.save()
                self._notify("mcp_servers")
                return True
        return False

    def update_mcp_server_tools(self, name: str, tools_enabled: dict[str, bool]) -> bool:
        for server in self._settings.get("mcp_servers", []):
            if server.get("name") == name:
                for tool in server.get("tools", []):
                    if tool["name"] in tools_enabled:
                        tool["enabled"] = tools_enabled[tool["name"]]
                self.save()
                self._notify("mcp_servers")
                return True
        return False

    # ── change notification ──

    def on_change(self, callback: Callable[[str], None]) -> None:
        self._change_callbacks.append(callback)

    def _notify(self, section: str) -> None:
        for cb in self._change_callbacks:
            try:
                cb(section)
            except Exception as e:
                logger.error("Settings change callback error: %s", e)


# Module-level singleton
settings_manager = SettingsManager()
