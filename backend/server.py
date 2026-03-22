import os
import json
import logging
import shutil
import uuid
import time
import socket
import psutil
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
SERVER_START_TIME = time.time()

# Setup Audit Logger
logging.basicConfig(
    filename='audit.log',
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)

app = FastAPI(title="F.R.I.D.A.Y. API")

TARGETS_FILE = "allowed_targets.json"
SCAN_RESULTS_FILE = "scan_results.json"
DEFAULT_TARGETS = ["scanme.nmap.org", "testphp.vulnweb.com", "hack.me"]

def load_targets() -> list:
    if os.path.exists(TARGETS_FILE):
        try:
            with open(TARGETS_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return DEFAULT_TARGETS.copy()

def save_targets(targets: list):
    with open(TARGETS_FILE, "w") as f:
        json.dump(targets, f, indent=2)

ALLOWED_TARGETS = load_targets()

def load_scan_history() -> list:
    if os.path.exists(SCAN_RESULTS_FILE):
        try:
            with open(SCAN_RESULTS_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_scan_history():
    with open(SCAN_RESULTS_FILE, "w") as f:
        json.dump(SCAN_HISTORY[-200:], f, indent=2)

SCAN_HISTORY: list = load_scan_history()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("audio", exist_ok=True)

# Custom middleware to ensure /audio static files get CORS headers
# (FastAPI StaticFiles mount is a sub-app that doesn't inherit CORS middleware)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class AudioCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if request.url.path.startswith("/audio/"):
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
        return response

app.add_middleware(AudioCORSMiddleware)

app.mount("/audio", StaticFiles(directory="audio"), name="audio")

from llm.brain import FridayBrain
from voice.stt import transcribe_audio
from voice.tts import generate_speech
from config.settings_manager import settings_manager
from config.llm_factory import get_model_list, get_providers, test_llm_connection, create_llm_client
from config.token_tracker import token_tracker
from mcp.client import mcp_manager
import asyncio
import subprocess
import signal

# ── LiveKit Token Generation + Agent Dispatch ─────────────────────────
from livekit.api import AccessToken, VideoGrants, LiveKitAPI, CreateAgentDispatchRequest
from livekit.protocol.room import ListParticipantsRequest

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "secret")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
# HTTP URL for LiveKit API calls (ws:// -> http://)
LIVEKIT_HTTP_URL = LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://")

brain = FridayBrain()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_message(self, message: str, message_type: str = "info", websocket: WebSocket = None):
        data = json.dumps({"type": message_type, "message": message})
        if websocket:
            try:
                await websocket.send_text(data)
            except Exception:
                pass
        else:
            for connection in self.active_connections:
                try:
                    await connection.send_text(data)
                except Exception:
                    pass

manager = ConnectionManager()

class FridayRequest(BaseModel):
    query: str
    target: Optional[str] = None
    mode: str
    authorized: bool = False

class ChatRequest(BaseModel):
    text: str

class TargetRequest(BaseModel):
    target: str

async def _dispatch_agent_to_room(room_name: str):
    """Background task: dispatch the voice agent to a room if not already present."""
    try:
        lk_api = LiveKitAPI(
            url=LIVEKIT_HTTP_URL,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
        )
        # Check if an agent is already in the room (kind=4 is AGENT)
        has_agent = False
        try:
            parts = await lk_api.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )
            has_agent = any(p.kind == 4 for p in parts.participants)
        except Exception:
            pass  # Room may not exist yet — that's fine, dispatch will create it

        if not has_agent:
            await lk_api.agent_dispatch.create_dispatch(
                CreateAgentDispatchRequest(agent_name="friday-agent", room=room_name)
            )
            logging.info("Dispatched friday-agent to room %s", room_name)
        else:
            logging.info("Agent already in room %s, skipping dispatch", room_name)
        await lk_api.aclose()
    except Exception as e:
        logging.warning("Could not dispatch voice agent (is it running?): %s", e)


@app.get("/api/livekit-token")
async def get_livekit_token(identity: str = "friday-user"):
    """Generate a LiveKit room token and dispatch the voice agent to the room."""
    room_name = "friday-room"

    token = AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
        .with_identity(identity) \
        .with_name("Boss") \
        .with_grants(VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
        ))

    # Fire-and-forget: dispatch agent in background so response is instant
    asyncio.create_task(_dispatch_agent_to_room(room_name))

    return {
        "token": token.to_jwt(),
        "url": LIVEKIT_URL,
    }

