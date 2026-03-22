"""
F.R.I.D.A.Y. LLM Factory
Creates LLM client instances from provider/model/key configuration.
Supports: Groq, OpenAI, Google, Anthropic, and any OpenAI-compatible endpoint.
"""

import os
import json as _json
import logging
from typing import Any, Optional

logger = logging.getLogger("friday.llm_factory")

# ── Known models per provider ──

MODELS: dict[str, list[dict[str, str]]] = {
    "groq": [
        {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B Versatile"},
        {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B Instant"},
        {"id": "llama-3.1-70b-versatile", "name": "Llama 3.1 70B Versatile"},
        {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B"},
        {"id": "gemma2-9b-it", "name": "Gemma 2 9B"},
    ],
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
        {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo"},
        {"id": "o3-mini", "name": "o3 Mini"},
    ],
    "google": [
        {"id": "gemini-2.0-flash-001", "name": "Gemini 2.0 Flash"},
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
        {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro"},
        {"id": "gemini-2.5-pro-preview-05-06", "name": "Gemini 2.5 Pro"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4"},
        {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet"},
        {"id": "claude-3-5-haiku-20241022", "name": "Claude 3.5 Haiku"},
    ],
    "ollama": [],  # populated dynamically via get_model_list()
    "openai-compatible": [
        {"id": "custom", "name": "Custom Model (enter below)"},
    ],
}


def _fetch_ollama_models(base_url: str = "http://localhost:11434") -> list[dict[str, str]]:
    """Query Ollama /api/tags for locally installed models."""
    try:
        import httpx
        resp = httpx.get(f"{base_url}/api/tags", timeout=3.0)
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "id": m["name"],
                "name": f"{m['name']}  ({m['details'].get('parameter_size', '?')})",
            }
            for m in data.get("models", [])
        ]
    except Exception:
        return []


def get_model_list(provider: str) -> list[dict[str, str]]:
    """Return available models for a provider."""
    if provider == "ollama":
        return _fetch_ollama_models()
    return MODELS.get(provider, [])


def get_providers() -> list[dict[str, str]]:
    """Return list of supported providers."""
    return [
        {"id": "groq", "name": "GROQ"},
        {"id": "ollama", "name": "OLLAMA (LOCAL)"},
        {"id": "google", "name": "GOOGLE GEMINI"},
        {"id": "openai", "name": "OPENAI"},
        {"id": "anthropic", "name": "ANTHROPIC"},
        {"id": "openai-compatible", "name": "OPENAI-COMPATIBLE"},
    ]


# ── Anthropic → OpenAI Adapter ─────────────────────────────────────────
# Lightweight shim so brain.py / ChatClientHolder can call
# client.chat.completions.create() against Anthropic models.

class _OAIFn:
    __slots__ = ("name", "arguments")
    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments

class _OAIToolCall:
    __slots__ = ("id", "type", "function")
    def __init__(self, tc_id: str, name: str, arguments: str):
        self.id = tc_id
        self.type = "function"
        self.function = _OAIFn(name, arguments)

class _OAIMessage:
    __slots__ = ("role", "content", "tool_calls")
    def __init__(self, role="assistant", content=None, tool_calls=None):
        self.role = role
        self.content = content
        self.tool_calls = tool_calls

class _OAIChoice:
    __slots__ = ("index", "message", "finish_reason")
    def __init__(self, message, finish_reason="stop"):
        self.index = 0
        self.message = message
        self.finish_reason = finish_reason

class _OAIUsage:
    __slots__ = ("prompt_tokens", "completion_tokens", "total_tokens")
    def __init__(self, prompt_tokens=0, completion_tokens=0, total_tokens=0):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = total_tokens

class _OAICompletion:
    __slots__ = ("choices", "usage")
    def __init__(self, choices, usage):
        self.choices = choices
        self.usage = usage


class _AnthropicCompletions:
    """Translates OpenAI chat.completions.create() → Anthropic Messages API."""

    def __init__(self, anthropic_client):
        self._client = anthropic_client

    def create(self, model, messages, max_tokens=4096, temperature=None,
               tools=None, tool_choice=None, **kwargs):
        # ── Convert messages ──
        system_text = ""
        converted = []

        for msg in messages:
            if isinstance(msg, dict):
                role = msg.get("role", "")
                if role == "system":
                    system_text = msg["content"]
                elif role == "tool":
                    # OpenAI tool-result → Anthropic tool_result block
                    converted.append({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": msg.get("tool_call_id", ""),
                            "content": msg.get("content", ""),
                        }]
                    })
                else:
                    converted.append({"role": role, "content": msg.get("content", "")})
            else:
                # Object (_OAIMessage or OpenAI ChatCompletionMessage)
                role = getattr(msg, "role", "assistant")
                content = getattr(msg, "content", None)
                tool_calls = getattr(msg, "tool_calls", None)

                if role == "assistant" and tool_calls:
                    blocks = []
                    if content:
                        blocks.append({"type": "text", "text": content})
                    for tc in tool_calls:
                        blocks.append({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.function.name,
                            "input": _json.loads(tc.function.arguments),
                        })
                    converted.append({"role": "assistant", "content": blocks})
                else:
                    converted.append({"role": role, "content": content or ""})

        # Merge consecutive same-role messages (Anthropic requires alternating)
        merged = []
        for msg in converted:
            if merged and merged[-1]["role"] == msg["role"]:
                prev = merged[-1]["content"]
                curr = msg["content"]
                if isinstance(prev, list) and isinstance(curr, list):
                    merged[-1]["content"] = prev + curr
                elif isinstance(prev, list):
                    merged[-1]["content"] = prev + [{"type": "text", "text": str(curr)}]
                elif isinstance(curr, list):
                    merged[-1]["content"] = [{"type": "text", "text": str(prev)}] + curr
                else:
                    merged[-1]["content"] = str(prev) + "\n" + str(curr)
            else:
                merged.append(msg)

        # ── Convert tools ──
        anthropic_tools = None
        if tools:
            anthropic_tools = []
            for t in tools:
                func = t.get("function", {})
                anthropic_tools.append({
                    "name": func["name"],
                    "description": func.get("description", ""),
                    "input_schema": func.get("parameters", {}),
                })

        # ── Call Anthropic ──
        api_kw = {"model": model, "messages": merged, "max_tokens": max_tokens}
        if system_text:
            api_kw["system"] = system_text
        if temperature is not None:
            api_kw["temperature"] = temperature
        if anthropic_tools:
            api_kw["tools"] = anthropic_tools
            if tool_choice == "auto":
                api_kw["tool_choice"] = {"type": "auto"}

        response = self._client.messages.create(**api_kw)

        # ── Convert response → OpenAI format ──
        text_parts = []
        tool_calls_out = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls_out.append(_OAIToolCall(
                    tc_id=block.id,
                    name=block.name,
                    arguments=_json.dumps(block.input),
                ))

        msg_out = _OAIMessage(
            role="assistant",
            content="\n".join(text_parts) if text_parts else None,
            tool_calls=tool_calls_out if tool_calls_out else None,
        )
        in_tok = getattr(response.usage, "input_tokens", 0)
        out_tok = getattr(response.usage, "output_tokens", 0)
        usage_out = _OAIUsage(in_tok, out_tok, in_tok + out_tok)

        return _OAICompletion(
            choices=[_OAIChoice(message=msg_out)],
            usage=usage_out,
        )


class _AnthropicChat:
    def __init__(self, anthropic_client):
        self.completions = _AnthropicCompletions(anthropic_client)


class AnthropicAdapter:
    """Wraps native Anthropic SDK behind an OpenAI-compatible interface."""

    def __init__(self, api_key: str):
        from anthropic import Anthropic
        self._client = Anthropic(api_key=api_key)
        self.chat = _AnthropicChat(self._client)


# ── Factory ────────────────────────────────────────────────────────────

def create_llm_client(provider: str, api_key: str = "", base_url: str = "") -> Any:
    """
    Create an LLM client for the given provider.
    Returns an object with a chat.completions.create() interface (OpenAI-compatible).
    """
    if provider == "groq":
        from groq import Groq
        key = api_key or os.getenv("GROQ_API_KEY", "")
        return Groq(api_key=key) if key else Groq()

    elif provider == "openai":
        from openai import OpenAI
        key = api_key or os.getenv("OPENAI_API_KEY", "")
        return OpenAI(api_key=key)

    elif provider == "anthropic":
        # Native Anthropic SDK with OpenAI-compatible adapter
        key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        return AnthropicAdapter(api_key=key)

    elif provider == "ollama":
        # Local Ollama — OpenAI-compatible at localhost:11434
        from openai import OpenAI
        return OpenAI(
            api_key="ollama",
            base_url=base_url or "http://localhost:11434/v1",
        )

    elif provider == "openai-compatible":
        # Covers LM Studio, vLLM, custom endpoints, etc.
        from openai import OpenAI
        return OpenAI(
            api_key=api_key or "not-needed",
            base_url=base_url or "http://localhost:11434/v1",
        )

    elif provider == "google":
        # Use Google's OpenAI-compatible endpoint (supports chat.completions + tools)
        from openai import OpenAI
        key = api_key or os.getenv("GOOGLE_API_KEY", "")
        return OpenAI(
            api_key=key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )

    else:
        raise ValueError(f"Unknown LLM provider: {provider}")


async def test_llm_connection(provider: str, model: str, api_key: str = "", base_url: str = "") -> dict:
    """
    Test connection to an LLM provider by sending a minimal request.
    Returns {"success": True/False, "message": "...", "latency_ms": ...}
    """
    import time
    start = time.time()

    try:
        if provider == "google":
            try:
                import google.generativeai as genai
                key = api_key or os.getenv("GOOGLE_API_KEY", "")
                genai.configure(api_key=key)
                gen_model = genai.GenerativeModel(model)
                response = gen_model.generate_content("Say OK")
                latency = int((time.time() - start) * 1000)
                return {"success": True, "message": f"Connected to {model}", "latency_ms": latency}
            except ImportError:
                # Fallback to OpenAI-compatible Google endpoint
                from openai import OpenAI
                key = api_key or os.getenv("GOOGLE_API_KEY", "")
                client = OpenAI(api_key=key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "Say OK"}],
                    max_tokens=5,
                )
                latency = int((time.time() - start) * 1000)
                return {"success": True, "message": f"Connected to {model}", "latency_ms": latency}

        elif provider == "anthropic":
            # Use native Anthropic SDK for testing
            try:
                from anthropic import Anthropic
                key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
                client = Anthropic(api_key=key)
                resp = client.messages.create(
                    model=model,
                    max_tokens=5,
                    messages=[{"role": "user", "content": "Say OK"}],
                )
                latency = int((time.time() - start) * 1000)
                return {"success": True, "message": f"Connected to {model}", "latency_ms": latency}
            except ImportError:
                return {"success": False, "message": "anthropic package not installed", "latency_ms": 0}

        else:
            client = create_llm_client(provider, api_key, base_url)
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "Say OK"}],
                max_tokens=5,
            )
            latency = int((time.time() - start) * 1000)
            return {"success": True, "message": f"Connected to {model}", "latency_ms": latency}

    except Exception as e:
        latency = int((time.time() - start) * 1000)
        return {"success": False, "message": str(e)[:200], "latency_ms": latency}
