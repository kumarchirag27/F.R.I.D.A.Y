import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Radio, Wifi, WifiOff } from "lucide-react";
import {
  LiveKitRoom,
  useVoiceAssistant,
  useConnectionState,
  RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";

/*
 * Voice system — LiveKit WebRTC streaming pipeline.
 *
 * Flow:
 *   1. Browser connects to LiveKit room, publishes mic via WebRTC
 *   2. Voice agent (Python) subscribes to audio, runs:
 *      Silero VAD -> Groq Whisper STT -> Groq LLM (streaming) -> Edge-TTS (per-sentence)
 *   3. Agent audio streams back to browser via WebRTC — plays automatically
 *   4. ~1s latency from end-of-speech to first audio response
 *
 * All recon tools available to agent via @function_tool wrappers.
 */

import { API_BASE } from "@/lib/config";
const API_URL = API_BASE;

interface VoiceInterfaceProps {
  onStateChange?: (state: "passive" | "listening" | "processing" | "responding") => void;
}

// ── Step indicator for connection progress ────────────────────
const StepDot = ({ label, done, active }: { label: string; done: boolean; active?: boolean }) => (
  <div className="flex items-center gap-1.5">
    <div
      className={`w-1.5 h-1.5 ${done ? "bg-emerald-400" : active ? "bg-primary animate-pulse" : "bg-primary/15"}`}
      style={done ? { boxShadow: "0 0 4px rgba(52,211,153,0.6)" } : active ? { boxShadow: "0 0 4px rgba(0,212,255,0.6)" } : undefined}
    />
    <span className={`font-display text-[7px] tracking-widest ${done ? "text-emerald-400/60" : active ? "text-primary/40" : "text-primary/15"}`}>
      {label}
    </span>
  </div>
);

// ── Typing animation ──────────────────────────────────────────
const TypingText = ({ text, speed = 25 }: { text: string; speed?: number }) => {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, i + 1)); i++; }
      else { setDone(true); clearInterval(iv); }
    }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);
  return <span>{displayed}{!done && <span className="text-primary animate-blink">|</span>}</span>;
};

