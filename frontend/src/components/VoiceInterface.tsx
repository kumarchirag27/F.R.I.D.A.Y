import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { Mic, Radio, Wifi, WifiOff, RefreshCw } from "lucide-react";
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

  // Persistent conversation log — stored in localStorage, survives page reloads
  const [conversationLog, setConversationLog] = useState<
    { role: "friday"; text: string; timestamp: number }[]
  >(() => {
    try {
      const saved = localStorage.getItem("friday_transcript");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Save to localStorage whenever log changes
  useEffect(() => {
    try { localStorage.setItem("friday_transcript", JSON.stringify(conversationLog)); } catch {}
  }, [conversationLog]);
  const logEndRef = useRef<HTMLDivElement>(null);

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

  // When agent finishes speaking, save full response to conversation log
  const prevPhaseRef = useRef<Phase>("connecting");
  useEffect(() => {
    // Transition FROM responding TO something else = speech ended
    if (prevPhaseRef.current === "responding" && phase !== "responding") {
      const fullText = transcriptSegments.join(" ");
      if (fullText.trim()) {
        setConversationLog((prev) => [
          ...prev,
          { role: "friday", text: fullText.trim(), timestamp: Date.now() },
        ]);
      }
    }
    // Clear segments when agent starts processing a new question
    if (phase === "processing") {
      setTranscriptSegments([]);
      prevTranscriptCountRef.current = agentTranscriptions?.length ?? 0;
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // Auto-scroll conversation log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationLog, transcriptSegments]);

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

      {/* ── Persistent Conversation Log + Live Response ── */}
      {(conversationLog.length > 0 || displayPhase === "responding") && (
        <div className="w-full border border-primary/20 bg-primary/[0.02] chamfer-sm overflow-hidden">
          <div className="hud-label px-3 pt-2 pb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 bg-primary"
                style={{ boxShadow: "0 0 4px hsl(191 100% 50% / 0.6)" }}
              />
              F.R.I.D.A.Y_TRANSCRIPT
            </div>
            {conversationLog.length > 0 && (
              <button
                onClick={() => setConversationLog([])}
                className="text-[7px] tracking-widest text-red-400/30 hover:text-red-400 uppercase transition-none"
              >
                CLEAR
              </button>
            )}
          </div>

          {/* Scrollable transcript area */}
          <div className="max-h-[160px] overflow-y-auto px-3 pb-2 scroll-smooth" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,212,255,0.2) transparent" }}>
            {/* Past responses */}
            {conversationLog.map((entry, i) => (
              <div key={i} className="py-1.5 border-b border-primary/5 last:border-0">
                <p className="font-body text-xs text-foreground/35 leading-relaxed">
                  {entry.text}
                </p>
              </div>
            ))}

            {/* Live response currently being spoken */}
            {displayPhase === "responding" && fullResponseText && (
              <div className="py-1.5">
                <p className="font-body text-xs text-foreground/50 leading-relaxed">
                  <TypingText text={lastTranscript} speed={15} />
                </p>
                {/* Audio wave bars */}
                {!isFadingOut && (
                  <div className="flex gap-0.5 h-3 items-center mt-1">
                    {[...Array(12)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-primary/50 rounded-sm"
                        animate={{ height: ["2px", `${5 + Math.random() * 8}px`, "2px"] }}
                        transition={{ duration: 0.4 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.04 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={logEndRef} />
          </div>
        </div>
      )}
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
  const [connectKey, setConnectKey] = useState(0); // increment to force reconnect

  const fetchToken = async () => {
    try {
      const res = await fetch(`${API_URL}/api/livekit-token`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setToken(data.token);
      setLkUrl(data.url);
      setFetchError(null);
      console.log("[FRIDAY] LiveKit token acquired, connecting to:", data.url);
    } catch (e: any) {
      console.error("[FRIDAY] Failed to fetch LiveKit token:", e);
      setFetchError(e.message);
      setTimeout(fetchToken, 3000);
    }
  };

  // Fetch token on mount and whenever connectKey changes (reconnect)
  useEffect(() => {
    setToken("");
    setLkUrl("");
    fetchToken();
  }, [connectKey]);

  // Reconnect handler — resets everything and gets a fresh token
  const handleReconnect = () => {
    setToken("");
    setLkUrl("");
    setFetchError(null);
    setConnectKey((k) => k + 1);
  };

  // Show error if token fetch fails
  if (fetchError && !token) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="border border-red-500/40 bg-red-500/10 p-2.5 chamfer-sm w-full">
          <div className="flex items-center justify-between">
            <p className="font-body text-xs text-red-300/80">
              Voice system disconnected: {fetchError}
            </p>
            <button
              onClick={handleReconnect}
              className="flex items-center gap-2 px-3 py-1.5 border border-primary/40 bg-primary/10 chamfer-sm font-display text-[10px] tracking-[0.15em] text-primary uppercase hover:bg-primary/20 shrink-0 ml-3"
            >
              <RefreshCw className="w-3 h-3" /> RECONNECT
            </button>
          </div>
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
      key={connectKey}
      serverUrl={lkUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      style={{ display: "contents" }}
      onDisconnected={() => {
        console.warn("[FRIDAY] LiveKit room disconnected");
      }}
      onError={(err) => {
        console.error("[FRIDAY] LiveKit room error:", err);
      }}
    >
      <VoiceContent onStateChange={onStateChange} />
      {/* Reconnect button — always visible */}
      <div className="w-full flex justify-end px-1">
        <button
          onClick={handleReconnect}
          className="flex items-center gap-1.5 px-2.5 py-1 font-display text-[8px] tracking-widest text-primary/30 hover:text-primary uppercase transition-none"
          title="Reset voice connection"
        >
          <RefreshCw className="w-2.5 h-2.5" />
          RESET VOICE
        </button>
      </div>
    </LiveKitRoom>
  );
};

export default VoiceInterface;