@app.get("/api/targets")
async def get_targets():
    return {"targets": ALLOWED_TARGETS}

@app.post("/api/targets")
async def add_target(req: TargetRequest):
    target = req.target.strip().lower()
    if not target:
        raise HTTPException(status_code=400, detail="Target cannot be empty.")
    if target not in ALLOWED_TARGETS:
        ALLOWED_TARGETS.append(target)
        save_targets(ALLOWED_TARGETS)
        logging.info(f"New allowed target added: {target}")
    return {"targets": ALLOWED_TARGETS}

@app.get("/api/status")
async def get_status():
    uptime_seconds = int(time.time() - SERVER_START_TIME)
    hours, remainder = divmod(uptime_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return {
        "status": "online",
        "uptime": uptime_str,
        "uptime_seconds": uptime_seconds,
        "scan_count": len(SCAN_HISTORY),
        "allowed_targets_count": len(ALLOWED_TARGETS),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/api/history")
async def get_history():
    return {"history": SCAN_HISTORY[-50:]}

@app.get("/api/auditlog")
async def get_auditlog(lines: int = 100):
    try:
        if not os.path.exists("audit.log"):
            return {"entries": []}
        with open("audit.log", "r") as f:
            all_lines = f.readlines()
        return {"entries": [l.strip() for l in all_lines[-lines:] if l.strip()]}
    except Exception as e:
        return {"entries": [], "error": str(e)}

@app.get("/api/metrics")
async def get_metrics():
    cpu_percent = psutil.cpu_percent(interval=0.3)
    mem = psutil.virtual_memory()
    thread_count = 0
    for proc in psutil.process_iter(['num_threads']):
        try:
            thread_count += proc.info['num_threads'] or 0
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    # CPU temperature (may not be available on all systems)
    core_temp = None
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            for entries in temps.values():
                if entries:
                    core_temp = entries[0].current
                    break
    except (AttributeError, Exception):
        pass
    return {
        "cpu_percent": round(cpu_percent, 1),
        "memory_used_gb": round(mem.used / (1024 ** 3), 1),
        "memory_total_gb": round(mem.total / (1024 ** 3), 1),
        "memory_percent": mem.percent,
        "core_temp": core_temp,
        "threads": thread_count,
    }

@app.get("/api/network")
async def get_network():
    net = psutil.net_io_counters()
    net_if = psutil.net_if_stats()
    active_interfaces = sum(1 for v in net_if.values() if v.isup)
    # Measure latency to common DNS (Google 8.8.8.8)
    latency_ms = None
    try:
        start = time.time()
        s = socket.create_connection(("8.8.8.8", 53), timeout=2)
        s.close()
        latency_ms = round((time.time() - start) * 1000, 1)
    except Exception:
        pass
    return {
        "bytes_sent": net.bytes_sent,
        "bytes_recv": net.bytes_recv,
        "packets_sent": net.packets_sent,
        "packets_recv": net.packets_recv,
        "active_interfaces": active_interfaces,
        "latency_ms": latency_ms,
        "uplink": latency_ms is not None,
    }

@app.get("/api/health")
async def get_api_health():
    """Check which API keys are configured and valid."""
    keys = {
        "GROQ": os.getenv("GROQ_API_KEY", ""),
        "SHODAN": os.getenv("SHODAN_API_KEY", ""),
        "VIRUSTOTAL": os.getenv("VIRUSTOTAL_API_KEY", ""),
        "SECURITYTRAILS": os.getenv("SECURITYTRAILS_API_KEY", ""),
        "HIBP": os.getenv("HIBP_API_KEY", ""),
    }
    result = {}
    for name, key in keys.items():
        if not key or key.startswith("your_"):
            result[name] = {"status": "missing", "configured": False}
        else:
            result[name] = {"status": "configured", "configured": True}
    return {"keys": result}

# Mutable chat client holder (hot-swappable via settings)
from groq import Groq as _Groq
from llm.prompts import SYSTEM_PROMPT as _SYS_PROMPT
_CHAT_SYSTEM = _SYS_PROMPT + "\nVOICE MODE: Reply in 1 short sentence. No lists, no markdown, no asterisks. Be instant like Alexa."


class ChatClientHolder:
    """Mutable container for the fast chat LLM client — reconfigurable at runtime."""
    def __init__(self):
        chat_cfg = settings_manager.get_llm_slot("chat")
        self.model = chat_cfg.get("model", "llama-3.1-8b-instant")
        self.temperature = chat_cfg.get("temperature", 0.6)
        try:
            self.client = create_llm_client(
                provider=chat_cfg.get("provider", "groq"),
                api_key=chat_cfg.get("api_key") or settings_manager.get_api_key("GROQ_API_KEY"),
                base_url=chat_cfg.get("base_url", ""),
            )
        except Exception:
            self.client = _Groq()

    def reconfigure(self, provider: str, model: str, api_key: str = "",
                    base_url: str = "", temperature: float = 0.6):
        self.client = create_llm_client(provider, api_key, base_url)
        self.model = model
        self.temperature = temperature


_chat_holder = ChatClientHolder()

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """Ultra-fast voice chat — 8B model, no tools, short responses."""
    user_text = req.text.strip()
    if not user_text:
        return {"status": "error", "message": "No text provided."}

    try:
        def fast_chat():
            resp = _chat_holder.client.chat.completions.create(
                model=_chat_holder.model,
                messages=[
                    {"role": "system", "content": _CHAT_SYSTEM},
                    {"role": "user", "content": user_text},
                ],
                max_tokens=60,
                temperature=_chat_holder.temperature,
            )
            token_tracker.record_from_response("chat", resp)
            return resp.choices[0].message.content

        final_text = await asyncio.to_thread(fast_chat)
        if not final_text:
            final_text = "I didn't catch that, Boss."

        # Generate TTS
        out_filename = f"response_{uuid.uuid4()}.mp3"
        out_path = os.path.join("audio", out_filename)
        tts_result = await generate_speech(final_text, out_path)

        if "error" in tts_result:
            return {"status": "success", "response": final_text, "audio_url": None}

        return {
            "status": "success",
            "response": final_text,
            "audio_url": f"http://localhost:8000/audio/{out_filename}"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/friday")
async def friday_endpoint(req: FridayRequest):
    # Scope check
    is_allowed_target = any(t in req.target for t in ALLOWED_TARGETS) if req.target else True
    
    if not is_allowed_target and not req.authorized:
        logging.warning(f"Unauthorized out-of-scope scan attempt on {req.target}")
        raise HTTPException(status_code=403, detail="Target is out of scope and requires explicit authorization confirmation.")
    
    if not req.authorized:
        logging.warning(f"Unauthorized scan attempt on {req.target}")
        raise HTTPException(status_code=403, detail="You must confirm authorization to scan this target.")
        
    logging.info(f"Authorized scan initiated: Target={req.target}, Mode={req.mode}, Query='{req.query}'")
    
    # Record in scan history (persisted)
    SCAN_HISTORY.append({
        "target": req.target,
        "mode": req.mode,
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "date": datetime.utcnow().isoformat()
    })
    if len(SCAN_HISTORY) > 200:
        SCAN_HISTORY.pop(0)
    save_scan_history()
    
    # Offload brain processing to thread pool to not block async endpoints
    try:
        # Define a synchronous callback that uses asyncio.run_coroutine_threadsafe 
        # or just calls the async function. Since we are in to_thread, we can use 
        # asyncio.run to send the message back if we want, or just let brain.py return.
        # Another approach: we'll pass an async loop queue, but simpler: 
        # Let's define a callback that schedules the send_message on the main loop.
        loop = asyncio.get_running_loop()
        def stream_callback(msg: str, msg_type: str = "info"):
            asyncio.run_coroutine_threadsafe(manager.send_message(msg, msg_type), loop)

        response_data = await asyncio.to_thread(brain.process_query, req.query, req.target, stream_callback)
        
        # Signal scan done to progress widget
        await manager.send_message("SCAN_COMPLETE", "done")

        if isinstance(response_data, dict) and "error" in response_data:
            return {"status": "error", "message": response_data["error"]}
            
        return {"status": "success", "message": response_data}
    except Exception as e:
        await manager.send_message("SCAN_ERROR", "done")
        return {"status": "error", "message": str(e)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # We can handle inputs from websocket if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("Client disconnected")

@app.post("/api/voice")
async def voice_endpoint(file: UploadFile = File(...), wake_word: str = Form("false")):
    try:
        filename = f"{uuid.uuid4()}_{file.filename}"
        if not filename.endswith('.webm') and not filename.endswith('.wav'):
            filename += '.webm'

        file_path = os.path.join("audio", filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Guard: reject truly empty files
        file_size = os.path.getsize(file_path)
        logging.info(f"Received audio file: {file_size} bytes, wake_word={wake_word}")
        if file_size < 100:
            if wake_word.lower() == "true":
                return {"status": "no_wake_word"}
            return {"status": "error", "message": "Recording was empty. Try again."}

        # 1. Transcribe audio via Whisper
        transcription_result = await asyncio.to_thread(transcribe_audio, file_path)
        if "error" in transcription_result:
            if wake_word.lower() == "true":
                return {"status": "no_wake_word"}
            return {"status": "error", "message": transcription_result["error"]}

        user_text = transcription_result.get("text", "").strip()
        if not user_text:
            if wake_word.lower() == "true":
                return {"status": "no_wake_word"}
            return {"status": "error", "message": "Could not transcribe audio. Try speaking louder."}

        logging.info(f"Transcription: '{user_text}' (wake_word={wake_word})")

        # 2. Wake word detection if enabled
        is_wake_mode = wake_word.lower() == "true"
        if is_wake_mode:
            lower = user_text.lower().strip()
            # Remove common Whisper artifacts
            lower = lower.strip(".,!? ")

            command = None
            # Check multi-word prefixes first
            for prefix in ["hey friday", "hi friday", "ok friday", "okay friday"]:
                if lower.startswith(prefix):
                    command = user_text[len(prefix):].strip(" ,.:!?")
                    break

            # Check single "friday" prefix
            if command is None:
                if lower.startswith("friday"):
                    command = user_text[6:].strip(" ,.:!?")

            if command is None:
                # No wake word found
                logging.info(f"No wake word in: '{user_text}'")
                return {"status": "no_wake_word"}

            if not command:
                # Just said "Friday" without a command — acknowledge
                logging.info("Wake word only — acknowledging")
                ack_text = "Yes Boss, I'm listening."
                out_filename = f"response_{uuid.uuid4()}.mp3"
                out_path = os.path.join("audio", out_filename)
                tts_result = await generate_speech(ack_text, out_path)
                audio_url = f"http://localhost:8000/audio/{out_filename}" if "error" not in tts_result else None
                return {
                    "status": "wake_word_only",
                    "response": ack_text,
                    "audio_url": audio_url,
                }

            # Wake word + command found — use command as user_text
            logging.info(f"Wake word command: '{command}'")
            user_text = command

        # 3. Fast LLM response (8B model, no tools, instant)
        def fast_chat():
            resp = _chat_holder.client.chat.completions.create(
                model=_chat_holder.model,
                messages=[
                    {"role": "system", "content": _CHAT_SYSTEM},
                    {"role": "user", "content": user_text},
                ],
                max_tokens=60,
                temperature=_chat_holder.temperature,
            )
            token_tracker.record_from_response("chat", resp)
            return resp.choices[0].message.content

        final_text = await asyncio.to_thread(fast_chat)
        if not final_text:
            final_text = "I didn't catch that, Boss."

        # 4. Generate Speech
        out_filename = f"response_{uuid.uuid4()}.mp3"
        out_path = os.path.join("audio", out_filename)
        tts_result = await generate_speech(final_text, out_path)

        audio_url = None
        if "error" not in tts_result:
            audio_url = f"http://localhost:8000/audio/{out_filename}"

        return {
            "status": "success",
            "transcription": user_text,
            "response": final_text,
            "audio_url": audio_url,
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}

# ── Token Usage Endpoint ──────────────────────────────────────────────

@app.get("/api/token-usage")
async def get_token_usage():
    """Return accumulated LLM token usage across all slots."""
    return token_tracker.get_usage()


@app.post("/api/token-usage/reset")
async def reset_token_usage():
    """Reset token usage counters."""
    token_tracker.reset()
    return {"status": "ok", "message": "Token counters reset"}


# ── Voice Agent Lifecycle Management ──────────────────────────────────

_voice_agent_process: subprocess.Popen | None = None


def _kill_voice_agents() -> bool:
    """Kill all voice agent processes. Returns True if any were killed."""
    global _voice_agent_process
    killed = False

    # 1. Kill our tracked subprocess
    if _voice_agent_process is not None:
        try:
            _voice_agent_process.kill()
            _voice_agent_process.wait(timeout=5)
            killed = True
        except Exception:
            pass
        _voice_agent_process = None

    # 2. Scan for any orphaned agent processes (by command line)
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            cmd_str = " ".join(cmdline).lower()
            if "agent.agent" in cmd_str or "agent\\agent" in cmd_str:
                proc.kill()
                proc.wait(timeout=5)
                killed = True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
            pass

    # 3. Kill anything still holding port 8081 (agent's HTTP server)
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            for conn in proc.net_connections(kind="inet"):
                if conn.laddr.port == 8081 and conn.status == "LISTEN":
                    logging.info(f"Killing orphan process {proc.pid} on port 8081")
                    proc.kill()
                    proc.wait(timeout=5)
                    killed = True
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
            pass

    # Small delay to let OS release the port
    if killed:
        import time as _time
        _time.sleep(1)

    return killed


def _start_voice_agent() -> dict:
    """Start the voice agent process. Returns status dict."""
    global _voice_agent_process

    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        venv_python = os.path.join(backend_dir, "venv", "Scripts", "python.exe")
        if not os.path.exists(venv_python):
            venv_python = os.path.join(backend_dir, "venv", "bin", "python")
        if not os.path.exists(venv_python):
            venv_python = "python"

        # Log agent output to file for debugging (not PIPE to avoid zombie issues)
        agent_log = os.path.join(backend_dir, "agent_output.log")
        log_handle = open(agent_log, "w")

        _voice_agent_process = subprocess.Popen(
            [venv_python, "-m", "agent.agent", "start"],
            cwd=backend_dir,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        logging.info(f"Voice agent started (PID: {_voice_agent_process.pid}), log: {agent_log}")
        return {"status": "ok", "message": f"Voice agent started (PID: {_voice_agent_process.pid})"}
    except Exception as e:
        logging.error(f"Failed to start voice agent: {e}")
        return {"status": "error", "message": str(e)}


def _restart_voice_agent() -> dict:
    """Kill existing agent and start fresh."""
    killed = _kill_voice_agents()
    result = _start_voice_agent()
    result["killed_previous"] = killed
    return result


_agent_watchdog_running = False


async def _agent_watchdog():
    """Background watchdog: monitors voice agent and auto-restarts if it dies."""
    global _agent_watchdog_running
    _agent_watchdog_running = True
    restart_count = 0
    max_rapid_restarts = 5  # Stop trying if it crashes too many times in a row
    last_restart_time = 0

    while _agent_watchdog_running:
        await asyncio.sleep(10)  # Check every 10 seconds

        if _voice_agent_process is None:
            continue

        exit_code = _voice_agent_process.poll()
        if exit_code is not None:
            # Agent died — check if we should restart
            now = time.time()
            if now - last_restart_time > 60:
                restart_count = 0  # Reset counter after 60s of stability

            if restart_count >= max_rapid_restarts:
                logging.error(f"Voice agent crashed {restart_count} times rapidly — stopping auto-restart. Check agent_output.log")
                continue

            restart_count += 1
            last_restart_time = now
            logging.warning(f"Voice agent died (exit code {exit_code}), auto-restarting... (attempt {restart_count})")
            _kill_voice_agents()  # Clean up ports
            _start_voice_agent()


@app.on_event("startup")
async def _auto_start_voice_agent():
    """Auto-start voice agent, watchdog, and MCP servers when the backend boots."""
    # Small delay to let the server fully initialize
    await asyncio.sleep(2)
    # Kill any zombies from previous runs FIRST
    _kill_voice_agents()
    logging.info("Auto-starting voice agent...")
    _start_voice_agent()
    # Start watchdog
    asyncio.create_task(_agent_watchdog())
    logging.info("Voice agent watchdog started")

    # Auto-connect saved MCP servers
    mcp_configs = settings_manager.get_mcp_servers()
    if mcp_configs:
        logging.info("Loading %d MCP servers from settings...", len(mcp_configs))
        await mcp_manager.load_from_config(mcp_configs)
        results = await mcp_manager.connect_all()
        for name, ok in results.items():
            logging.info("  MCP %s: %s", name, "connected" if ok else "failed")


@app.post("/api/settings/restart-voice-agent")
async def restart_voice_agent():
    """Kill the voice agent process (if running) and spawn a new one."""
    return _restart_voice_agent()


@app.get("/api/voice-agent/status")
async def voice_agent_status():
    """Check if the voice agent process is alive and registered."""
    alive = _voice_agent_process is not None and _voice_agent_process.poll() is None
    # Check if agent's HTTP server is actually listening (proves it didn't crash on startup)
    registered = False
    if alive:
        try:
            import socket as _sock
            s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
            s.settimeout(0.5)
            result = s.connect_ex(("localhost", 8081))
            registered = result == 0
            s.close()
        except Exception:
            pass

    exit_code = None
    if _voice_agent_process is not None and not alive:
        exit_code = _voice_agent_process.poll()

    return {
        "running": alive,
        "registered": registered,
        "pid": _voice_agent_process.pid if alive else None,
        "exit_code": exit_code,
    }


# ── Settings API Endpoints ────────────────────────────────────────────

class LLMSettingsRequest(BaseModel):
    target: str  # "rest" | "voice" | "chat" | "all"
    provider: str
    model: str
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    temperature: Optional[float] = 0.7

class LLMTestRequest(BaseModel):
    provider: str
    model: str
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""

class APIKeysRequest(BaseModel):
    keys: dict

class MCPServerRequest(BaseModel):
    name: str
    url_or_command: str
    transport: str = "sse"
    enabled: bool = True
    env: dict = {}
    args: list[str] = []

class MCPServerUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    env: Optional[dict] = None
    args: Optional[list[str]] = None

class MCPToolsUpdateRequest(BaseModel):
    tools: dict


@app.get("/api/settings")
async def get_settings():
    """Return all settings (API keys masked in the response)."""
    data = settings_manager.get_all()
    # Mask API keys in response
    if "api_keys" in data:
        masked = {}
        for k, v in data["api_keys"].items():
            if v and not v.startswith("your_"):
                masked[k] = v[:4] + "•" * max(0, len(v) - 7) + v[-3:] if len(v) > 7 else "***"
            else:
                masked[k] = ""
        data["api_keys"] = masked
    return data


@app.put("/api/settings/llm")
async def update_llm_settings(req: LLMSettingsRequest):
    """Update LLM configuration for a specific slot or all."""
    update_data = {
        "provider": req.provider,
        "model": req.model,
        "api_key": req.api_key or "",
        "base_url": req.base_url or "",
        "temperature": req.temperature or 0.7,
    }

    slots = ["rest", "voice", "chat"] if req.target == "all" else [req.target]

    for slot in slots:
        if slot not in ("rest", "voice", "chat"):
            raise HTTPException(status_code=400, detail=f"Invalid slot: {slot}")
        settings_manager.update_llm_slot(slot, update_data)

        # Hot-swap for REST brain
        if slot == "rest":
            try:
                brain.reconfigure(
                    provider=req.provider,
                    model=req.model,
                    api_key=req.api_key or settings_manager.get_api_key(f"{req.provider.upper()}_API_KEY"),
                    base_url=req.base_url or "",
                    temperature=req.temperature or 0.7,
                )
            except Exception as e:
                logging.warning(f"Brain reconfigure failed: {e}")

        # Hot-swap for chat client
        if slot == "chat":
            try:
                _chat_holder.reconfigure(
                    provider=req.provider,
                    model=req.model,
                    api_key=req.api_key or settings_manager.get_api_key(f"{req.provider.upper()}_API_KEY"),
                    base_url=req.base_url or "",
                    temperature=req.temperature or 0.6,
                )
            except Exception as e:
                logging.warning(f"Chat holder reconfigure failed: {e}")

    # Auto-restart voice agent when voice settings change
    voice_restarted = False
    if "voice" in slots:
        logging.info("Voice settings changed — auto-restarting voice agent...")
        _restart_voice_agent()
        voice_restarted = True

    return {
        "status": "ok",
        "message": f"LLM settings updated for {req.target}",
        "voice_restarted": voice_restarted,
    }


@app.post("/api/settings/llm/test")
async def test_llm_endpoint(req: LLMTestRequest):
    """Test connection to an LLM provider."""
    result = await test_llm_connection(
        provider=req.provider,
        model=req.model,
        api_key=req.api_key or settings_manager.get_api_key(f"{req.provider.upper()}_API_KEY") or "",
        base_url=req.base_url or "",
    )
    return result


@app.get("/api/settings/llm/models/{provider}")
async def get_llm_models(provider: str):
    """Return available models for a provider."""
    return {"models": get_model_list(provider)}


@app.get("/api/settings/llm/providers")
async def get_llm_providers():
    """Return list of supported LLM providers."""
    return {"providers": get_providers()}


@app.put("/api/settings/api-keys")
async def update_api_keys(req: APIKeysRequest):
    """Update API keys. Saves to settings.json and updates os.environ."""
    settings_manager.update_api_keys(req.keys)
    return {"status": "ok", "message": f"Updated {len(req.keys)} key(s)"}


@app.get("/api/settings/api-keys/status")
async def get_api_key_status():
    """Return configured/missing status for each API key."""
    return {"keys": settings_manager.get_api_key_status()}


# ── MCP Server Endpoints ─────────────────────────────────────────────

@app.get("/api/settings/mcp/servers")
async def get_mcp_servers():
    """List all configured MCP servers with status and tools."""
    return {
        "servers": mcp_manager.get_all_servers(),
        "stats": mcp_manager.get_stats(),
    }


@app.post("/api/settings/mcp/servers")
async def add_mcp_server(req: MCPServerRequest):
    """Add and connect a new MCP server."""
    conn = await mcp_manager.add_server(
        name=req.name,
        url_or_command=req.url_or_command,
        transport=req.transport,
        enabled=req.enabled,
        env=req.env,
        args=req.args,
    )
    # Persist to settings
    settings_manager.add_mcp_server({
        "name": req.name,
        "url_or_command": req.url_or_command,
        "transport": req.transport,
        "enabled": req.enabled,
        "env": req.env,
        "args": req.args,
        "tools": conn.tools,
    })
    return {"status": "ok", "server": conn.to_dict()}


@app.delete("/api/settings/mcp/servers/{name}")
async def remove_mcp_server(name: str):
    """Remove an MCP server."""
    removed = await mcp_manager.remove_server(name)
    if removed:
        settings_manager.remove_mcp_server(name)
    return {"status": "ok" if removed else "not_found"}


@app.put("/api/settings/mcp/servers/{name}")
async def update_mcp_server(name: str, req: MCPServerUpdateRequest):
    """Update server config (enable/disable, env vars, args)."""
    updates: dict = {}
    if req.enabled is not None:
        updates["enabled"] = req.enabled
        # Toggle in manager
        result = await mcp_manager.toggle_server(name, req.enabled)
        if not result.get("success"):
            return result
    if req.env is not None:
        updates["env"] = req.env
    if req.args is not None:
        updates["args"] = req.args

    if updates:
        settings_manager.update_mcp_server(name, updates)

    conn = mcp_manager.connections.get(name)
    return {"status": "ok", "server": conn.to_dict() if conn else None}


@app.post("/api/settings/mcp/servers/{name}/test")
async def test_mcp_server(name: str):
    """Test connection to an MCP server."""
    result = await mcp_manager.test_server(name)
    # Persist discovered tools
    conn = mcp_manager.connections.get(name)
    if conn and conn.tools:
        settings_manager.update_mcp_server(name, {"tools": conn.tools})
    return result


@app.post("/api/settings/mcp/servers/{name}/reconnect")
async def reconnect_mcp_server(name: str):
    """Force reconnect — rediscovers tools."""
    result = await mcp_manager.reconnect_server(name)
    # Persist discovered tools
    conn = mcp_manager.connections.get(name)
    if conn and conn.tools:
        settings_manager.update_mcp_server(name, {"tools": conn.tools})
    return result


@app.put("/api/settings/mcp/servers/{name}/tools")
async def update_mcp_tools(name: str, req: MCPToolsUpdateRequest):
    """Enable/disable individual tools on an MCP server."""
    # Update in settings
    updated = settings_manager.update_mcp_server_tools(name, req.tools)
    # Also update live connection
    conn = mcp_manager.connections.get(name)
    if conn:
        for tool in conn.tools:
            if tool["name"] in req.tools:
                tool["enabled"] = req.tools[tool["name"]]
    return {"status": "ok" if updated else "not_found"}


@app.on_event("shutdown")
async def _shutdown():
    """Graceful shutdown — disconnect MCP servers."""
    await mcp_manager.shutdown()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
