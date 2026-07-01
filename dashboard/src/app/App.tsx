import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { isWebDemo, subscribeStream } from "../stream.js";

type Phase = "idle" | "loading" | "sailing" | "arrived" | "captured";

type PacketInfo = {
  operation: string;
  protocol: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  xdpAction: string;
};

type PacketEvent = {
  type?: string;
  label?: string;
  protocol?: string;
  src?: string;
  src_port?: number;
  dst?: string;
  dst_port?: number;
  pps?: number;
  total?: number;
};

const DEFAULT_PACKET: PacketInfo = {
  operation: "状態確認",
  protocol: "TCP",
  srcIp: "192.168.1.50",
  srcPort: 52499,
  dstIp: "192.168.1.10",
  dstPort: 8080,
  xdpAction: "XDP_PASS",
};

// ──────────────────────────────────────────────────────────
// SVG: Ship silhouette
// ──────────────────────────────────────────────────────────
function ShipIcon({ loaded }: { loaded: boolean }) {
  return (
    <svg viewBox="0 0 220 72" fill="none" style={{ width: "100%", height: "100%" }}>
      {/* Hull */}
      <path d="M10 44 Q16 57 28 60 L192 60 Q204 57 210 44 Z" fill="#1A3245" stroke="#789D99" strokeWidth="1.2" />
      {/* Main deck */}
      <rect x="26" y="37" width="168" height="7" fill="#152B3C" stroke="#789D99" strokeWidth="0.7" />
      {/* Superstructure/bridge */}
      <rect x="128" y="20" width="42" height="17" fill="#0F2030" stroke="#9CA8AD" strokeWidth="0.7" />
      {/* Bridge windows */}
      <rect x="133" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="143" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="153" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      {/* Funnel */}
      <rect x="160" y="8" width="8" height="13" rx="1" fill="#1A3245" stroke="#9CA8AD" strokeWidth="0.7" />
      <rect x="159" y="7" width="10" height="3" rx="0.5" fill="#9CA8AD" opacity="0.35" />
      {/* Mast */}
      <line x1="116" y1="8" x2="116" y2="37" stroke="#9CA8AD" strokeWidth="1" opacity="0.55" />
      <line x1="90" y1="14" x2="120" y2="9" stroke="#9CA8AD" strokeWidth="0.5" opacity="0.25" />
      {/* Cargo containers */}
      {loaded && (
        <>
          <rect x="32" y="28" width="26" height="9" rx="0.5" fill="#B89A6D" opacity="0.92" stroke="#0B2233" strokeWidth="0.6" />
          <rect x="62" y="28" width="26" height="9" rx="0.5" fill="#789D99" opacity="0.62" stroke="#0B2233" strokeWidth="0.6" />
          <rect x="92" y="28" width="26" height="9" rx="0.5" fill="#789D99" opacity="0.4" stroke="#0B2233" strokeWidth="0.6" />
        </>
      )}
      {/* Bow tip */}
      <path d="M210 44 L218 52 L210 60" fill="none" stroke="#789D99" strokeWidth="0.9" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// SVG: Left port (User Space)
// ──────────────────────────────────────────────────────────
function LeftPortSVG({ loading }: { loading: boolean }) {
  const windowOpacities = [0.12, 0.18, 0.08, 0.22, 0.10, 0.16, 0.14, 0.06, 0.20];
  return (
    <svg viewBox="0 0 160 240" fill="none" style={{ width: "100%", height: "100%" }}>
      {/* Terminal building */}
      <rect x="10" y="50" width="85" height="85" fill="#0D1E2A" stroke="#9CA8AD" strokeWidth="0.7" />
      {/* Windows */}
      {[0, 1, 2].flatMap(r =>
        [0, 1, 2].map(c => (
          <rect
            key={`w${r}${c}`}
            x={20 + c * 22} y={60 + r * 20}
            width="12" height="9"
            fill="#789D99"
            opacity={windowOpacities[r * 3 + c]}
          />
        ))
      )}
      {/* Door */}
      <rect x="40" y="115" width="18" height="20" fill="#0B2233" stroke="#789D99" strokeWidth="0.5" />
      {/* Crane vertical */}
      <line x1="115" y1="20" x2="115" y2="135" stroke="#9CA8AD" strokeWidth="1.5" />
      {/* Crane horizontal */}
      <line x1="55" y1="20" x2="120" y2="20" stroke="#9CA8AD" strokeWidth="1.5" />
      {/* Crane cable */}
      <line
        x1="82" y1="20" x2="82" y2={loading ? "95" : "62"}
        stroke="#9CA8AD" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.55"
        style={{ transition: "y2 0.5s" }}
      />
      {/* Crate on crane when loading */}
      {loading && (
        <rect x="74" y="93" width="16" height="11" fill="#B89A6D" opacity="0.82" stroke="#9CA8AD" strokeWidth="0.5" />
      )}
      {/* Dock platform */}
      <rect x="0" y="135" width="160" height="10" fill="#1A3245" stroke="#789D99" strokeWidth="0.6" />
      {/* Dock piles */}
      {[12, 35, 58, 81, 104, 127, 150].map(x => (
        <rect key={x} x={x} y={145} width="5" height="20" fill="#152B3C" stroke="#789D99" strokeWidth="0.4" />
      ))}
      {/* Water shimmer lines */}
      <line x1="0" y1="165" x2="160" y2="165" stroke="#789D99" strokeWidth="0.5" opacity="0.22" />
      <line x1="20" y1="174" x2="140" y2="174" stroke="#789D99" strokeWidth="0.3" opacity="0.1" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// SVG: Right port (Kernel Space / XDP)
// ──────────────────────────────────────────────────────────
function RightPortSVG({ scanning, captured }: { scanning: boolean; captured: boolean }) {
  const active = scanning || captured;
  return (
    <svg viewBox="0 0 160 240" fill="none" style={{ width: "100%", height: "100%" }}>
      {/* XDP monitoring station building */}
      <rect
        x="55" y="40" width="90" height="95"
        fill="#0D1E2A"
        stroke={captured ? "#9A6258" : "#9CA8AD"}
        strokeWidth={captured ? "1.2" : "0.7"}
      />
      {/* Monitor display panel */}
      <rect
        x="65" y="50" width="70" height="44"
        fill="#0B1F2E"
        stroke={active ? "#B89A6D" : "#789D99"}
        strokeWidth="0.9"
      />
      {/* Scan lines */}
      {active && [0, 1, 2, 3].map(i => (
        <line
          key={i}
          x1="68" y1={58 + i * 10}
          x2="132" y2={58 + i * 10}
          stroke={captured ? "#9A6258" : "#B89A6D"}
          strokeWidth="0.8"
          opacity={0.9 - i * 0.2}
        />
      ))}
      {/* XDP label */}
      <text x="100" y="107" fontSize="9" fill="#9CA8AD" textAnchor="middle" fontFamily="monospace" letterSpacing="3">XDP</text>
      {/* Gate post */}
      <rect x="0" y="108" width="8" height="27" fill="#1E3A4F" stroke="#9CA8AD" strokeWidth="0.7" />
      {/* Gate boom arm */}
      <line
        x1="8" y1="114" x2="53" y2="114"
        stroke={captured ? "#9A6258" : "#9CA8AD"}
        strokeWidth={captured ? "2.2" : "1.4"}
      />
      {/* Antenna tower */}
      <line x1="134" y1="10" x2="134" y2="40" stroke="#9CA8AD" strokeWidth="1" />
      <line x1="127" y1="17" x2="141" y2="17" stroke="#9CA8AD" strokeWidth="0.7" />
      <line x1="130" y1="13" x2="138" y2="13" stroke="#9CA8AD" strokeWidth="0.5" />
      <circle cx="134" cy="10" r="2.5" fill="none" stroke={active ? "#B89A6D" : "#9CA8AD"} strokeWidth="0.9" />
      {/* Signal rings when active */}
      {scanning && (
        <>
          <circle cx="134" cy="10" r="7" fill="none" stroke="#B89A6D" strokeWidth="0.5" opacity="0.45" />
          <circle cx="134" cy="10" r="12" fill="none" stroke="#B89A6D" strokeWidth="0.4" opacity="0.22" />
        </>
      )}
      {/* Dock platform */}
      <rect x="0" y="135" width="160" height="10" fill="#1A3245" stroke="#789D99" strokeWidth="0.6" />
      {/* Dock piles */}
      {[12, 35, 58, 81, 104, 127, 150].map(x => (
        <rect key={x} x={x} y={145} width="5" height="20" fill="#152B3C" stroke="#789D99" strokeWidth="0.4" />
      ))}
      {/* Water shimmer */}
      <line x1="0" y1="165" x2="160" y2="165" stroke="#789D99" strokeWidth="0.5" opacity="0.22" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────
// Protocol info label (fades in during voyage)
// ──────────────────────────────────────────────────────────
function ProtocolLabel({ show, label, value, sub }: { show: boolean; label: string; value: string; sub: string }) {
  return (
    <div style={{
      opacity: show ? 1 : 0,
      transform: show ? "translateY(0)" : "translateY(10px)",
      transition: "opacity 0.85s, transform 0.85s",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "5px" }}>
        {label}
      </div>
      <div style={{ fontSize: "14px", fontFamily: "'Inter', monospace", color: "#F1EFE8", letterSpacing: "0.04em" }}>
        {value}
      </div>
      <div style={{ fontSize: "9px", color: "#9CA8AD", opacity: 0.55, marginTop: "4px", letterSpacing: "0.1em" }}>
        {sub}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Voyage log entry
// ──────────────────────────────────────────────────────────
function LogEntry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "5px" }}>
        {label}
      </div>
      <div style={{ fontSize: "12px", fontFamily: "'Inter', monospace", color: "#F1EFE8" }}>
        {value}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// OSI layer stack diagram
// ──────────────────────────────────────────────────────────
function OsiStack() {
  const layers = [
    { label: "L7", name: "Application", note: "ユーザー操作", active: true, color: "#B89A6D" },
    { label: "L4", name: "Transport", note: "TCP / UDP", active: true, color: "#789D99" },
    { label: "L3", name: "Network", note: "IP Routing", active: true, color: "#789D99" },
    { label: "L2", name: "Data Link", note: "XDP 観測点", active: true, color: "#9A6258" },
  ];
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {layers.map((l, i) => (
        <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            padding: "3px 8px",
            border: `1px solid ${l.color}`,
            opacity: l.active ? 1 : 0.3,
          }}>
            <div style={{ fontSize: "9px", fontFamily: "monospace", color: l.color, letterSpacing: "0.1em" }}>{l.label}</div>
            <div style={{ fontSize: "10px", color: "#F1EFE8", marginTop: "1px" }}>{l.name}</div>
            <div style={{ fontSize: "9px", color: "#9CA8AD", marginTop: "1px" }}>{l.note}</div>
          </div>
          {i < layers.length - 1 && (
            <div style={{ color: "#9CA8AD", fontSize: "10px", opacity: 0.4 }}>→</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [packet, setPacket] = useState<PacketInfo>(DEFAULT_PACKET);
  const [showProto, setShowProto] = useState(false);
  const [showSrc, setShowSrc] = useState(false);
  const [showDst, setShowDst] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState("waiting");
  const [pps, setPps] = useState(0);
  const [total, setTotal] = useState(0);
  const [capturedAt, setCapturedAt] = useState("—");
  const phaseRef = useRef<Phase>("idle");
  const timersRef = useRef<number[]>([]);

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearJourneyTimers = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
  }, []);

  const startJourney = useCallback((operation = "操作") => {
    clearJourneyTimers();
    setPacket(current => ({ ...current, operation }));
    setShowProto(false);
    setShowSrc(false);
    setShowDst(false);
    setLogOpen(false);
    setCapturedAt("—");
    updatePhase("loading");

    const schedule = (delay: number, action: () => void) => {
      timersRef.current.push(window.setTimeout(action, delay));
    };
    schedule(1100, () => updatePhase("sailing"));
    schedule(2000, () => setShowProto(true));
    schedule(3200, () => setShowSrc(true));
    schedule(4400, () => setShowDst(true));
    schedule(6300, () => updatePhase("arrived"));
    schedule(7000, () => {
      setCapturedAt(new Date().toLocaleTimeString("ja-JP"));
      updatePhase("captured");
    });
  }, [clearJourneyTimers, updatePhase]);

  const handleEvent = useCallback((event: PacketEvent) => {
    if (event.type === "stats") {
      setPps(Number(event.pps ?? 0));
      setTotal(Number(event.total ?? 0));
      return;
    }
    if (event.type === "physical_action") {
      startJourney(event.label ?? "操作");
      return;
    }
    if (event.type === "action_correlated") {
      setPacket(current => ({
        ...current,
        operation: event.label ?? current.operation,
        protocol: event.protocol ?? current.protocol,
        srcIp: event.src ?? current.srcIp,
        srcPort: Number(event.src_port ?? current.srcPort),
        dstIp: event.dst ?? current.dstIp,
        dstPort: Number(event.dst_port ?? current.dstPort),
        xdpAction: "XDP_PASS",
      }));
      if (phaseRef.current === "idle" || phaseRef.current === "captured") {
        startJourney(event.label ?? "操作");
      }
    }
  }, [startJourney]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: undefined | (() => void);

    void subscribeStream({
      onStatus: status => !disposed && setStreamStatus(status),
      onEvent: event => !disposed && handleEvent(event as PacketEvent),
    }).then(subscription => {
      if (disposed) {
        subscription.unsubscribe();
        return;
      }
      unsubscribe = subscription.unsubscribe;
      if (subscription.mode === "web") setStreamStatus("demo");
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      clearJourneyTimers();
    };
  }, [clearJourneyTimers, handleEvent]);

  const isLoaded = phase !== "idle";
  const isSailing = ["sailing", "arrived", "captured"].includes(phase);
  const isCaptured = phase === "captured";
  const isLoading = phase === "loading";
  const isArriving = phase === "arrived";

  function launch() {
    if (phaseRef.current !== "idle") return;
    startJourney("状態確認");
    if (isWebDemo()) {
      window.setTimeout(() => handleEvent({
        type: "action_correlated",
        label: "状態確認",
        protocol: "TCP",
        src: "192.168.1.50",
        src_port: 52000 + Math.floor(Math.random() * 800),
        dst: "192.168.1.10",
        dst_port: 8080,
      }), 250);
    }
  }

  function reset() {
    clearJourneyTimers();
    updatePhase("idle");
    setShowProto(false);
    setShowSrc(false);
    setShowDst(false);
    setLogOpen(false);
  }

  const shipStyle: CSSProperties = {
    position: "absolute",
    width: "220px",
    height: "72px",
    bottom: "28%",
    left: isSailing ? "calc(89% - 110px)" : "calc(11% - 110px)",
    transition: isSailing ? "left 5200ms cubic-bezier(0.3, 0.05, 0.45, 1)" : "none",
    zIndex: 10,
  };

  const statusText = {
    idle: "STANDBY",
    loading: "LOADING CARGO",
    sailing: "IN TRANSIT",
    arrived: "DOCKING",
    captured: "XDP · PASS",
  }[phase];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      overflow: "hidden",
      background: "#0B2233",
      color: "#F1EFE8",
      fontFamily: "'Noto Sans JP', 'Inter', sans-serif",
    }}>

      {/* ━━━━━ HEADER ━━━━━ */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 36px",
        height: "52px",
        flexShrink: 0,
        borderBottom: "1px solid rgba(120,157,153,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Globe-like logo mark */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="8" stroke="#789D99" strokeWidth="0.7" />
            <path d="M1.5 9 Q9 4 16.5 9" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <path d="M1.5 9 Q9 14 16.5 9" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <line x1="9" y1="1" x2="9" y2="17" stroke="#789D99" strokeWidth="0.4" />
          </svg>
          <span style={{ fontSize: "10px", letterSpacing: "0.24em", color: "#9CA8AD", textTransform: "uppercase" }}>
            Packet Journey
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#789D99", letterSpacing: "0.08em" }}>
            {streamStatus.toUpperCase()} · {pps} PPS · {total} TOTAL
          </span>
          <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.5, letterSpacing: "0.12em" }}>
            {statusText}
          </span>
          {phase !== "idle" && (
            <button
              onClick={reset}
              style={{
                fontSize: "10px",
                letterSpacing: "0.18em",
                color: "#9CA8AD",
                textTransform: "uppercase",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                transition: "color 0.2s",
                fontFamily: "inherit",
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#F1EFE8")}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#9CA8AD")}
            >
              Reset
            </button>
          )}
        </div>
      </header>

      {/* ━━━━━ MAIN SCENE ━━━━━ */}
      <main style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "22% 56% 22%",
        position: "relative",
        minHeight: 0,
        overflow: "hidden",
      }}>

        {/* ── Left Port: User Space ── */}
        <div style={{ position: "relative", overflow: "hidden", borderRight: "1px solid rgba(120,157,153,0.12)" }}>
          {/* Zone label */}
          <div style={{ position: "absolute", top: "28px", left: "20px", zIndex: 10 }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.26em", color: "#9CA8AD", textTransform: "uppercase" }}>
              User Space
            </div>
            <div style={{ fontSize: "11px", color: "#789D99", fontWeight: 300, marginTop: "4px" }}>
              Port of Origin
            </div>
          </div>

          {/* Port SVG */}
          <div style={{ position: "absolute", inset: 0, top: "18%" }}>
            <LeftPortSVG loading={isLoading} />
          </div>

          {/* Cargo indicator */}
          <div style={{
            position: "absolute",
            bottom: "30%",
            left: "18px",
            right: "18px",
            zIndex: 10,
            opacity: isLoaded ? 1 : 0,
            transform: isLoaded ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.7s, transform 0.7s",
          }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#B89A6D", textTransform: "uppercase", marginBottom: "4px" }}>
              Cargo
            </div>
            <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#F1EFE8" }}>
              &ldquo;{packet.operation}&rdquo;
            </div>
          </div>

          {/* OSI label */}
          <div style={{
            position: "absolute",
            bottom: "12%",
            left: "18px",
            fontSize: "9px",
            letterSpacing: "0.2em",
            color: "rgba(156,168,173,0.3)",
            textTransform: "uppercase",
          }}>
            L7 — Application
          </div>
        </div>

        {/* ── Center: Network Sea ── */}
        <div style={{ position: "relative", overflow: "hidden" }}>

          {/* Wave texture */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.04 }} preserveAspectRatio="none">
            <defs>
              <pattern id="wv" x="0" y="0" width="100" height="24" patternUnits="userSpaceOnUse">
                <path d="M0 12 Q25 4 50 12 Q75 20 100 12" stroke="#789D99" strokeWidth="1" fill="none" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#wv)" />
          </svg>

          {/* Waterline */}
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: "28%",
            height: "1px", background: "#789D99", opacity: 0.18,
          }} />

          {/* Animated route line */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4 }}>
            <line
              x1="2%" y1="72%"
              x2="98%" y2="72%"
              stroke="#789D99"
              strokeWidth="0.9"
              strokeDasharray="2000"
              strokeDashoffset={isSailing ? "0" : "2000"}
              opacity="0.4"
              style={{
                transition: isSailing ? "stroke-dashoffset 5200ms linear" : "stroke-dashoffset 0ms",
              }}
            />
          </svg>

          {/* Zone label (appears after departure) */}
          <div style={{
            position: "absolute", top: "28px", left: "50%",
            transform: "translateX(-50%)", textAlign: "center",
            opacity: phase !== "idle" ? 1 : 0,
            transition: "opacity 0.9s",
            zIndex: 10, whiteSpace: "nowrap",
          }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.26em", color: "#9CA8AD", textTransform: "uppercase" }}>
              Network Sea
            </div>
            <div style={{ fontSize: "11px", color: "#789D99", fontWeight: 300, marginTop: "4px" }}>
              L3 — Internet Protocol
            </div>
          </div>

          {/* ── INTRO TEXT (idle state) ── */}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            opacity: phase === "idle" ? 1 : 0,
            transition: "opacity 0.9s",
            pointerEvents: phase === "idle" ? "auto" : "none",
            zIndex: 20, padding: "0 40px",
          }}>
            <h1 style={{
              fontFamily: "'Noto Serif JP', serif",
              fontSize: "clamp(22px, 2.4vw, 36px)",
              fontWeight: 300,
              color: "#F1EFE8",
              letterSpacing: "0.04em",
              lineHeight: 1.8,
              textAlign: "center",
              marginBottom: "28px",
            }}>
              見えない通信は、<br />旅をしている。
            </h1>
            <p style={{
              fontSize: "12px",
              color: "#9CA8AD",
              fontWeight: 300,
              lineHeight: 2,
              textAlign: "center",
              marginBottom: "44px",
              maxWidth: "320px",
            }}>
              ボタンを押すと、小さなデータの荷物が生まれます。
              その荷物が通信の海を渡り、カーネルの入口で
              見つかるまでを追いかけます。
            </p>
            <button
              onClick={launch}
              style={{
                border: "1px solid #789D99",
                padding: "14px 44px",
                color: "#F1EFE8",
                fontSize: "13px",
                letterSpacing: "0.14em",
                background: "transparent",
                cursor: "pointer",
                transition: "border-color 0.3s, color 0.3s",
                outline: "none",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "#B89A6D";
                e.currentTarget.style.color = "#B89A6D";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "#789D99";
                e.currentTarget.style.color = "#F1EFE8";
              }}
            >
              船を出す
            </button>
          </div>

          {/* ── PROTOCOL LABELS (sailing state) ── */}
          <div style={{
            position: "absolute", top: "10%", left: 0, right: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", gap: "20px",
            zIndex: 15, padding: "0 20px",
            pointerEvents: "none",
          }}>
            <ProtocolLabel
              show={showProto}
              label="Protocol"
              value={packet.protocol}
              sub="Transport Layer · L4"
            />
            <ProtocolLabel
              show={showSrc}
              label="Source"
              value={`${packet.srcIp} : ${packet.srcPort}`}
              sub="origin address"
            />
            <ProtocolLabel
              show={showDst}
              label="Destination"
              value={`${packet.dstIp} : ${packet.dstPort}`}
              sub="destination address"
            />
          </div>
        </div>

        {/* ── Right Port: Kernel Space ── */}
        <div style={{ position: "relative", overflow: "hidden", borderLeft: "1px solid rgba(120,157,153,0.12)" }}>
          {/* Zone label */}
          <div style={{ position: "absolute", top: "28px", right: "20px", zIndex: 10, textAlign: "right" }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.26em", color: "#9CA8AD", textTransform: "uppercase" }}>
              Kernel Space
            </div>
            <div style={{ fontSize: "11px", color: "#789D99", fontWeight: 300, marginTop: "4px" }}>
              Port of Arrival
            </div>
          </div>

          {/* Port SVG */}
          <div style={{ position: "absolute", inset: 0, top: "18%" }}>
            <RightPortSVG scanning={isArriving} captured={isCaptured} />
          </div>

          {/* XDP Capture result panel */}
          <div style={{
            position: "absolute",
            top: "26%", left: "14px", right: "14px",
            zIndex: 20,
            opacity: isCaptured ? 1 : 0,
            transform: isCaptured ? "translateY(0)" : "translateY(-12px)",
            transition: "opacity 0.7s, transform 0.7s",
          }}>
            <div style={{
              border: "1px solid rgba(154,98,88,0.65)",
              padding: "13px 15px",
              background: "rgba(154,98,88,0.07)",
            }}>
              <div style={{
                fontSize: "9px", letterSpacing: "0.24em",
                color: "#9A6258", textTransform: "uppercase", marginBottom: "5px",
              }}>
                XDP Observer
              </div>
              <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#F1EFE8", letterSpacing: "0.1em" }}>
                PACKET CAPTURED
              </div>
              <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#B89A6D", marginTop: "5px" }}>
                {packet.xdpAction}
              </div>
            </div>
          </div>

          {/* "Your operation became this packet" */}
          <div style={{
            position: "absolute",
            bottom: "32%", left: "14px", right: "14px",
            textAlign: "center", zIndex: 20,
            opacity: isCaptured ? 1 : 0,
            transition: "opacity 1.2s 0.7s",
          }}>
            <p style={{
              fontFamily: "'Noto Serif JP', serif",
              fontSize: "11px",
              color: "#9CA8AD",
              lineHeight: 2,
              fontWeight: 300,
            }}>
              あなたの操作が、<br />このパケットに<br />なりました
            </p>
          </div>

          {/* OSI label */}
          <div style={{
            position: "absolute",
            bottom: "12%", right: "18px",
            fontSize: "9px", letterSpacing: "0.2em",
            color: "rgba(156,168,173,0.3)", textTransform: "uppercase",
            textAlign: "right",
          }}>
            L2 — Data Link
          </div>
        </div>

        {/* ━━ SHIP — travels across the full scene ━━ */}
        <div style={shipStyle}>
          <ShipIcon loaded={isLoaded} />
        </div>
      </main>

      {/* ━━━━━ VOYAGE LOG ━━━━━ */}
      <div style={{ background: "#0D1E2A", borderTop: "1px solid rgba(120,157,153,0.15)", flexShrink: 0 }}>
        <button
          onClick={() => isCaptured && setLogOpen(o => !o)}
          style={{
            width: "100%",
            height: "48px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 36px",
            background: "transparent",
            border: "none",
            cursor: isCaptured ? "pointer" : "default",
            color: "inherit",
            fontFamily: "inherit",
            transition: "background 0.2s",
          }}
          onMouseEnter={e => { if (isCaptured) e.currentTarget.style.background = "rgba(120,157,153,0.05)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={{ fontSize: "9px", letterSpacing: "0.26em", color: "#9CA8AD", textTransform: "uppercase" }}>
              Voyage Log
            </span>
            {isCaptured && (
              <span style={{ fontSize: "9px", color: "#B89A6D", letterSpacing: "0.1em" }}>
                — record available
              </span>
            )}
          </div>
          {isCaptured && (
            logOpen
              ? <span aria-hidden="true">⌄</span>
              : <span aria-hidden="true">⌃</span>
          )}
        </button>

        <div style={{
          maxHeight: logOpen ? "280px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}>
          <div style={{ padding: "20px 36px 32px", borderTop: "1px solid rgba(120,157,153,0.1)" }}>
            {/* Grid entries */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "20px 32px",
              marginBottom: "24px",
            }}>
              <LogEntry label="Operation" value={packet.operation} />
              <LogEntry label="Protocol" value={`${packet.protocol} / IP`} />
              <LogEntry label="Source" value={`${packet.srcIp}:${packet.srcPort}`} />
              <LogEntry label="Destination" value={`${packet.dstIp}:${packet.dstPort}`} />
              <LogEntry label="XDP Result" value={packet.xdpAction} />
              <LogEntry label="Hook" value="XDP ingress" />
              <LogEntry label="Observed at" value="Kernel boundary" />
              <LogEntry label="Timestamp" value={capturedAt} />
            </div>
            {/* OSI layer diagram */}
            <div style={{ borderTop: "1px solid rgba(120,157,153,0.1)", paddingTop: "16px" }}>
              <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "10px" }}>
                OSI Layer Mapping
              </div>
              <OsiStack />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
