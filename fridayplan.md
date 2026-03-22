# F.R.I.D.A.Y. Build Plan
*AI-Powered Cybersecurity Reconnaissance Assistant*
**Note**: For Educational & Authorized Security Research Only

## 🏗️ Architecture Overview
F.R.I.D.A.Y. is a voice-controlled AI assistant specialized for cybersecurity reconnaissance.
- **Frontend**: React + Tailwind + Futuristic UI components (Generated via Lovable.dev).
- **Backend**: Python FastAPI Server + LLM tool calling.
- **Communication**: WebSocket / REST API.
- **Core Intelligence**: Groq API / Anthropic with specialized Recon Modules.

## ⚙️ Phase 1: Project Setup

### Folder Structure
```text
FRIDAY/
├── frontend/          ← Lovable.dev exports here
├── backend/
│   ├── server.py      ← FastAPI main server
│   ├── tools/
│   │   ├── dns_recon.py
│   │   ├── ip_recon.py
│   │   ├── whois_tool.py
│   │   ├── port_scanner.py
│   │   ├── subdomain_enum.py
│   │   ├── header_analyzer.py
│   │   └── osint_aggregator.py
│   ├── llm/
│   │   ├── brain.py        ← LLM orchestration
│   │   └── prompts.py      ← System prompts
│   ├── voice/
│   │   ├── stt.py          ← Speech to text
│   │   └── tts.py          ← Text to speech
│   ├── .env
│   └── requirements.txt
└── README.md
```

### Required API Keys (Stored in `.env`)
- **Groq API**: LLM brain (model: `llama-3.3-70b-versatile`)
- **Shodan**: IP/device intel
- **VirusTotal**: Domain/IP reputation
- **SecurityTrails**: DNS history
- **ipapi.co**: IP geolocation
- **Have I Been Pwned**: Breach data

## 🐍 Phase 2: Backend (FastAPI and Tools)

### Core Services
1. **FastAPI Server**: `/api/friday` endpoint for queries and `/ws` WebSocket for streaming responses.
2. **LLM Brain (`brain.py`)**: System prompt defines F.R.I.D.A.Y. Uses Groq's tool calling feature to automatically trigger recon modules.
3. **Tool Router`: Maps LLM tool parameters to the actual Python recon functions.

### Reconnaissance Modules
1. **DNS Recon (`dns_recon.py`)**: Uses `dnspython`.
2. **WHOIS Lookup (`whois_tool.py`)**: Uses `python-whois`.
3. **IP Intelligence (`ip_recon.py`)**: Combines `ipapi.co` and `Shodan`.
4. **Port Scanner (`port_scanner.py`)**: Uses `socket` and `python-nmap`.
5. **Subdomain Enum (`subdomain_enum.py`)**: Top 100 brute force + SecurityTrails API.
6. **HTTP Header Analysis (`header_analyzer.py`)**: Reviews security headers (CSP, HSTS, etc.) using `requests`.
7. **OSINT Aggregator (`osint_aggregator.py`)**: VirusTotal + HIBP checks.

### Voice Layer
- **STT**: `faster-whisper` (local AI transcriber)
- **TTS**: `edge-tts` (en-US-RyanMultilingualNeural voice)

## 🎨 Phase 3: Frontend (Lovable.dev)
- **Aesthetic**: Deep space/dark tech, deep black (#0a0a0f), electric blue (#00d4ff), soft white (#e8f4f8). Sharp angular shapes (military HUD style).
- **Blob Animation**: Central UI element that reacts to mic input (pulsing cyan, amber, green).
- **Panels**: 
  - Reconnaissance input panel (target selection + authorization checkbox).
  - Results Terminal (streaming line-by-line output).
  - Status widgets (draggable).
  - Intelligence Report view (PDF exportable).

## 🛡️ Phase 4: Safety & Ethics (Mandatory)
1. **Authorization Gate**: User must manually input the target and check the authorization confirmation. Backend refuses un-authorized requests. Audit logging required.
2. **Scope Limiting**: Strict allowed target list. Out-of-scope targets require special "I CONFIRM" bypass logic.

## 🧪 Phase 5: Testing
- **Test Order**: DNS → WHOIS → IP Intel → Header Analyzer → Port Scanner (complex) → Subdomain Enum → OSINT Aggregator → Voice Layer.
- **Allowed Targets**: `scanme.nmap.org`, `testphp.vulnweb.com`, `hack.me`, local VPS or TryHackMe/HTB labs. Never test unauthorized systems.
