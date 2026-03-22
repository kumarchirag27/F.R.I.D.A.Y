import time
from groq import Groq

# Use Groq's cloud Whisper — runs on LPU hardware, ~10x faster than local CPU
# Model: whisper-large-v3-turbo (fastest available)
_client = Groq()

def transcribe_audio(audio_path: str):
    """Transcribe audio via Groq cloud Whisper. Near-instant (~0.1-0.3s)."""
    try:
        t0 = time.time()

        with open(audio_path, "rb") as f:
            result = _client.audio.transcriptions.create(
                file=(audio_path, f.read()),
                model="whisper-large-v3-turbo",
                language="en",
                response_format="text",
            )

        text = result.strip() if isinstance(result, str) else ""
        elapsed = time.time() - t0
        print(f"[STT] Groq Whisper: {elapsed:.2f}s - '{text[:80]}'")
        return {"text": text, "language": "en"}
    except Exception as e:
        print(f"[STT] Groq Whisper error: {str(e)[:120]}")
        return {"error": str(e)}
