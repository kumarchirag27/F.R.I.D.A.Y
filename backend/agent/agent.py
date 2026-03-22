"""
F.R.I.D.A.Y. LiveKit Voice Agent

Real-time streaming voice pipeline:
  User speaks (WebRTC) -> Silero VAD -> Groq Whisper STT -> Google Gemini LLM (streaming)
  -> Edge-TTS (per-sentence via StreamAdapter) -> Audio back to user (WebRTC)

All 7 recon tools are available for the LLM to call.
"""

import os
import sys
import logging

# Add backend to sys.path for tool imports
_backend_dir = os.path.join(os.path.dirname(__file__), "..")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(_backend_dir, ".env"))

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.agents.tts import StreamAdapter
from livekit.plugins import groq, google, silero

from agent.edge_tts_plugin import EdgeTTS
from agent.friday_tools import ALL_TOOLS

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("friday.agent")

# ── F.R.I.D.A.Y. System Prompt (kept short to minimize token usage) ──
SYSTEM_PROMPT = """You are F.R.I.D.A.Y., Tony Stark's tactical AI. Irish lilt, sharp and concise. Call the user 'Boss'.
You do cybersecurity recon. Confirm targets before scanning. Summarize results briefly.
Rules: 1-3 sentences max. No markdown or formatting. Conversational and instant."""


# ── Create AgentServer with LiveKit credentials ──
server = AgentServer(
    ws_url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
    api_key=os.getenv("LIVEKIT_API_KEY", "devkey"),
    api_secret=os.getenv("LIVEKIT_API_SECRET", "secret"),
)


@server.rtc_session(agent_name="friday-agent")
async def entrypoint(ctx: JobContext):
    """Main entrypoint for the F.R.I.D.A.Y. voice agent."""
    logger.info("F.R.I.D.A.Y. voice agent starting...")

    await ctx.connect()

    # ── STT: Groq Cloud Whisper (fast, no GPU) ──
    stt = groq.STT(
        model="whisper-large-v3-turbo",
        language="en",
    )

    # ── LLM: Load from settings.json (hot-configurable via Settings page) ──
    voice_cfg = {"provider": "google", "model": "gemini-2.0-flash-001", "temperature": 0.6}
    try:
        import json as _json
        _settings_path = os.path.join(_backend_dir, "config", "settings.json")
        with open(_settings_path) as _f:
            _cfg = _json.load(_f)
            voice_cfg = _cfg.get("llm", {}).get("voice", voice_cfg)
        logger.info(f"Voice LLM config from settings: {voice_cfg['provider']}/{voice_cfg['model']}")
    except Exception:
        logger.info("Using default voice LLM config (settings.json not found)")

    _voice_provider = voice_cfg.get("provider", "") or "google"
    _voice_model = voice_cfg.get("model", "") or "gemini-2.0-flash-001"
    _voice_temp = voice_cfg.get("temperature", 0.6)

    if _voice_provider == "google":
        llm = google.LLM(model=_voice_model, temperature=_voice_temp)
    elif _voice_provider == "groq":
        llm = groq.LLM(model=_voice_model, temperature=_voice_temp)
    elif _voice_provider == "ollama":
        # Local Ollama via OpenAI-compatible plugin
        try:
            from livekit.plugins import openai as lk_openai
            _base_url = voice_cfg.get("base_url", "") or "http://localhost:11434/v1"
            llm = lk_openai.LLM(model=_voice_model, api_key="ollama", base_url=_base_url, temperature=_voice_temp)
        except ImportError:
            logger.warning("livekit-plugins-openai not installed, falling back to Google")
            llm = google.LLM(model="gemini-2.0-flash-001", temperature=0.6)
    else:
        # For OpenAI, Anthropic, or OpenAI-compatible, use the openai plugin
        try:
            from livekit.plugins import openai as lk_openai
            _api_key = voice_cfg.get("api_key") or os.getenv(f"{_voice_provider.upper()}_API_KEY", "")
            _base_url = voice_cfg.get("base_url", "")
            if _voice_provider == "openai-compatible":
                llm = lk_openai.LLM(model=_voice_model, api_key=_api_key or "not-needed", base_url=_base_url or "http://localhost:11434/v1", temperature=_voice_temp)
            elif _voice_provider == "anthropic":
                llm = lk_openai.LLM(model=_voice_model, api_key=_api_key, base_url="https://api.anthropic.com/v1/", temperature=_voice_temp)
            else:
                llm = lk_openai.LLM(model=_voice_model, api_key=_api_key, temperature=_voice_temp)
        except ImportError:
            logger.warning("livekit-plugins-openai not installed, falling back to Google")
            llm = google.LLM(model="gemini-2.0-flash-001", temperature=0.6)

    # ── TTS: Edge-TTS with StreamAdapter for per-sentence streaming ──
    # StreamAdapter breaks LLM output into sentences and synthesizes each
    # individually, so the first sentence plays while others are still generating
    raw_tts = EdgeTTS(voice="en-IE-EmilyNeural", rate="+10%")
    streamed_tts = StreamAdapter(tts=raw_tts)

    # ── VAD: Silero (segments audio for Groq Whisper) ──
    vad = silero.VAD.load()

    # ── Determine if tools are supported by this LLM provider/model ──
    # Most cloud providers support tool-calling. For Ollama, only certain models do.
    OLLAMA_TOOL_CAPABLE = {"llama3.1", "llama3.2", "llama3.3", "qwen2.5", "qwen3", "mistral", "mixtral", "command-r", "firefunction"}
    _use_tools = ALL_TOOLS
    if _voice_provider == "ollama":
        model_base = _voice_model.split(":")[0].lower()
        if any(cap in model_base for cap in OLLAMA_TOOL_CAPABLE):
            logger.info(f"Ollama model {_voice_model} supports tool-calling — recon tools enabled")
        else:
            logger.info(f"Ollama model {_voice_model} — disabling recon tools (no tool-calling support)")
            _use_tools = []

    # ── Create Agent ──
    agent = Agent(
        instructions=SYSTEM_PROMPT,
        stt=stt,
        llm=llm,
        tts=streamed_tts,
        vad=vad,
        tools=_use_tools,
        allow_interruptions=True,
        min_endpointing_delay=0.5,
    )

    # ── Start session ──
    session = AgentSession()
    await session.start(agent=agent, room=ctx.room)

    # Greet the user
    await session.say("F.R.I.D.A.Y. online. Awaiting your command, Boss.")
    logger.info("F.R.I.D.A.Y. voice agent ready - awaiting commands")


if __name__ == "__main__":
    cli.run_app(server)
