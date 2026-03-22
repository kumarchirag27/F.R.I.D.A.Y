"""
Token Usage Tracker — accumulates LLM token usage across all slots.
Thread-safe singleton that tracks prompt/completion/total tokens per slot
(rest, chat, voice) and overall totals since server start.
"""

import threading
import time


class TokenTracker:
    """Tracks LLM token usage across all slots."""

    def __init__(self):
        self._lock = threading.Lock()
        self._start_time = time.time()
        # Per-slot counters
        self._slots = {
            "rest": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "requests": 0},
            "chat": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "requests": 0},
            "voice": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "requests": 0},
        }

    def record(self, slot: str, prompt_tokens: int = 0, completion_tokens: int = 0, total_tokens: int = 0):
        """Record token usage for a given slot."""
        if slot not in self._slots:
            return
        with self._lock:
            s = self._slots[slot]
            s["prompt_tokens"] += prompt_tokens
            s["completion_tokens"] += completion_tokens
            s["total_tokens"] += total_tokens or (prompt_tokens + completion_tokens)
            s["requests"] += 1

    def record_from_response(self, slot: str, response):
        """Extract usage from an OpenAI-compatible chat completion response and record it."""
        try:
            usage = getattr(response, "usage", None)
            if usage is None:
                return
            prompt = getattr(usage, "prompt_tokens", 0) or 0
            completion = getattr(usage, "completion_tokens", 0) or 0
            total = getattr(usage, "total_tokens", 0) or 0
            self.record(slot, prompt_tokens=prompt, completion_tokens=completion, total_tokens=total)
        except Exception:
            pass

    def get_usage(self) -> dict:
        """Return full usage report."""
        with self._lock:
            totals = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "requests": 0}
            slots_copy = {}
            for slot, counters in self._slots.items():
                slots_copy[slot] = dict(counters)
                for k in totals:
                    totals[k] += counters[k]

            return {
                "slots": slots_copy,
                "totals": totals,
                "session_uptime_seconds": int(time.time() - self._start_time),
            }

    def reset(self):
        """Reset all counters."""
        with self._lock:
            for s in self._slots.values():
                for k in s:
                    s[k] = 0
            self._start_time = time.time()


# Module-level singleton
token_tracker = TokenTracker()
