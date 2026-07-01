// Packet Journey — Full Redesign
// Two-way communication visualised as a ship voyage with OSI 7-layer traversal

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Play, Pause, SkipForward, SkipBack, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { isWebDemo, subscribeStream } from "../stream.js";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Phase =
  | "idle" | "req-gen" | "req-sail" | "xdp"
  | "srv-recv" | "srv-proc" | "resp-gen"
  | "resp-sail" | "cli-recv" | "complete";

type XdpState = "none" | "checking" | "passed";

interface PacketInfo {
  operation: string;
  protocol: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  xdpAction: string;
}

interface PacketEvent {
  type?: string;
  label?: string;
  protocol?: string;
  src?: string;
  src_port?: number;
  dst?: string;
  dst_port?: number;
  pps?: number;
  total?: number;
}

interface Frame {
  id: string;
  labelJa: string;
  phase: Phase;
  cLayer: number | null; // 0=L7, 6=L1
  sLayer: number | null;
  cDir: "down" | "up" | null;
  sDir: "down" | "up" | null;
  ship: "none" | "req" | "resp";
  xdp: XdpState;
  srvProc: boolean;
  respReady: boolean;
  cliDone: boolean;
  dur: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const OSI = [
  { lbl: "L7", name: "Application",  ja: "アプリケーション" },
  { lbl: "L6", name: "Presentation", ja: "プレゼンテーション" },
  { lbl: "L5", name: "Session",      ja: "セッション" },
  { lbl: "L4", name: "Transport",    ja: "トランスポート" },
  { lbl: "L3", name: "Network",      ja: "ネットワーク" },
  { lbl: "L2", name: "Data Link",    ja: "データリンク" },
  { lbl: "L1", name: "Physical",     ja: "物理" },
];

const DEFAULT_PACKET: PacketInfo = {
  operation: "状態確認",
  protocol: "TCP",
  srcIp: "192.168.1.50",
  srcPort: 52499,
  dstIp: "192.168.1.10",
  dstPort: 8080,
  xdpAction: "XDP_PASS",
};

// Layer action messages [L7..L1] for each direction
const M: Record<string, string[]> = {
  creq:  ["「状態確認」を生成", "データ形式を整える ※", "セッションを管理 ※",
          "TCP :52499 → :8080", "192.168.1.50 → .1.10", "Ethernet フレーム化", "電気信号として送出"],
  srecv: ["「状態確認」を処理", "データ形式を解析 ※",  "セッションを管理 ※",
          "TCP セグメント解析", "IP パケット解析",       "Ethernet 解析 + XDP済", "信号を受信"],
  sresp: ["「200 OK」を生成",   "データ形式を整える ※", "セッションを管理 ※",
          "TCP :8080 → :52499", "192.168.1.10 → .50",  "Ethernet フレーム化",  "電気信号として送出"],
  crecv: ["「200 OK」を受信",   "データ形式を解析 ※",  "セッションを管理 ※",
          "TCP セグメント解析", "IP パケット解析",       "Ethernet 解析",        "信号を受信"],
};

const NOTE56 = "※ TCP/IPでは多くの場合アプリ/ライブラリが担当";

function fr(
  id: string, labelJa: string, phase: Phase,
  cL: number | null, sL: number | null,
  cD: "down"|"up"|null, sD: "down"|"up"|null,
  ship: "none"|"req"|"resp", xdp: XdpState,
  srvProc: boolean, respReady: boolean, cliDone: boolean,
  dur: number
): Frame {
  return { id, labelJa, phase, cLayer: cL, sLayer: sL, cDir: cD, sDir: sD, ship, xdp, srvProc, respReady, cliDone, dur };
}

const FRAMES: Frame[] = [
  fr("idle",     "待機中",               "idle",     null,null, null,null,   "none","none", false,false,false, 0),
  fr("req-l7",   "L7：リクエスト生成",   "req-gen",  0,   null, "down",null, "none","none", false,false,false, 640),
  fr("req-l6",   "L6：データ形式",       "req-gen",  1,   null, "down",null, "none","none", false,false,false, 560),
  fr("req-l5",   "L5：セッション",       "req-gen",  2,   null, "down",null, "none","none", false,false,false, 560),
  fr("req-l4",   "L4：TCP追加",          "req-gen",  3,   null, "down",null, "none","none", false,false,false, 560),
  fr("req-l3",   "L3：IP追加",           "req-gen",  4,   null, "down",null, "none","none", false,false,false, 560),
  fr("req-l2",   "L2：Ethernet化",       "req-gen",  5,   null, "down",null, "none","none", false,false,false, 560),
  fr("req-l1",   "L1：電気信号送出",     "req-gen",  6,   null, "down",null, "none","none", false,false,false, 640),
  fr("req-sail", "リクエスト航行中",     "req-sail", null,null, null,null,   "req","none",  false,false,false, 4700),
  fr("xdp-chk",  "XDP検査中...",         "xdp",      null,5,    null,null,   "req","checking",false,false,false, 950),
  fr("xdp-pass", "XDP_PASS 観測完了",    "xdp",      null,5,    null,null,   "req","passed",  false,false,false, 1700),
  fr("srv-l1",   "サーバー L1：受信",    "srv-recv", null,6,    null,"up",   "req","passed",  false,false,false, 530),
  fr("srv-l2",   "サーバー L2：解析",    "srv-recv", null,5,    null,"up",   "req","passed",  false,false,false, 530),
  fr("srv-l3",   "サーバー L3：解析",    "srv-recv", null,4,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l4",   "サーバー L4：解析",    "srv-recv", null,3,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l5",   "サーバー L5",          "srv-recv", null,2,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l6",   "サーバー L6：解析",    "srv-recv", null,1,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l7",   "サーバー L7：受信完了","srv-recv", null,0,    null,"up",   "none","passed", false,false,false, 720),
  fr("srv-proc", "サーバー処理中",       "srv-proc", null,0,    null,null,   "none","none",   true,false,false,  2400),
  fr("resp-l7",  "L7：レスポンス生成",   "resp-gen", null,0,    null,"down", "resp","none",   false,true,false,  580),
  fr("resp-l6",  "L6：データ形式",       "resp-gen", null,1,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l5",  "L5：セッション",       "resp-gen", null,2,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l4",  "L4：TCP追加",          "resp-gen", null,3,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l3",  "L3：IP追加",           "resp-gen", null,4,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l2",  "L2：Ethernet化",       "resp-gen", null,5,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l1",  "L1：電気信号送出",     "resp-gen", null,6,    null,"down", "resp","none",   false,true,false,  600),
  fr("resp-sail","レスポンス航行中",     "resp-sail",null,null, null,null,   "resp","none",   false,true,false,  4700),
  fr("cli-l1",   "クライアント L1：受信","cli-recv", 6,   null, "up",null,   "resp","none",   false,true,false,  530),
  fr("cli-l2",   "クライアント L2：解析","cli-recv", 5,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l3",   "クライアント L3：解析","cli-recv", 4,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l4",   "クライアント L4：解析","cli-recv", 3,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l5",   "クライアント L5",      "cli-recv", 2,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l6",   "クライアント L6：解析","cli-recv", 1,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l7",   "クライアント L7：受信完了","cli-recv",0,null, "up",null,   "none","none",   false,true,true,   800),
  fr("complete", "通信の往復が完了",     "complete", null,null, null,null,   "none","none",   false,true,true,   0),
];

const REQ_SAIL_IDX  = FRAMES.findIndex(f => f.id === "req-sail");
const RESP_SAIL_IDX = FRAMES.findIndex(f => f.id === "resp-sail");

// ─────────────────────────────────────────────────────────────────────────────
// SHIP SVG
// ─────────────────────────────────────────────────────────────────────────────

function ShipSVG({ loaded, flip }: { loaded: boolean; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 220 72"
      fill="none"
      style={{ width: "100%", height: "100%", transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path d="M10 44 Q16 57 28 60 L192 60 Q204 57 210 44 Z" fill="#1A3245" stroke="#789D99" strokeWidth="1.1" />
      <rect x="26" y="37" width="168" height="7" fill="#152B3C" stroke="#789D99" strokeWidth="0.7" />
      <rect x="128" y="20" width="42" height="17" fill="#0F2030" stroke="#9CA8AD" strokeWidth="0.7" />
      <rect x="133" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="143" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="153" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="160" y="8" width="8" height="13" rx="1" fill="#1A3245" stroke="#9CA8AD" strokeWidth="0.7" />
      <rect x="159" y="7" width="10" height="3" rx="0.5" fill="#9CA8AD" opacity="0.35" />
      <line x1="116" y1="8" x2="116" y2="37" stroke="#9CA8AD" strokeWidth="1" opacity="0.55" />
      <line x1="90" y1="14" x2="120" y2="9" stroke="#9CA8AD" strokeWidth="0.5" opacity="0.25" />
      {loaded && (
        <>
          <rect x="32" y="28" width="24" height="9" rx="0.5" fill="#B89A6D" opacity="0.92" stroke="#0B2233" strokeWidth="0.6" />
          <rect x="60" y="28" width="24" height="9" rx="0.5" fill="#789D99" opacity="0.60" stroke="#0B2233" strokeWidth="0.6" />
          <rect x="88" y="28" width="24" height="9" rx="0.5" fill="#789D99" opacity="0.40" stroke="#0B2233" strokeWidth="0.6" />
        </>
      )}
      <path d="M210 44 L218 52 L210 60" fill="none" stroke="#789D99" strokeWidth="0.9" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OSI LAYER ROW
// ─────────────────────────────────────────────────────────────────────────────

function OsiRow({
  idx, active, dir, msg, isXdp, xdpState, isServer,
}: {
  idx: number;
  active: boolean;
  dir: "down" | "up" | null;
  msg: string | null;
  isXdp: boolean;
  xdpState: XdpState;
  isServer: boolean;
}) {
  const layer = OSI[idx];
  const isXdpActive = isXdp && (xdpState === "checking" || xdpState === "passed");
  const accentColor = isXdpActive
    ? "#9A6258"
    : active && dir === "down"
    ? "#B89A6D"
    : active && dir === "up"
    ? "#789D99"
    : "transparent";

  const bgAlpha = active || isXdpActive ? "0.07" : "0";
  const textOpacity = active ? 1 : 0.38;
  const note56 = (idx === 1 || idx === 2) && msg?.includes("※");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid rgba(120,157,153,0.1)",
        background: `rgba(${isXdpActive ? "154,98,88" : active && dir === "down" ? "184,154,109" : "120,157,153"},${bgAlpha})`,
        transition: "background 0.4s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left accent bar */}
      <div style={{
        width: "3px", flexShrink: 0,
        background: accentColor,
        transition: "background 0.35s",
      }} />

      {/* Layer info */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 10px 0 8px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: active ? "3px" : 0 }}>
          <span style={{
            fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.06em",
            color: active || isXdpActive ? accentColor : "#789D99",
            transition: "color 0.35s", flexShrink: 0,
          }}>
            {layer.lbl}
          </span>
          <span style={{
            fontSize: "10px", color: "#F1EFE8", opacity: textOpacity,
            transition: "opacity 0.35s", fontWeight: 300, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {layer.name}
          </span>
          {/* XDP badge at server L2 */}
          {isXdp && (
            <span style={{
              fontSize: "7px", letterSpacing: "0.15em", padding: "1px 4px",
              border: `1px solid ${isXdpActive ? "#9A6258" : "rgba(120,157,153,0.3)"}`,
              color: isXdpActive ? "#9A6258" : "rgba(120,157,153,0.4)",
              transition: "color 0.35s, border-color 0.35s", flexShrink: 0,
            }}>
              XDP
            </span>
          )}
        </div>

        {/* Action message */}
        {(active || isXdpActive) && (
          <div style={{
            fontSize: "10px", fontFamily: "monospace",
            color: isXdpActive ? "#9A6258" : dir === "down" ? "#B89A6D" : "#789D99",
            opacity: 0.9, letterSpacing: "0.03em",
            animation: "fadeSlide 0.4s ease",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {isXdpActive
              ? xdpState === "checking" ? "PACKET OBSERVED..." : "XDP_PASS →"
              : msg}
          </div>
        )}
        {note56 && active && (
          <div style={{ fontSize: "8px", color: "#9CA8AD", opacity: 0.5, marginTop: "1px", letterSpacing: "0.04em" }}>
            {NOTE56}
          </div>
        )}
      </div>

      {/* Direction arrow */}
      {active && dir && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "22px", flexShrink: 0,
          color: dir === "down" ? "#B89A6D" : "#789D99",
          fontSize: "14px", opacity: 0.8,
        }}>
          {dir === "down" ? "↓" : "↑"}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PORT COLUMN
// ─────────────────────────────────────────────────────────────────────────────

function PortColumn({
  side, frame, packet, srvProc, respReady, cliDone,
}: {
  side: "client" | "server";
  frame: Frame;
  packet: PacketInfo;
  srvProc: boolean;
  respReady: boolean;
  cliDone: boolean;
}) {
  const isClient = side === "client";
  const activeLayer = isClient ? frame.cLayer : frame.sLayer;
  const dir = isClient ? frame.cDir : frame.sDir;
  const xdp = frame.xdp;
  const phase = frame.phase;

  function getMsg(idx: number): string | null {
    if (idx === 3) {
      if (phase === "req-gen") return `${packet.protocol} :${packet.srcPort} → :${packet.dstPort}`;
      if (phase === "srv-recv") return `${packet.protocol} セグメント解析`;
      if (phase === "resp-gen") return `${packet.protocol} :${packet.dstPort} → :${packet.srcPort}`;
      if (phase === "cli-recv") return `${packet.protocol} セグメント解析`;
    }
    if (idx === 4) {
      if (phase === "req-gen") return `${packet.srcIp} → ${packet.dstIp}`;
      if (phase === "srv-recv" || phase === "cli-recv") return "IP パケット解析";
      if (phase === "resp-gen") return `${packet.dstIp} → ${packet.srcIp}`;
    }
    if (isClient) {
      if (phase === "req-gen") return M.creq[idx];
      if (phase === "cli-recv") return M.crecv[idx];
    } else {
      if (phase === "srv-recv") return M.srecv[idx];
      if (phase === "resp-gen") return M.sresp[idx];
    }
    return null;
  }

  const showSrvProcess = !isClient && srvProc;
  const showRespReady = !isClient && respReady && phase !== "resp-gen" && phase !== "resp-sail" && phase !== "cli-recv" && phase !== "complete";
  const showClientDone = isClient && cliDone;

  // IP address
  const ipAddr = isClient ? packet.srcIp : packet.dstIp;
  const role = isClient ? "CLIENT PORT" : "SERVER PORT";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      borderRight: isClient ? "1px solid rgba(120,157,153,0.12)" : undefined,
      borderLeft: !isClient ? "1px solid rgba(120,157,153,0.12)" : undefined,
      position: "relative",
    }}>
      {/* Zone header */}
      <div style={{
        flexShrink: 0, height: "46px",
        borderBottom: "1px solid rgba(120,157,153,0.12)",
        display: "flex", alignItems: "center",
        padding: isClient ? "0 12px 0 14px" : "0 14px 0 12px",
        justifyContent: isClient ? "flex-start" : "flex-end",
        gap: "8px",
      }}>
        <span style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase" }}>
          {role}
        </span>
        <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#789D99", opacity: 0.65 }}>
          {ipAddr}
        </span>
      </div>

      {/* OSI layer stack */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {OSI.map((_, idx) => (
          <OsiRow
            key={idx}
            idx={idx}
            active={activeLayer === idx}
            dir={dir}
            msg={getMsg(idx)}
            isXdp={!isClient && idx === 5}
            xdpState={xdp}
            isServer={!isClient}
          />
        ))}
      </div>

      {/* Server status panel */}
      {!isClient && (
        <div style={{
          flexShrink: 0,
          padding: "8px 12px",
          borderTop: "1px solid rgba(120,157,153,0.1)",
          minHeight: "42px",
          display: "flex", alignItems: "center",
        }}>
          {showSrvProcess && (
            <div style={{ opacity: 1, transition: "opacity 0.5s" }}>
              <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "2px" }}>
                Processing
              </div>
              <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#F1EFE8" }}>
                状態確認を処理しました
              </div>
            </div>
          )}
          {respReady && phase === "srv-proc" && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#B89A6D", textTransform: "uppercase", marginBottom: "2px" }}>
                Response Ready
              </div>
              <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#F1EFE8" }}>
                200 OK
              </div>
            </div>
          )}
        </div>
      )}

      {/* Client completion */}
      {isClient && (
        <div style={{
          flexShrink: 0, padding: "8px 12px",
          borderTop: "1px solid rgba(120,157,153,0.1)",
          minHeight: "42px",
          display: "flex", alignItems: "center",
        }}>
          {showClientDone && (
            <div>
              <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#789D99", textTransform: "uppercase", marginBottom: "2px" }}>
                Received
              </div>
              <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#F1EFE8" }}>
                200 OK — 正常です
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEA CENTER
// ─────────────────────────────────────────────────────────────────────────────

function SeaCenter({
  frame, packet, webDemo, onLaunch, reqShipRight, respShipLeft,
}: {
  frame: Frame;
  packet: PacketInfo;
  webDemo: boolean;
  onLaunch: () => void;
  reqShipRight: boolean;
  respShipLeft: boolean;
}) {
  const { phase, ship, xdp } = frame;
  const isIdle = phase === "idle";
  const isReqSailing = phase === "req-sail";
  const isRespSailing = phase === "resp-sail";
  const isSailing = isReqSailing || isRespSailing;
  const isComplete = phase === "complete";

  const reqLineActive = ["req-sail", "xdp", "srv-recv", "srv-proc", "resp-gen", "resp-sail", "cli-recv", "complete"].includes(phase);
  const respLineActive = ["resp-sail", "cli-recv", "complete"].includes(phase);

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      {/* Wave texture */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.035 }} preserveAspectRatio="none">
        <defs>
          <pattern id="wv2" x="0" y="0" width="100" height="24" patternUnits="userSpaceOnUse">
            <path d="M0 12 Q25 4 50 12 Q75 20 100 12" stroke="#789D99" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wv2)" />
      </svg>

      {/* Zone label */}
      <div style={{
        position: "absolute", top: "14px", left: "50%",
        transform: "translateX(-50%)", textAlign: "center", zIndex: 10,
        opacity: !isIdle ? 1 : 0, transition: "opacity 0.7s",
        whiteSpace: "nowrap",
      }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.24em", color: "#9CA8AD", textTransform: "uppercase" }}>
          Network Sea
        </div>
      </div>

      {/* Route lines SVG */}
      <svg style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 4,
      }}>
        {/* Request route: left → right */}
        <line
          x1="2%" y1="71%" x2="98%" y2="71%"
          stroke="#789D99" strokeWidth="0.9" opacity={reqLineActive ? "0.45" : "0.1"}
          style={{ transition: "opacity 0.8s" }}
        />
        {/* Animated fill during req-sail */}
        <line
          x1="2%" y1="71%" x2="98%" y2="71%"
          stroke="#B89A6D" strokeWidth="1.2"
          strokeDasharray="2000" strokeDashoffset={isReqSailing && reqShipRight ? "0" : "2000"}
          opacity="0.55"
          style={{ transition: isReqSailing && reqShipRight ? "stroke-dashoffset 4700ms linear" : "stroke-dashoffset 0ms" }}
        />
        {/* Request direction ticks */}
        {reqLineActive && (
          <>
            <line x1="30%" y1="69.2%" x2="32%" y2="71%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
            <line x1="32%" y1="71%" x2="30%" y2="72.8%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
            <line x1="56%" y1="69.2%" x2="58%" y2="71%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
            <line x1="58%" y1="71%" x2="56%" y2="72.8%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
            <line x1="78%" y1="69.2%" x2="80%" y2="71%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
            <line x1="80%" y1="71%" x2="78%" y2="72.8%" stroke="#789D99" strokeWidth="1" opacity="0.3" />
          </>
        )}

        {/* Response route: right → left */}
        <line
          x1="2%" y1="74%" x2="98%" y2="74%"
          stroke="#789D99" strokeWidth="0.9" strokeDasharray="6 4"
          opacity={respLineActive ? "0.4" : "0.07"}
          style={{ transition: "opacity 0.8s" }}
        />
        <line
          x1="98%" y1="74%" x2="2%" y2="74%"
          stroke="#789D99" strokeWidth="1.2"
          strokeDasharray="2000" strokeDashoffset={isRespSailing && respShipLeft ? "0" : "2000"}
          opacity="0.5"
          style={{ transition: isRespSailing && respShipLeft ? "stroke-dashoffset 4700ms linear" : "stroke-dashoffset 0ms" }}
        />
        {/* Response direction ticks (← direction) */}
        {respLineActive && (
          <>
            <line x1="70%" y1="72.2%" x2="68%" y2="74%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
            <line x1="68%" y1="74%" x2="70%" y2="75.8%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
            <line x1="45%" y1="72.2%" x2="43%" y2="74%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
            <line x1="43%" y1="74%" x2="45%" y2="75.8%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
            <line x1="22%" y1="72.2%" x2="20%" y2="74%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
            <line x1="20%" y1="74%" x2="22%" y2="75.8%" stroke="#789D99" strokeWidth="1" opacity="0.25" />
          </>
        )}

        {/* Horizon waterline */}
        <line x1="0" y1="77%" x2="100%" y2="77%"
          stroke="#789D99" strokeWidth="0.6" opacity="0.16" />
      </svg>

      {/* INTRO TEXT */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        opacity: isIdle ? 1 : 0,
        transition: "opacity 0.9s",
        pointerEvents: isIdle ? "auto" : "none",
        zIndex: 20, padding: "0 32px",
      }}>
        <h1 style={{
          fontFamily: "'Noto Serif JP', serif",
          fontSize: "clamp(18px, 2vw, 30px)",
          fontWeight: 300, color: "#F1EFE8",
          letterSpacing: "0.04em", lineHeight: 1.9,
          textAlign: "center", marginBottom: "20px",
        }}>
          見えない通信は、<br />往復する旅をしている。
        </h1>
        <p style={{
          fontSize: "12px", color: "#9CA8AD", fontWeight: 300,
          lineHeight: 2, textAlign: "center", marginBottom: "36px",
          maxWidth: "300px",
        }}>
          ボタンを押すと「状態確認」という小さな荷物が生まれます。
          荷物がパケットになり、サーバーへ届き、
          応答が戻るまでを追いかけます。
        </p>
        <button
          onClick={onLaunch}
          style={{
            border: "1px solid #789D99", padding: "13px 40px",
            color: "#F1EFE8", fontSize: "13px", letterSpacing: "0.12em",
            background: "transparent", cursor: "pointer",
            transition: "border-color 0.3s, color 0.3s", outline: "none",
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#B89A6D"; e.currentTarget.style.color = "#B89A6D"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#789D99"; e.currentTarget.style.color = "#F1EFE8"; }}
        >
          状態確認を送る
        </button>
        <div style={{ fontSize: "9px", color: "#9CA8AD", opacity: 0.45, marginTop: "8px", letterSpacing: "0.1em" }}>
          {webDemo ? "Web デモ" : "物理ボタンの操作でも開始できます"}
        </div>
      </div>

      {/* SAILING STATUS (shown during sailing phases) */}
      <div style={{
        position: "absolute", bottom: "20%",
        left: "50%", transform: "translateX(-50%)",
        textAlign: "center", zIndex: 12,
        opacity: isSailing ? 1 : 0,
        transition: "opacity 0.5s",
        pointerEvents: "none",
      }}>
        {isReqSailing && (
          <>
            <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#B89A6D", textTransform: "uppercase", marginBottom: "5px" }}>
              Request →
            </div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#9CA8AD" }}>
              {packet.srcIp}:{packet.srcPort}
            </div>
            <div style={{ fontSize: "10px", color: "#9CA8AD", opacity: 0.6, margin: "2px 0" }}>↓</div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#9CA8AD" }}>
              {packet.dstIp}:{packet.dstPort}
            </div>
          </>
        )}
        {isRespSailing && (
          <>
            <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#789D99", textTransform: "uppercase", marginBottom: "5px" }}>
              ← Response
            </div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#9CA8AD" }}>
              {packet.dstIp}:{packet.dstPort}
            </div>
            <div style={{ fontSize: "10px", color: "#9CA8AD", opacity: 0.6, margin: "2px 0" }}>↓</div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#9CA8AD" }}>
              {packet.srcIp}:{packet.srcPort}
            </div>
          </>
        )}
      </div>

      {/* COMPLETION MESSAGE */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        opacity: isComplete ? 1 : 0,
        transition: "opacity 1s",
        pointerEvents: "none", zIndex: 18,
        padding: "0 32px",
      }}>
        <p style={{
          fontFamily: "'Noto Serif JP', serif",
          fontSize: "clamp(14px, 1.4vw, 20px)",
          fontWeight: 300, color: "#F1EFE8",
          lineHeight: 1.9, textAlign: "center", marginBottom: "14px",
        }}>
          通信の往復が完了しました
        </p>
        <p style={{
          fontSize: "11px", color: "#9CA8AD", lineHeight: 2,
          textAlign: "center", fontWeight: 300,
        }}>
          「状態確認」という操作は、<br />
          TCPパケットとしてサーバーへ届き、<br />
          「200 OK」という応答になって戻りました。
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VOYAGE LOG
// ─────────────────────────────────────────────────────────────────────────────

const TIMELINE = [
  { label: "操作を検知",          minIdx: 1 },
  { label: "リクエストを生成",    minIdx: 7 },
  { label: "TCP/IP情報を追加",    minIdx: 4 },
  { label: "サーバーへ送信",      minIdx: REQ_SAIL_IDX },
  { label: "XDP ingressで観測",   minIdx: 10 },
  { label: "サーバーが処理",      minIdx: 18 },
  { label: "レスポンスを送信",    minIdx: RESP_SAIL_IDX },
  { label: "クライアントへ到着",  minIdx: 34 },
];

function VoyageLog({
  open, frameIdx, packet,
}: {
  open: boolean;
  frameIdx: number;
  packet: PacketInfo;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div style={{
      maxHeight: open ? "300px" : "0",
      overflow: "hidden",
      transition: "max-height 0.55s cubic-bezier(0.4,0,0.2,1)",
      background: "#0D1E2A",
      borderTop: open ? "1px solid rgba(120,157,153,0.15)" : "none",
    }}>
      <div style={{ padding: "18px 28px 24px", display: "flex", gap: "28px", overflow: "auto" }}>
        {/* Timeline */}
        <div style={{ flexShrink: 0, minWidth: "160px" }}>
          <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "10px" }}>
            航海記録 · Timeline
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {TIMELINE.map((t, i) => {
              const done = frameIdx >= t.minIdx;
              const isCurrent = done && (i === TIMELINE.length - 1 || frameIdx < TIMELINE[i + 1]?.minIdx);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
                    background: done ? "#789D99" : "transparent",
                    border: `1px solid ${done ? "#789D99" : "rgba(120,157,153,0.3)"}`,
                  }} />
                  <span style={{
                    fontSize: "10px", color: done ? "#F1EFE8" : "#9CA8AD",
                    opacity: done ? 1 : 0.45,
                    fontWeight: isCurrent ? 500 : 300,
                  }}>
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Packet details */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "10px" }}>
            パケットの中身
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: "14px" }}>
            {[
              ["Operation",    packet.operation],
              ["Protocol",     `${packet.protocol} / IP`],
              ["Source",       `${packet.srcIp}:${packet.srcPort}`],
              ["Destination",  `${packet.dstIp}:${packet.dstPort}`],
              ["XDP Hook",     "ingress"],
              ["XDP Result",   packet.xdpAction],
              ["Response",     "200 OK"],
              ["RTT (demo)",   "12.4 ms"],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: "8px", letterSpacing: "0.2em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "2px" }}>{k}</div>
                <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#F1EFE8" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Decomposition toggle */}
          <button
            onClick={() => setShowDetail(d => !d)}
            style={{
              fontSize: "9px", letterSpacing: "0.18em", color: "#9CA8AD",
              background: "transparent", border: "1px solid rgba(120,157,153,0.25)",
              padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: "5px",
            }}
          >
            {showDetail ? "▲" : "▼"} 詳しく見る
          </button>

          {showDetail && (
            <div style={{
              marginTop: "10px", padding: "10px 12px",
              background: "rgba(0,0,0,0.2)", borderLeft: "2px solid rgba(120,157,153,0.3)",
              fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD", lineHeight: 1.8,
            }}>
              <div>Ethernet Frame (dst: ff:ff:ff:ff:ff:ff)</div>
              <div style={{ paddingLeft: "12px" }}>└ IP ({packet.srcIp} → {packet.dstIp})</div>
              <div style={{ paddingLeft: "24px" }}>└ {packet.protocol} ({packet.srcPort} → {packet.dstPort}, flags: PSH ACK)</div>
              <div style={{ paddingLeft: "36px" }}>└ HTTP GET /status</div>
              <div style={{ paddingLeft: "48px" }}>└ Payload: "状態確認"</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [frameIdx, setFrameIdx]     = useState(0);
  const [playing, setPlaying]       = useState(false);
  const [logOpen, setLogOpen]       = useState(false);
  const [reqShipRight, setReqShipRight] = useState(false);
  const [respShipLeft, setRespShipLeft] = useState(false);
  const [packet, setPacket] = useState<PacketInfo>(DEFAULT_PACKET);
  const [streamStatus, setStreamStatus] = useState("waiting");
  const [pps, setPps] = useState(0);
  const [total, setTotal] = useState(0);

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdxRef  = useRef(0);
  const frameIdxRef = useRef(0);

  const frame = FRAMES[frameIdx];
  const isComplete = frame.phase === "complete";

  useEffect(() => {
    frameIdxRef.current = frameIdx;
  }, [frameIdx]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: undefined | (() => void);

    void subscribeStream({
      onStatus: status => !disposed && setStreamStatus(status),
      onEvent: rawEvent => {
        if (disposed) return;
        const event = rawEvent as PacketEvent;
        if (event.type === "stats") {
          setPps(Number(event.pps ?? 0));
          setTotal(Number(event.total ?? 0));
          return;
        }
        if (event.type === "physical_action") {
          setPacket(current => ({ ...current, operation: event.label ?? current.operation }));
          start();
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
          if (frameIdxRef.current === 0 || frameIdxRef.current === FRAMES.length - 1) start();
        }
      },
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
    };
  }, []);

  // ── Auto-advance ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    if (frame.dur === 0 || frameIdx >= FRAMES.length - 1) {
      setPlaying(false);
      return;
    }
    timerRef.current = setTimeout(() => setFrameIdx(i => i + 1), frame.dur);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [frameIdx, playing, frame.dur]);

  // ── Ship sailing trigger ──────────────────────────────────────────────────
  useEffect(() => {
    const prev = FRAMES[prevIdxRef.current];
    prevIdxRef.current = frameIdx;
    const entering = (id: string) => frame.id === id && prev.id !== id;

    if (entering("req-sail")) {
      setReqShipRight(false);
      const t = setTimeout(() => setReqShipRight(true), 80);
      return () => clearTimeout(t);
    }
    if (entering("resp-sail")) {
      setRespShipLeft(false);
      const t = setTimeout(() => setRespShipLeft(true), 80);
      return () => clearTimeout(t);
    }
  }, [frameIdx, frame.id]);

  // ── Open log on complete ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isComplete) return;
    const timer = window.setTimeout(() => setLogOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [isComplete]);

  // ── Navigation ────────────────────────────────────────────────────────────
  function goTo(idx: number) {
    const t = Math.max(0, Math.min(FRAMES.length - 1, idx));
    if (t >= REQ_SAIL_IDX + 1)  setReqShipRight(true);
    else                          setReqShipRight(false);
    if (t >= RESP_SAIL_IDX + 1) setRespShipLeft(true);
    else                          setRespShipLeft(false);
    setFrameIdx(t);
    setPlaying(false);
  }

  function start() {
    if (isWebDemo()) {
      setPacket(current => ({
        ...current,
        srcPort: 52000 + Math.floor(Math.random() * 800),
      }));
    }
    setFrameIdx(1);
    setReqShipRight(false);
    setRespShipLeft(false);
    setLogOpen(false);
    setPlaying(true);
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFrameIdx(0);
    setPlaying(false);
    setLogOpen(false);
    setReqShipRight(false);
    setRespShipLeft(false);
  }

  function togglePlay() {
    if (frameIdx === 0) { start(); return; }
    if (isComplete) { reset(); return; }
    setPlaying(p => !p);
  }

  // ── Ship CSS ──────────────────────────────────────────────────────────────
  const reqShipStyle: CSSProperties = {
    position: "absolute",
    width: "200px", height: "64px",
    bottom: "7%",
    left: reqShipRight ? "76%" : "3%",
    transition: frame.phase === "req-sail" && reqShipRight
      ? "left 4700ms cubic-bezier(0.3, 0.05, 0.45, 1)"
      : "none",
    zIndex: 12,
    opacity: (frame.ship === "req") ? 1 : 0,
    pointerEvents: "none",
  };

  const respShipStyle: CSSProperties = {
    position: "absolute",
    width: "200px", height: "64px",
    bottom: "7%",
    left: respShipLeft ? "3%" : "76%",
    transition: frame.phase === "resp-sail" && respShipLeft
      ? "left 4700ms cubic-bezier(0.3, 0.05, 0.45, 1)"
      : "none",
    zIndex: 12,
    opacity: (frame.ship === "resp") ? 1 : 0,
    pointerEvents: "none",
  };

  // ── Ship labels ───────────────────────────────────────────────────────────
  const shipLabelStyle: CSSProperties = {
    position: "absolute",
    bottom: "calc(7% + 68px)",
    fontSize: "9px", fontFamily: "monospace",
    letterSpacing: "0.1em", textAlign: "center",
    pointerEvents: "none",
    zIndex: 13,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      overflow: "hidden", background: "#0B2233", color: "#F1EFE8",
      fontFamily: "'Noto Sans JP', 'Inter', sans-serif",
    }}>
      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: "48px", flexShrink: 0,
        borderBottom: "1px solid rgba(120,157,153,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#789D99" strokeWidth="0.7" />
            <path d="M1 8 Q8 3.5 15 8" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <path d="M1 8 Q8 12.5 15 8" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <line x1="8" y1="1" x2="8" y2="15" stroke="#789D99" strokeWidth="0.4" />
          </svg>
          <span style={{ fontSize: "10px", letterSpacing: "0.22em", color: "#9CA8AD", textTransform: "uppercase" }}>
            Packet Journey
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div style={{ display: "flex", gap: "16px" }}>
            {[
              ["Stream", streamStatus.toUpperCase()],
              ["RTT", isWebDemo() ? "12.4 ms" : "—"],
              ["PPS", String(pps)],
              ["Total", String(total)],
            ].map(([k, v]) => (
              <div key={k} style={{ textAlign: "right" }}>
                <div style={{ fontSize: "8px", letterSpacing: "0.18em", color: "#9CA8AD", opacity: 0.6, textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#F1EFE8", opacity: 0.8 }}>{v}</div>
              </div>
            ))}
          </div>
          {frame.phase !== "idle" && (
            <button
              onClick={reset}
              style={{
                fontSize: "9px", letterSpacing: "0.18em", color: "#9CA8AD",
                textTransform: "uppercase", background: "transparent",
                border: "none", cursor: "pointer", padding: "4px 0", fontFamily: "inherit",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#F1EFE8")}
              onMouseLeave={e => (e.currentTarget.style.color = "#9CA8AD")}
            >
              Reset
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN SCENE ── */}
      <main style={{
        flex: 1, minHeight: 0,
        display: "grid", gridTemplateColumns: "22% 56% 22%",
        position: "relative",
      }}>
        {/* Client port */}
        <PortColumn
          side="client" frame={frame} packet={packet}
          srvProc={frame.srvProc} respReady={frame.respReady} cliDone={frame.cliDone}
        />

        {/* Network sea */}
        <SeaCenter
          frame={frame} packet={packet} webDemo={isWebDemo()}
          onLaunch={start}
          reqShipRight={reqShipRight}
          respShipLeft={respShipLeft}
        />

        {/* Server port */}
        <PortColumn
          side="server" frame={frame} packet={packet}
          srvProc={frame.srvProc} respReady={frame.respReady} cliDone={frame.cliDone}
        />

        {/* Request ship */}
        <div style={reqShipStyle}>
          <ShipSVG loaded={true} />
        </div>
        {frame.ship === "req" && (
          <div style={{
            ...shipLabelStyle,
            left: reqShipRight ? "76%" : "3%",
            width: "200px",
            transition: frame.phase === "req-sail" && reqShipRight
              ? "left 4700ms cubic-bezier(0.3, 0.05, 0.45, 1)" : "none",
          }}>
            <span style={{ color: "#B89A6D", letterSpacing: "0.15em" }}>REQUEST</span>
            <span style={{ color: "#9CA8AD", marginLeft: "6px" }}>{packet.protocol}</span>
          </div>
        )}

        {/* Response ship */}
        <div style={respShipStyle}>
          <ShipSVG loaded={true} flip />
        </div>
        {frame.ship === "resp" && (
          <div style={{
            ...shipLabelStyle,
            left: respShipLeft ? "3%" : "76%",
            width: "200px",
            transition: frame.phase === "resp-sail" && respShipLeft
              ? "left 4700ms cubic-bezier(0.3, 0.05, 0.45, 1)" : "none",
          }}>
            <span style={{ color: "#789D99", letterSpacing: "0.15em" }}>RESPONSE</span>
            <span style={{ color: "#9CA8AD", marginLeft: "6px" }}>200 OK</span>
          </div>
        )}
      </main>

      {/* ── CONTROL BAR ── */}
      <div style={{
        flexShrink: 0, height: "50px",
        borderTop: "1px solid rgba(120,157,153,0.15)",
        background: "#0D1E2A",
        display: "flex", alignItems: "center",
        padding: "0 20px", gap: "8px",
      }}>
        {/* Play/pause/step controls */}
        <button onClick={() => goTo(frameIdx - 1)} disabled={frameIdx <= 0}
          style={ctrlBtnStyle(frameIdx <= 0)}>
          <SkipBack size={12} />
        </button>
        <button onClick={togglePlay}
          style={ctrlBtnStyle(false, true)}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button onClick={() => { goTo(frameIdx + 1); }}
          disabled={frameIdx >= FRAMES.length - 1}
          style={ctrlBtnStyle(frameIdx >= FRAMES.length - 1)}>
          <SkipForward size={12} />
        </button>

        {/* Progress bar */}
        <div style={{ flex: 1, height: "2px", background: "rgba(120,157,153,0.15)", margin: "0 12px", position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${(frameIdx / (FRAMES.length - 1)) * 100}%`,
            background: "#789D99", transition: "width 0.4s",
          }} />
        </div>

        {/* Step label */}
        <div style={{
          fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD",
          letterSpacing: "0.06em", minWidth: "180px", whiteSpace: "nowrap",
        }}>
          {frame.labelJa}
        </div>

        {/* Step counter */}
        <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.45 }}>
          {frameIdx}/{FRAMES.length - 1}
        </div>

        {/* Quick-jump buttons */}
        <div style={{ display: "flex", gap: "6px", marginLeft: "8px" }}>
          <button
            onClick={() => goTo(REQ_SAIL_IDX)}
            style={ctrlChipStyle}>
            REQUEST
          </button>
          <button
            onClick={() => goTo(RESP_SAIL_IDX)}
            style={ctrlChipStyle}>
            RESPONSE
          </button>
        </div>

        {/* Log toggle */}
        <button
          onClick={() => setLogOpen(o => !o)}
          disabled={!isComplete && frameIdx < 5}
          style={{
            ...ctrlBtnStyle(!isComplete && frameIdx < 5),
            display: "flex", alignItems: "center", gap: "4px",
            padding: "4px 8px", fontSize: "9px", letterSpacing: "0.14em",
          }}>
          {logOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          航海記録
        </button>

        {isComplete && (
          <button onClick={start}
            style={{ ...ctrlBtnStyle(false), display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px" }}>
            <RotateCcw size={11} />
            <span style={{ fontSize: "9px", letterSpacing: "0.1em" }}>もう一度</span>
          </button>
        )}
      </div>

      {/* ── VOYAGE LOG ── */}
      <VoyageLog open={logOpen} frameIdx={frameIdx} packet={packet} />

      {/* Keyframe animation */}
      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function ctrlBtnStyle(disabled: boolean, primary?: boolean): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${primary ? "rgba(120,157,153,0.4)" : "rgba(120,157,153,0.2)"}`,
    color: disabled ? "rgba(156,168,173,0.3)" : "#9CA8AD",
    cursor: disabled ? "default" : "pointer",
    padding: "5px 7px",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "color 0.2s, border-color 0.2s",
    fontFamily: "inherit",
  };
}

const ctrlChipStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(120,157,153,0.2)",
  color: "#9CA8AD",
  cursor: "pointer",
  padding: "3px 8px",
  fontSize: "8px",
  letterSpacing: "0.18em",
  fontFamily: "monospace",
};