// ══════════════════════════════════════════════════════════════
// ── Inner component (must be inside LiveKitRoom) ─────────────
// ══════════════════════════════════════════════════════════════
const VoiceContent = ({ onStateChange }: VoiceInterfaceProps) => {
  // useVoiceAssistant works directly inside LiveKitRoom (no session provider needed)
  const { state: agentState, agentTranscriptions, audioTrack } = useVoiceAssistant();
  const connectionState = useConnectionState();

  // Map LiveKit agent state -> F.R.I.D.A.Y. UI phase
  type Phase = "connecting" | "standby" | "listening" | "processing" | "responding" | "error";
  const [phase, setPhase] = useState<Phase>("connecting");
  const [lastTranscript, setLastTranscript] = useState("");

  // ── Delayed transition: keep response visible after agent stops speaking ──
  // displayPhase lags behind the real phase when leaving "responding"
  const [displayPhase, setDisplayPhase] = useState<Phase>("connecting");
  const [isFadingOut, setIsFadingOut] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const RESPONSE_LINGER_MS = 6000; // Keep response visible for 6 seconds

  // Derive phase from agent state
  // agentState values: "disconnected" | "connecting" | "listening" | "thinking" | "speaking"
  useEffect(() => {
    let newPhase: Phase;

    switch (agentState) {
      case "disconnected":
        newPhase = "error";
        break;
      case "connecting":
        newPhase = "connecting";
        break;
      case "listening":
        newPhase = "standby";
        break;
      case "thinking":
        newPhase = "processing";
        break;
      case "speaking":
        newPhase = "responding";
        break;
      default:
        newPhase = "connecting";
    }

    setPhase(newPhase);

    // Notify parent (CoreBlob state)
    const blobMap: Record<Phase, "passive" | "listening" | "processing" | "responding"> = {
      connecting: "passive",
      standby: "listening",
      listening: "listening",
      processing: "processing",
      responding: "responding",
      error: "passive",
    };
    onStateChange?.(blobMap[newPhase]);
  }, [agentState, onStateChange]);

  // ── Manage displayPhase with linger delay ──
  useEffect(() => {
    // If entering "responding", show immediately and cancel any pending fade
    if (phase === "responding") {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      setIsFadingOut(false);
      setDisplayPhase("responding");
      return;
    }

    // If leaving "responding" → start linger timer
    if (displayPhase === "responding" && phase !== "responding") {
      // Start fade-out effect
      setIsFadingOut(true);

      // After linger period, transition to the real phase
      fadeTimerRef.current = setTimeout(() => {
        setDisplayPhase(phase);
        setIsFadingOut(false);
        fadeTimerRef.current = null;
      }, RESPONSE_LINGER_MS);
      return;
    }

    // For all other transitions, update immediately
    if (displayPhase !== "responding") {
      setDisplayPhase(phase);
    }

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [phase, displayPhase]);

  // Track agent transcription segments — accumulate full response
  const [transcriptSegments, setTranscriptSegments] = useState<string[]>([]);
  const prevTranscriptCountRef = useRef(0);

  useEffect(() => {
    if (agentTranscriptions && agentTranscriptions.length > 0) {
      const latest = agentTranscriptions[agentTranscriptions.length - 1];
      if (latest && latest.text) {
        setLastTranscript(latest.text);
      }
      // If new transcription segments arrived, accumulate them
      if (agentTranscriptions.length > prevTranscriptCountRef.current) {
        const newSegments = agentTranscriptions
          .slice(prevTranscriptCountRef.current)
          .map((t) => t.text)
          .filter(Boolean);
        if (newSegments.length > 0) {
          setTranscriptSegments((prev) => [...prev, ...newSegments]);
        }
        prevTranscriptCountRef.current = agentTranscriptions.length;
      }
    }
  }, [agentTranscriptions]);

  // Clear accumulated transcript when agent starts a new response
  useEffect(() => {
    if (phase === "processing") {
      setTranscriptSegments([]);
      prevTranscriptCountRef.current = agentTranscriptions?.length ?? 0;
    }
  }, [phase]);

  // Build the full response text from all segments
  const fullResponseText = transcriptSegments.join(" ") || lastTranscript;

  const isConnected = connectionState === "connected";

  // ══════════════════════════════════════════════════════════════
  // ── RENDER ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      {/* Agent audio playback */}
      <RoomAudioRenderer />

      {/* ── Error / Disconnected ── */}
      <AnimatePresence>
        {displayPhase === "error" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
            <div className="border border-red-500/40 bg-red-500/10 p-2.5 chamfer-sm">
              <p className="font-body text-xs text-red-300/80 mb-2">
                Agent connection failed. Check that LiveKit server and voice agent are running.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-3 py-1.5 border border-primary/40 bg-primary/10 chamfer-sm font-display text-[10px] tracking-[0.15em] text-primary uppercase hover:bg-primary/20"
              >
                <Mic className="w-3 h-3" /> RETRY
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Connecting — step-by-step progress ── */}
      <AnimatePresence>
        {displayPhase === "connecting" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
            <div className="border border-primary/20 bg-primary/[0.03] p-3 chamfer-sm space-y-2">
              <div className="flex items-center gap-3">
                <Wifi className="w-4 h-4 text-primary/40 animate-pulse" />
                <span className="font-display text-[9px] tracking-[0.2em] text-primary/40 uppercase">
                  ESTABLISHING VOICE LINK...
                </span>
              </div>
              {/* Step indicators */}
              <div className="flex gap-3 pl-7">
                <StepDot label="ROOM" done={isConnected} />
                <StepDot label="AGENT" done={false} active={isConnected} />
                <StepDot label="READY" done={false} />
              </div>
              {/* Animated progress bar */}
              <div className="h-0.5 bg-primary/10 overflow-hidden chamfer-sm ml-7">
                <motion.div
                  className="h-full bg-primary/40"
                  animate={{ width: ["0%", "60%", "30%", "80%", "40%"] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Standby: Agent connected, listening for speech ── */}
      <AnimatePresence>
        {displayPhase === "standby" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
            <div className="border border-emerald-400/20 bg-emerald-400/[0.03] p-2.5 chamfer-sm">
              <div className="flex items-center gap-3 p-0.5">
                <div className="relative">
                  <Radio className="w-4 h-4 text-emerald-400/60" />
                  <div
                    className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 animate-pulse rounded-full"
                    style={{ boxShadow: "0 0 6px rgba(52,211,153,0.6)" }}
                  />
                </div>
                <span className="font-display text-[9px] tracking-[0.2em] text-emerald-400/50 uppercase flex-1">
                  {isConnected ? 'VOICE ACTIVE — SPEAK TO COMMAND' : 'WAITING FOR AGENT...'}
                </span>
                <div className="flex items-center gap-1">
                  {isConnected ? (
                    <Wifi className="w-3 h-3 text-emerald-400/40" />
                  ) : (
                    <WifiOff className="w-3 h-3 text-primary/30 animate-pulse" />
                  )}
                </div>
              </div>
              {/* Subtle ambient pulse */}
              <div className="h-0.5 bg-emerald-400/5 mt-2 overflow-hidden chamfer-sm">
                <motion.div
                  className="h-full bg-emerald-400/30"
                  animate={{ width: ["0%", "20%", "5%", "15%", "0%"] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Processing / Thinking ── */}
      <AnimatePresence>
        {displayPhase === "processing" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="w-full"
          >
            <div className="border border-primary/20 bg-primary/5 p-3 chamfer-sm">
              <div className="hud-label mb-1.5 flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 bg-primary animate-pulse"
                  style={{ boxShadow: "0 0 6px rgba(0,212,255,0.8)" }}
                />
                PROCESSING
              </div>
              <p className="font-body text-sm text-foreground/60 leading-relaxed">Analyzing request...</p>
              {/* Processing wave */}
              <div className="flex gap-0.5 mt-2 h-3 items-end">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-primary/40 rounded-sm"
                    animate={{ height: ["4px", `${8 + Math.random() * 8}px`, "4px"] }}
                    transition={{ duration: 0.6 + Math.random() * 0.4, repeat: Infinity, delay: i * 0.05 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Speaking / Responding (with 6s linger after speech ends) ── */}
      <AnimatePresence>
        {displayPhase === "responding" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: isFadingOut ? 0.5 : 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: isFadingOut ? 2 : 0.3 }}
            className="w-full"
          >
            <div
              className={`border p-3 chamfer-sm transition-all duration-1000 ${
                isFadingOut
                  ? "border-primary/15 bg-primary/[0.03]"
                  : "border-primary/30 bg-primary/[0.08] glow-border"
              }`}
            >
              <div className="hud-label mb-1.5 flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 transition-colors duration-1000 ${
                    isFadingOut ? "bg-primary/40" : "bg-primary"
                  }`}
                  style={{
                    boxShadow: isFadingOut
                      ? "0 0 3px hsl(191 100% 50% / 0.3)"
                      : "0 0 6px hsl(191 100% 50% / 0.8)",
                  }}
                />
                {isFadingOut ? "F.R.I.D.A.Y_LAST_RESPONSE" : "F.R.I.D.A.Y_RESPONSE"}
              </div>
              {fullResponseText && (
                <p
                  className={`font-body text-xs mb-2 leading-relaxed transition-colors duration-1000 ${
                    isFadingOut ? "text-foreground/25" : "text-foreground/40"
                  }`}
                >
                  {isFadingOut ? fullResponseText : <TypingText text={lastTranscript} speed={15} />}
                </p>
              )}
              {/* Audio wave bars — only animate while actively speaking */}
              {!isFadingOut && (
                <div className="flex gap-0.5 h-4 items-center justify-center mt-1">
                  {[...Array(16)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-primary/60 rounded-sm"
                      animate={{ height: ["2px", `${6 + Math.random() * 10}px`, "2px"] }}
                      transition={{ duration: 0.4 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.04 }}
                    />
                  ))}
                </div>
              )}
              {/* Fade-out progress bar */}
              {isFadingOut && (
                <div className="h-0.5 bg-primary/5 mt-2 overflow-hidden chamfer-sm">
                  <motion.div
                    className="h-full bg-primary/20"
                    initial={{ width: "100%" }}
                    animate={{ width: "0%" }}
                    transition={{ duration: RESPONSE_LINGER_MS / 1000, ease: "linear" }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// ── Main VoiceInterface (wraps LiveKitRoom) ──────────────────
// ══════════════════════════════════════════════════════════════
const VoiceInterface = ({ onStateChange }: VoiceInterfaceProps) => {
  const [token, setToken] = useState<string>("");
  const [lkUrl, setLkUrl] = useState<string>("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch LiveKit token from FastAPI backend on mount
  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        const res = await fetch(`${API_URL}/api/livekit-token`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setToken(data.token);
          setLkUrl(data.url);
          console.log("[FRIDAY] LiveKit token acquired, connecting to:", data.url);
        }
      } catch (e: any) {
        console.error("[FRIDAY] Failed to fetch LiveKit token:", e);
        if (!cancelled) {
          setFetchError(e.message);
          // Retry in 3 seconds
          setTimeout(fetchToken, 3000);
        }
      }
    };
    fetchToken();
    return () => { cancelled = true; };
  }, []);

  // Show error if token fetch fails
  if (fetchError && !token) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="border border-red-500/40 bg-red-500/10 p-2.5 chamfer-sm w-full">
          <p className="font-body text-xs text-red-300/80 mb-2">
            Cannot connect to voice system: {fetchError}
          </p>
          <button
            onClick={() => { setFetchError(null); window.location.reload(); }}
            className="flex items-center gap-2 px-3 py-1.5 border border-primary/40 bg-primary/10 chamfer-sm font-display text-[10px] tracking-[0.15em] text-primary uppercase hover:bg-primary/20"
          >
            <Mic className="w-3 h-3" /> RETRY
          </button>
        </div>
      </div>
    );
  }

  // Show loading while fetching token
  if (!token || !lkUrl) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="border border-primary/20 bg-primary/[0.03] p-3 chamfer-sm w-full space-y-2">
          <div className="flex items-center gap-3">
            <Mic className="w-4 h-4 text-primary/30 animate-pulse" />
            <span className="font-display text-[9px] tracking-[0.2em] text-primary/30 uppercase">
              INITIALIZING VOICE SYSTEM...
            </span>
          </div>
          <div className="flex gap-3 pl-7">
            <StepDot label="TOKEN" done={false} active={true} />
            <StepDot label="ROOM" done={false} />
            <StepDot label="AGENT" done={false} />
          </div>
          <div className="h-0.5 bg-primary/10 overflow-hidden chamfer-sm ml-7">
            <motion.div
              className="h-full bg-primary/30"
              animate={{ width: ["0%", "40%", "20%", "50%"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={lkUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      style={{ display: "contents" }}
      onError={(err) => {
        console.error("[FRIDAY] LiveKit room error:", err);
      }}
    >
      <VoiceContent onStateChange={onStateChange} />
    </LiveKitRoom>
  );
};

export default VoiceInterface;
