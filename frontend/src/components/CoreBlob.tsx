import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";

export type BlobState = "idle" | "listening" | "processing" | "responding";

const stateConfig: Record<BlobState, { color: string; glow: string; label: string; speed: number }> = {
  idle:       { color: "#00d4ff", glow: "rgba(0,212,255,0.4)",   label: "STANDBY",    speed: 4    },
  listening:  { color: "#00ffe5", glow: "rgba(0,255,229,0.5)",   label: "LISTENING",  speed: 1.5  },
  processing: { color: "#ffaa00", glow: "rgba(255,170,0,0.5)",   label: "PROCESSING", speed: 0.8  },
  responding: { color: "#00d4ff", glow: "rgba(0,212,255,0.7)",   label: "RESPONDING", speed: 1    },
};

// Generate blob path with variable distortion
const blobPath = (radius: number, points: number, variance: number, seed: number) => {
  const angleStep = (Math.PI * 2) / points;
  const coords = Array.from({ length: points }, (_, i) => {
    const angle = i * angleStep;
    const r = radius + Math.sin(seed + i * 1.8) * variance;
    return `${150 + r * Math.cos(angle)},${150 + r * Math.sin(angle)}`;
  });
  return `M${coords.join("L")}Z`;
};

const CoreBlob = ({ state = "idle", onToggleListen }: { state: BlobState; onToggleListen?: () => void }) => {
  const cfg = stateConfig[state];
  const [seed, setSeed] = useState(0);
  const animFrame = useRef<number>(0);

  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      setSeed(s => s + 0.02 * (4 / cfg.speed));
      animFrame.current = requestAnimationFrame(tick);
    };
    animFrame.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animFrame.current); };
  }, [cfg.speed]);

  const baseVariance = state === "idle" ? 8 : state === "listening" ? 15 : state === "processing" ? 12 : 20;
  const baseRadius = 80;

  return (
    <div className="relative flex items-center justify-center w-full h-full min-h-[300px]">
      {/* Corner brackets */}
      {[
        "top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"
      ].map((pos, i) => {
        const isRight = pos.includes("right");
        const isBottom = pos.includes("bottom");
        return (
          <svg key={i} className={`absolute ${pos} w-8 h-8 text-primary/40`}>
            <line
              x1={isRight ? 32 : 0} y1={isBottom ? 32 : 0}
              x2={isRight ? 32 : 0} y2={isBottom ? 16 : 16}
              stroke="currentColor" strokeWidth="1"
            />
            <line
              x1={isRight ? 32 : 0} y1={isBottom ? 32 : 0}
              x2={isRight ? 16 : 16} y2={isBottom ? 32 : 0}
              stroke="currentColor" strokeWidth="1"
            />
          </svg>
        );
      })}

      {/* Outer rotating ring */}
      <motion.div
        className="absolute w-56 h-56 border border-primary/10"
        style={{ borderRadius: "50%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute w-48 h-48 border border-dashed"
        style={{ borderRadius: "50%", borderColor: `${cfg.color}33` }}
        animate={{ rotate: -360 }}
        transition={{ duration: state === "processing" ? 3 : 15, repeat: Infinity, ease: "linear" }}
      />

      {/* Glow layers */}
      <motion.div
        className="absolute w-40 h-40"
        style={{ borderRadius: "50%", background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)` }}
        animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: cfg.speed, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* SVG blob */}
      <motion.svg
        viewBox="0 0 300 300"
        className="w-44 h-44 cursor-pointer"
        onClick={onToggleListen}
        style={{ filter: `drop-shadow(0 0 20px ${cfg.glow})` }}
        animate={state === "responding" ? { scale: [1, 1.08, 0.96, 1.04, 1] } : { scale: 1 }}
        transition={state === "responding" ? { duration: 0.6, repeat: Infinity } : {}}
      >
        <defs>
          <radialGradient id="blobGrad" cx="40%" cy="40%">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.05" />
          </radialGradient>
        </defs>
        {/* Outer blob */}
        <motion.path
          d={blobPath(baseRadius + 10, 8, baseVariance * 1.2, seed * 0.7)}
          fill="none"
          stroke={cfg.color}
          strokeWidth="0.5"
          opacity={0.2}
        />
        {/* Main blob */}
        <motion.path
          d={blobPath(baseRadius, 8, baseVariance, seed)}
          fill="url(#blobGrad)"
          stroke={cfg.color}
          strokeWidth="1.5"
          opacity={0.8}
        />
        {/* Inner blob */}
        <motion.path
          d={blobPath(baseRadius * 0.5, 6, baseVariance * 0.6, seed * 1.5)}
          fill="none"
          stroke={cfg.color}
          strokeWidth="0.5"
          opacity={0.3}
        />
        {/* Core dot */}
        <circle cx="150" cy="150" r="3" fill={cfg.color} opacity={0.9} />
      </motion.svg>

      {/* Center text overlay */}
      <div className="absolute flex flex-col items-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.5, 1] }}
          transition={{ duration: 0.3 }}
          className="font-display text-2xl md:text-4xl glow-text tracking-[0.3em]"
          style={{ color: cfg.color, textShadow: `0 0 15px ${cfg.glow}, 0 0 30px ${cfg.glow}` }}
        >
          F.R.I.D.A.Y
        </motion.div>
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="hud-label mt-2"
          style={{ color: `${cfg.color}aa` }}
        >
          {cfg.label}
        </motion.div>
      </div>

      {/* Waveform visualizer ring — active during listening/responding */}
      <AnimatePresence>
        {(state === "listening" || state === "responding") && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute w-64 h-64 pointer-events-none"
          >
            <svg viewBox="0 0 200 200" className="w-full h-full">
              {Array.from({ length: 64 }).map((_, i) => {
                const angle = (i / 64) * Math.PI * 2;
                const innerR = 75;
                const x1 = 100 + Math.cos(angle) * innerR;
                const y1 = 100 + Math.sin(angle) * innerR;
                return (
                  <motion.line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={100 + Math.cos(angle) * (innerR + 8)}
                    y2={100 + Math.sin(angle) * (innerR + 8)}
                    stroke={cfg.color}
                    strokeWidth="1.5"
                    opacity={0.5}
                    animate={{
                      x2: [
                        100 + Math.cos(angle) * (innerR + 4),
                        100 + Math.cos(angle) * (innerR + 8 + Math.random() * 14),
                        100 + Math.cos(angle) * (innerR + 4),
                      ],
                      y2: [
                        100 + Math.sin(angle) * (innerR + 4),
                        100 + Math.sin(angle) * (innerR + 8 + Math.random() * 14),
                        100 + Math.sin(angle) * (innerR + 4),
                      ],
                      opacity: [0.3, 0.7, 0.3],
                    }}
                    transition={{
                      duration: 0.6 + Math.random() * 0.6,
                      repeat: Infinity,
                      delay: i * 0.02,
                      ease: "easeInOut",
                    }}
                  />
                );
              })}
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wave bars for responding state */}
      <AnimatePresence>
        {state === "responding" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-8 flex items-end gap-[3px] h-6"
          >
            {Array.from({ length: 24 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-[2px]"
                style={{ backgroundColor: cfg.color }}
                animate={{ height: [4, 16 + Math.random() * 8, 4] }}
                transition={{ duration: 0.5 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.04 }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CoreBlob;
