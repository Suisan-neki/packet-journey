// Packet Journey — 初心者向け改善版
// 現象→説明→技術用語 の順番で情報を開示する

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
  cLayer: number | null;
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
// OSI LAYER DATA — 日本語の役割説明を中心に
// ─────────────────────────────────────────────────────────────────────────────

interface OsiLayerDef {
  lbl: string;
  name: string;
  nameJa: string;
  roleJa: string;
  descJa: string;
  techLabel: string;
  valueReqJa?: string | null;
  valueTech?: string;
  transparent?: boolean;
  hasXdp?: boolean;
}

const OSI: OsiLayerDef[] = [
  {
    lbl: "L7", name: "Application", nameJa: "アプリケーション",
    roleJa: "手紙を書く",
    descJa: "アプリケーションが、相手に伝えたいメッセージの本体を作成します。今回は「サーバーの状態を教えて」という手紙です。",
    techLabel: "Application / L7",
  },
  {
    lbl: "L6", name: "Presentation", nameJa: "プレゼンテーション",
    roleJa: "共通言語に翻訳する",
    descJa: "人間が読める文字を、コンピューターが理解できる共通のデータ形式（バイト列など）に変換します。",
    techLabel: "Presentation / L6",
    transparent: true,
  },
  {
    lbl: "L5", name: "Session", nameJa: "セッション",
    roleJa: "会話の窓口を開く",
    descJa: "通信が途切れないように、相手との会話の開始から終了までの手順を取り決めます。",
    techLabel: "Session / L5",
    transparent: true,
  },
  {
    lbl: "L4", name: "Transport", nameJa: "トランスポート",
    roleJa: "担当部署のラベルを貼る",
    descJa: "サーバーの「どのアプリ」に届けるかを指定します。このラベルがポート番号です。",
    techLabel: "TCP・ポート番号 / L4",
    valueReqJa: "52499 → 8080",
    valueTech: "ポート 52499 → 8080",
  },
  {
    lbl: "L3", name: "Network", nameJa: "ネットワーク",
    roleJa: "宛先の住所を書く",
    descJa: "ネットワーク上の「どのコンピューター」に届けるかを指定します。この住所がIPアドレスです。",
    techLabel: "IPアドレス / L3",
    valueReqJa: null,
    valueTech: "192.168.1.50 → 192.168.1.10",
  },
  {
    lbl: "L2", name: "Data Link", nameJa: "データリンク",
    roleJa: "次の経由地を記す",
    descJa: "最終目的地へ向かうために、まずは「次にバケツリレーする隣の機器」を指定します。これがMACアドレスです。",
    techLabel: "Ethernet・MACアドレス / L2",
    hasXdp: true,
  },
  {
    lbl: "L1", name: "Physical", nameJa: "フィジカル",
    roleJa: "物理的な波に乗せる",
    descJa: "すべての封筒を重ねた荷物を、ケーブルの電気信号やWi-Fiの電波に変換して送り出します。",
    techLabel: "Physical / L1",
  },
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

// ─────────────────────────────────────────────────────────────────────────────
// LAYER ACTION MESSAGES — 平易な日本語
// ─────────────────────────────────────────────────────────────────────────────

const MSG_SIMPLE: Record<string, string[]> = {
  creq:  ["手紙を書きました","共通言語に翻訳します","会話の窓口を開きます",
          "担当部署ラベルを貼りました（52499→8080）","宛先の住所を書きました（192.168.1.50→.1.10）","次の経由地を記しました","電気信号・電波に変えて送り出します"],
  srecv: ["「状態を教えて」を取り出しました","データ形式を確認します","会話のつながりを確認します",
          "アプリ番号を確認します","端末の住所を確認します","配送情報を確認します（XDP済）","信号を受け取りました"],
  sresp: ["「正常です」という返事を書きました","共通言語に翻訳します","会話の窓口を開きます",
          "担当部署ラベルを貼りました（8080→52499）","宛先の住所を書きました（.1.10→.1.50）","次の経由地を記しました","電気信号・電波に変えて送り出します"],
  crecv: ["「正常です」という返事を受け取りました","データ形式を確認します","会話のつながりを確認します",
          "アプリ番号を確認します","端末の住所を確認します","配送情報を確認します","信号を受け取りました"],
};

const MSG_TECH: Record<string, string[]> = {
  creq:  ["「状態確認」を生成","データ形式を整える","セッションを管理",
          "TCP :52499 → :8080","IP 192.168.1.50 → .1.10","Ethernet フレーム化","電気信号として送出"],
  srecv: ["「状態確認」を処理","データ形式を解析","セッションを管理",
          "TCP セグメント解析","IP パケット解析","Ethernet 解析 + XDP済","信号を受信"],
  sresp: ["「200 OK」を生成","データ形式を整える","セッションを管理",
          "TCP :8080 → :52499","IP 192.168.1.10 → .50","Ethernet フレーム化","電気信号として送出"],
  crecv: ["「200 OK」を受信","データ形式を解析","セッションを管理",
          "TCP セグメント解析","IP パケット解析","Ethernet 解析","信号を受信"],
};

const TRANSPARENT_NOTE = "TCP/IPを使う実際のシステムでは、この役割をアプリやライブラリがまとめて担当することがあります。";

// ─────────────────────────────────────────────────────────────────────────────
// FRAMES
// ─────────────────────────────────────────────────────────────────────────────

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
  fr("idle",     "待機中",                  "idle",     null,null, null,null,   "none","none",   false,false,false, 0),
  fr("req-l7",   "お願いを作る",             "req-gen",  0,   null, "down",null, "none","none",   false,false,false, 640),
  fr("req-l6",   "形式を整える",             "req-gen",  1,   null, "down",null, "none","none",   false,false,false, 560),
  fr("req-l5",   "つながりを記録する",       "req-gen",  2,   null, "down",null, "none","none",   false,false,false, 560),
  fr("req-l4",   "アプリ番号を付ける",       "req-gen",  3,   null, "down",null, "none","none",   false,false,false, 560),
  fr("req-l3",   "端末の住所を付ける",       "req-gen",  4,   null, "down",null, "none","none",   false,false,false, 560),
  fr("req-l2",   "配送情報を付ける",         "req-gen",  5,   null, "down",null, "none","none",   false,false,false, 560),
  fr("req-l1",   "電気信号として送り出す",   "req-gen",  6,   null, "down",null, "none","none",   false,false,false, 640),
  fr("req-sail", "お願いを送信中",           "req-sail", null,null, null,null,   "req","none",    false,false,false, 4700),
  fr("xdp-chk",  "入口で確認中...",          "xdp",      null,5,    null,null,   "req","checking",false,false,false, 950),
  fr("xdp-pass", "通してよい（確認完了）",   "xdp",      null,5,    null,null,   "req","passed",  false,false,false, 1700),
  fr("srv-l1",   "信号を受け取る",           "srv-recv", null,6,    null,"up",   "req","passed",  false,false,false, 530),
  fr("srv-l2",   "配送情報を確認する",       "srv-recv", null,5,    null,"up",   "req","passed",  false,false,false, 530),
  fr("srv-l3",   "端末の住所を確認する",     "srv-recv", null,4,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l4",   "アプリ番号を確認する",     "srv-recv", null,3,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l5",   "つながりを確認する",       "srv-recv", null,2,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l6",   "形式を確認する",           "srv-recv", null,1,    null,"up",   "none","passed", false,false,false, 530),
  fr("srv-l7",   "お願いを取り出す",         "srv-recv", null,0,    null,"up",   "none","passed", false,false,false, 720),
  fr("srv-proc", "サーバーが処理中",         "srv-proc", null,0,    null,null,   "none","none",   true,false,false,  2400),
  fr("resp-l7",  "返事を作る",               "resp-gen", null,0,    null,"down", "resp","none",   false,true,false,  580),
  fr("resp-l6",  "形式を整える",             "resp-gen", null,1,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l5",  "つながりを記録する",       "resp-gen", null,2,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l4",  "アプリ番号を付ける",       "resp-gen", null,3,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l3",  "端末の住所を付ける",       "resp-gen", null,4,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l2",  "配送情報を付ける",         "resp-gen", null,5,    null,"down", "resp","none",   false,true,false,  540),
  fr("resp-l1",  "電気信号として送り出す",   "resp-gen", null,6,    null,"down", "resp","none",   false,true,false,  600),
  fr("resp-sail","返事を送信中",             "resp-sail",null,null, null,null,   "resp","none",   false,true,false,  4700),
  fr("cli-l1",   "信号を受け取る",           "cli-recv", 6,   null, "up",null,   "resp","none",   false,true,false,  530),
  fr("cli-l2",   "配送情報を確認する",       "cli-recv", 5,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l3",   "端末の住所を確認する",     "cli-recv", 4,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l4",   "アプリ番号を確認する",     "cli-recv", 3,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l5",   "つながりを確認する",       "cli-recv", 2,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l6",   "形式を確認する",           "cli-recv", 1,   null, "up",null,   "none","none",   false,true,false,  530),
  fr("cli-l7",   "返事を受け取る",           "cli-recv", 0,   null, "up",null,   "none","none",   false,true,true,   800),
  fr("complete", "往復が完了しました",        "complete", null,null, null,null,   "none","none",   false,true,true,   0),
];

const REQ_SAIL_IDX  = FRAMES.findIndex(f => f.id === "req-sail");
const RESP_SAIL_IDX = FRAMES.findIndex(f => f.id === "resp-sail");
const XDP_IDX       = FRAMES.findIndex(f => f.id === "xdp-chk");
const SRV_PROC_IDX  = FRAMES.findIndex(f => f.id === "srv-proc");

// ─────────────────────────────────────────────────────────────────────────────
// SHIP SVG
// ─────────────────────────────────────────────────────────────────────────────

function ShipSVG({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 220 72" fill="none"
      style={{ width: "100%", height: "100%", transform: flip ? "scaleX(-1)" : undefined }}>
      <path d="M10 44 Q16 57 28 60 L192 60 Q204 57 210 44 Z" fill="#1A3245" stroke="#789D99" strokeWidth="1.1" />
      <rect x="26" y="37" width="168" height="7" fill="#152B3C" stroke="#789D99" strokeWidth="0.7" />
      <rect x="128" y="20" width="42" height="17" fill="#0F2030" stroke="#9CA8AD" strokeWidth="0.7" />
      <rect x="133" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="143" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="153" y="24" width="6" height="4" fill="#789D99" opacity="0.5" />
      <rect x="160" y="8" width="8" height="13" rx="1" fill="#1A3245" stroke="#9CA8AD" strokeWidth="0.7" />
      <rect x="159" y="7" width="10" height="3" rx="0.5" fill="#9CA8AD" opacity="0.35" />
      <line x1="116" y1="8" x2="116" y2="37" stroke="#9CA8AD" strokeWidth="1" opacity="0.55" />
      <rect x="32" y="28" width="24" height="9" rx="0.5" fill="#B89A6D" opacity="0.88" stroke="#0B2233" strokeWidth="0.6" />
      <rect x="60" y="28" width="24" height="9" rx="0.5" fill="#789D99" opacity="0.58" stroke="#0B2233" strokeWidth="0.6" />
      <rect x="88" y="28" width="24" height="9" rx="0.5" fill="#789D99" opacity="0.38" stroke="#0B2233" strokeWidth="0.6" />
      <path d="M210 44 L218 52 L210 60" fill="none" stroke="#789D99" strokeWidth="0.9" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OSI LAYER ROW — 日本語役割を大きく、技術名を小さく
// ─────────────────────────────────────────────────────────────────────────────

function OsiRow({
  idx, active, dir, simpleMode, xdpState,
  msgSimple, msgTech,
}: {
  idx: number;
  active: boolean;
  dir: "down" | "up" | null;
  simpleMode: boolean;
  xdpState: XdpState;
  msgSimple: string | null;
  msgTech: string | null;
}) {
  const layer = OSI[idx];
  const isXdpActive = layer.hasXdp && (xdpState === "checking" || xdpState === "passed");

  const accentColor = isXdpActive
    ? "#9A6258"
    : active && dir === "down" ? "#B89A6D"
    : active && dir === "up"   ? "#789D99"
    : "transparent";

  const bgColor = isXdpActive ? "rgba(154,98,88,0.07)"
    : active && dir === "down" ? "rgba(184,154,109,0.07)"
    : active && dir === "up"   ? "rgba(120,157,153,0.07)"
    : "transparent";

  // L5/L6 are dimmed in simple mode (transparent in TCP/IP)
  const rowOpacity = (layer.transparent && simpleMode && !active) ? 0.45 : 1;

  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "stretch",
      borderBottom: "1px solid rgba(120,157,153,0.09)",
      background: bgColor, transition: "background 0.4s",
      opacity: rowOpacity, overflow: "hidden",
    }}>
      {/* Accent bar */}
      <div style={{
        width: "3px", flexShrink: 0,
        background: accentColor, transition: "background 0.35s",
      }} />

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 8px 0 8px", minWidth: 0, gap: "1px" }}>
        {/* Layer identifier: "L7 アプリケーション" */}
        <div style={{
          fontSize: "9px", color: "#789D99",
          opacity: simpleMode ? (active ? 0.6 : 0.28) : (active ? 0.8 : 0.5),
          letterSpacing: "0.05em", transition: "opacity 0.3s",
          display: "flex", alignItems: "center", gap: "4px",
        }}>
          <span style={{ fontFamily: "monospace" }}>{layer.lbl}</span>
          <span>{layer.nameJa}</span>
          {layer.hasXdp && !simpleMode && (
            <span style={{
              fontSize: "7px", padding: "1px 3px",
              border: `1px solid ${isXdpActive ? "#9A6258" : "rgba(120,157,153,0.3)"}`,
              color: isXdpActive ? "#9A6258" : "rgba(120,157,153,0.4)",
              letterSpacing: "0.1em", transition: "all 0.3s",
            }}>XDP</span>
          )}
        </div>

        {/* Role description — primary */}
        <div style={{
          fontSize: active ? "12px" : "11px",
          color: active ? "#F1EFE8" : "rgba(241,239,232,0.6)",
          fontWeight: active ? 400 : 300,
          transition: "color 0.35s, font-size 0.2s",
          lineHeight: 1.3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {layer.roleJa}
        </div>

        {/* Active: action message */}
        {active && (msgSimple || isXdpActive) && (
          <div style={{
            fontSize: "10px", color: accentColor,
            opacity: 0.9, lineHeight: 1.4,
            animation: "fadeSlide 0.4s ease",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {isXdpActive
              ? (xdpState === "checking" ? "検問しています..." : "通過を許可")
              : msgSimple}
          </div>
        )}

        {/* Active: tech detail (tech mode) */}
        {active && !simpleMode && msgTech && !isXdpActive && (
          <div style={{
            fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD",
            opacity: 0.6, letterSpacing: "0.04em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {msgTech}
          </div>
        )}

        {/* L5/L6 transparent note */}
        {active && layer.transparent && !simpleMode && (
          <div style={{ fontSize: "8px", color: "#9CA8AD", opacity: 0.5, lineHeight: 1.4, marginTop: "1px" }}>
            {TRANSPARENT_NOTE}
          </div>
        )}
      </div>

      {/* Direction arrow */}
      {active && dir && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "20px", flexShrink: 0,
          color: dir === "down" ? "#B89A6D" : "#789D99",
          fontSize: "13px", opacity: 0.75,
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

function PortColumn({ side, frame, simpleMode, packet }: {
  side: "client" | "server";
  frame: Frame;
  simpleMode: boolean;
  packet: PacketInfo;
}) {
  const isClient = side === "client";
  const activeLayer = isClient ? frame.cLayer : frame.sLayer;
  const dir = isClient ? frame.cDir : frame.sDir;
  const xdp = frame.xdp;
  const phase = frame.phase;

  function getMsgs(idx: number): [string | null, string | null] {
    if (idx === 3) {
      if (phase === "req-gen") return [`担当部署ラベルを貼りました（${packet.srcPort}→${packet.dstPort}）`, `${packet.protocol} :${packet.srcPort} → :${packet.dstPort}`];
      if (phase === "srv-recv") return [MSG_SIMPLE.srecv[idx], `${packet.protocol} セグメント解析`];
      if (phase === "resp-gen") return [`担当部署ラベルを貼りました（${packet.dstPort}→${packet.srcPort}）`, `${packet.protocol} :${packet.dstPort} → :${packet.srcPort}`];
      if (phase === "cli-recv") return [MSG_SIMPLE.crecv[idx], `${packet.protocol} セグメント解析`];
    }
    if (idx === 4) {
      if (phase === "req-gen") return [`宛先の住所を書きました（${packet.srcIp}→${packet.dstIp}）`, `IP ${packet.srcIp} → ${packet.dstIp}`];
      if (phase === "srv-recv") return [MSG_SIMPLE.srecv[idx], "IP パケット解析"];
      if (phase === "resp-gen") return [`宛先の住所を書きました（${packet.dstIp}→${packet.srcIp}）`, `IP ${packet.dstIp} → ${packet.srcIp}`];
      if (phase === "cli-recv") return [MSG_SIMPLE.crecv[idx], "IP パケット解析"];
    }
    if (isClient) {
      if (phase === "req-gen") return [MSG_SIMPLE.creq[idx], MSG_TECH.creq[idx]];
      if (phase === "cli-recv") return [MSG_SIMPLE.crecv[idx], MSG_TECH.crecv[idx]];
    } else {
      if (phase === "srv-recv") return [MSG_SIMPLE.srecv[idx], MSG_TECH.srecv[idx]];
      if (phase === "resp-gen") return [MSG_SIMPLE.sresp[idx], MSG_TECH.sresp[idx]];
    }
    return [null, null];
  }

  const ipAddr = isClient ? packet.srcIp : packet.dstIp;
  const role = isClient ? "操作端末" : "観測サーバー";
  const roleEn = isClient ? "CLIENT PORT" : "SERVER PORT";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      borderRight: isClient ? "1px solid rgba(120,157,153,0.12)" : undefined,
      borderLeft: !isClient ? "1px solid rgba(120,157,153,0.12)" : undefined,
    }}>
      {/* Zone header */}
      <div style={{
        flexShrink: 0, height: "46px",
        borderBottom: "1px solid rgba(120,157,153,0.12)",
        display: "flex", alignItems: "center",
        padding: "0 10px",
        justifyContent: isClient ? "flex-start" : "flex-end",
        gap: "6px",
      }}>
        <div style={{ textAlign: isClient ? "left" : "right" }}>
          <div style={{ fontSize: "11px", color: "#F1EFE8", fontWeight: 300 }}>{role}</div>
          {!simpleMode && (
            <div style={{ fontSize: "8px", letterSpacing: "0.18em", color: "#9CA8AD", opacity: 0.55, textTransform: "uppercase" }}>
              {roleEn} · {ipAddr}
            </div>
          )}
        </div>
      </div>

      {/* OSI layer stack */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {OSI.map((_, idx) => {
          const [ms, mt] = getMsgs(idx);
          return (
            <OsiRow
              key={idx} idx={idx}
              active={activeLayer === idx}
              dir={dir}
              simpleMode={simpleMode}
              xdpState={xdp}
              msgSimple={ms}
              msgTech={mt}
            />
          );
        })}
      </div>

      {/* Status footer */}
      <div style={{
        flexShrink: 0, padding: "6px 10px",
        borderTop: "1px solid rgba(120,157,153,0.09)",
        minHeight: "36px", display: "flex", alignItems: "center",
      }}>
        {!isClient && frame.srvProc && (
          <div>
            <div style={{ fontSize: "11px", color: "#F1EFE8" }}>サーバーが処理しました</div>
            {!simpleMode && (
              <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.6 }}>HTTP 200 OK</div>
            )}
          </div>
        )}
        {!isClient && frame.respReady && phase !== "srv-proc" && !["resp-gen","resp-sail","cli-recv","complete"].includes(phase) && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: "11px", color: "#B89A6D" }}>返事の準備完了</div>
            {!simpleMode && <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.6 }}>200 OK</div>}
          </div>
        )}
        {isClient && frame.cliDone && (
          <div>
            <div style={{ fontSize: "11px", color: "#789D99" }}>返事を受け取りました</div>
            {!simpleMode && <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.6 }}>HTTP 200 OK</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PACKET ENCAPSULATION VISUALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function PacketEncap({ cLayer, sLayer, phase, simpleMode, packet }: {
  cLayer: number | null;
  sLayer: number | null;
  phase: Phase;
  simpleMode: boolean;
  packet: PacketInfo;
}) {
  const isSending   = phase === "req-gen" || phase === "resp-gen";
  const isReceiving = phase === "srv-recv" || phase === "cli-recv";
  const activeIdx   = isSending ? (cLayer ?? sLayer) : (sLayer ?? cLayer);

  if (activeIdx === null || (!isSending && !isReceiving)) return null;

  const isResp = phase === "resp-gen" || phase === "cli-recv";
  const payloadText = isResp ? "正常です" : "状態を教えて";

  type Layer = { labelSimple: string; labelTech: string; value: string; color: string };
  const layers: Layer[] = [];

  if (isSending) {
    if (activeIdx >= 5) layers.push({ labelSimple: "次の経由地の情報", labelTech: "Ethernet ヘッダ (L2)", value: "MACアドレス付与", color: "#789D99" });
    if (activeIdx >= 4) layers.push({ labelSimple: "宛先の住所", labelTech: "IP ヘッダ (L3)", value: isResp ? `${packet.dstIp} → ${packet.srcIp}` : `${packet.srcIp} → ${packet.dstIp}`, color: "#789D99" });
    if (activeIdx >= 3) layers.push({ labelSimple: "担当部署ラベル", labelTech: `${packet.protocol} ヘッダ (L4)`, value: isResp ? `${packet.dstPort} → ${packet.srcPort}` : `${packet.srcPort} → ${packet.dstPort}`, color: "#789D99" });
    layers.push({ labelSimple: payloadText, labelTech: "Payload (L7)", value: "", color: "#B89A6D" });
  } else {
    // Unwrapping — show what's been peeled so far
    const payload: Layer = { labelSimple: payloadText, labelTech: "Payload (L7)", value: "", color: "#B89A6D" };
    if (activeIdx <= 3) layers.push({ labelSimple: "担当部署ラベルを確認", labelTech: `${packet.protocol} ヘッダ (L4)`, value: isResp ? `${packet.dstPort} → ${packet.srcPort}` : `${packet.srcPort} → ${packet.dstPort}`, color: "#789D99" });
    if (activeIdx <= 4) layers.push({ labelSimple: "宛先の住所を確認", labelTech: "IP ヘッダ (L3)", value: isResp ? `${packet.dstIp} → ${packet.srcIp}` : `${packet.srcIp} → ${packet.dstIp}`, color: "#789D99" });
    if (activeIdx <= 5) layers.push({ labelSimple: "配送情報を確認", labelTech: "Ethernet ヘッダ (L2)", value: "MACアドレス確認", color: "#789D99" });
    layers.push(payload);
  }

  const outerToInner = isSending ? layers : [...layers].reverse();

  return (
    <div style={{ padding: "8px 12px", animation: "fadeSlide 0.3s ease" }}>
      <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "8px" }}>
        {isSending ? "封筒の中身（カプセル化）" : "封筒を開いていく（分解）"}
      </div>
      {outerToInner.map((w, i) => {
        const isPayload = w.color === "#B89A6D";
        const indent = isSending ? i : outerToInner.length - 1 - i;
        return (
          <div key={i} style={{ paddingLeft: `${indent * 10}px`, lineHeight: "1.85" }}>
            <span style={{ color: "#9CA8AD", fontSize: "10px" }}>{indent > 0 ? "└ " : ""}</span>
            <span style={{
              fontSize: isPayload ? "13px" : "11px",
              color: isPayload ? "#B89A6D" : "rgba(241,239,232,0.75)",
              fontFamily: isPayload ? "'Noto Serif JP', serif" : "inherit",
              fontWeight: isPayload ? 400 : 300,
            }}>
              {simpleMode ? w.labelSimple : w.labelTech}
            </span>
            {w.value && (
              <span style={{
                fontSize: "9px", fontFamily: "monospace",
                color: isPayload ? "#B89A6D" : "#789D99",
                opacity: 0.8, marginLeft: "6px",
              }}>
                {w.value}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEA CENTER
// ─────────────────────────────────────────────────────────────────────────────

function SeaCenter({
  frame, packet, webDemo, onLaunch, reqShipRight, respShipLeft, simpleMode,
}: {
  frame: Frame;
  packet: PacketInfo;
  webDemo: boolean;
  onLaunch: () => void;
  reqShipRight: boolean;
  respShipLeft: boolean;
  simpleMode: boolean;
}) {
  const [xdpDetail, setXdpDetail] = useState(false);
  const { phase, xdp, cLayer, sLayer } = frame;
  const isIdle     = phase === "idle";
  const isReqSail  = phase === "req-sail";
  const isRespSail = phase === "resp-sail";
  const isSailing  = isReqSail || isRespSail;
  const isComplete = phase === "complete";
  const isLayerPhase = ["req-gen","srv-recv","resp-gen","cli-recv"].includes(phase);
  const isXdp      = phase === "xdp";

  const reqLineActive  = phase !== "idle" && phase !== "req-gen";
  const respLineActive = ["resp-sail","cli-recv","complete"].includes(phase);

  // Context panel: what to show in the sea center for each phase
  const getContextPanel = () => {
    if (isIdle || isSailing || isComplete) return null;

    if (isXdp) {
      const passed = xdp === "passed";
      return (
        <div style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: "13px", color: "#F1EFE8", lineHeight: 1.6, marginBottom: "8px", fontFamily: "'Noto Serif JP', serif", fontWeight: 300 }}>
            {passed
              ? "検問を通過しました。"
              : "カーネルの門番が検問します"}
          </div>
          <div style={{ fontSize: "11px", color: "#9CA8AD", lineHeight: 1.9, marginBottom: "10px", whiteSpace: "pre-line" }}>
            {passed
              ? "荷物に問題がなかったため、\nサーバー内部へ進みます。"
              : "サーバーに到着した瞬間、OSの奥深く（カーネル）で\nプログラムがすばやく荷物を検査します。\nユーザーの知らない裏側で、安全を守っています。"}
          </div>
          {passed && (
            <div style={{
              padding: "6px 10px",
              border: "1px solid rgba(120,157,153,0.3)",
              display: "inline-block",
              marginBottom: "8px",
            }}>
              <div style={{ fontSize: "12px", color: "#789D99", fontWeight: 400 }}>通過を許可</div>
              {!simpleMode && (
                <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.65, marginTop: "2px" }}>
                  XDP_PASS — 通常の処理へ進める
                </div>
              )}
            </div>
          )}
          {!simpleMode && (
            <div>
              <button onClick={() => setXdpDetail(d => !d)} style={linkBtnStyle}>
                {xdpDetail ? "▲ 閉じる" : "▼ eBPF/XDPについて詳しく"}
              </button>
              {xdpDetail && (
                <div style={{
                  marginTop: "8px", padding: "10px 12px",
                  borderLeft: "2px solid rgba(120,157,153,0.3)",
                  fontSize: "10px", color: "#9CA8AD", lineHeight: 1.9,
                }}>
                  <div style={{ marginBottom: "6px" }}>
                    <span style={{ color: "#F1EFE8" }}>eBPF / XDP（eXpress Data Path）：</span><br />
                    カーネル（OSの中心部分）でプログラムを動かし、届いた通信をアプリより早い段階で検査・処理できる仕組みです。
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "9px", lineHeight: 2, marginBottom: "6px" }}>
                    通信が到着<br />
                    ↓ ネットワークカード<br />
                    ↓ <span style={{ color: "#9A6258" }}>XDP ← いまここ（カーネルの門番）</span><br />
                    ↓ カーネルのネットワーク処理<br />
                    ↓ アプリケーション
                  </div>
                  <div style={{ fontSize: "9px", opacity: 0.6 }}>
                    XDP_PASS — 通常の処理へ進める（今回はこれ）<br />
                    XDP_DROP — ここで破棄する<br />
                    XDP_REDIRECT — 別の場所へ転送する
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (phase === "srv-proc") {
      return (
        <div style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: "13px", color: "#F1EFE8", fontFamily: "'Noto Serif JP', serif", fontWeight: 300, lineHeight: 1.6, marginBottom: "8px" }}>
            サーバーが返事を作りました
          </div>
          <div style={{ fontSize: "11px", color: "#9CA8AD", lineHeight: 1.9, marginBottom: "10px" }}>
            サーバーはお願いを処理し、<br />成功したことを表す返事を作ります。
          </div>
          <div style={{ padding: "8px 12px", border: "1px solid rgba(184,154,109,0.35)", display: "inline-block" }}>
            <div style={{ fontSize: "12px", color: "#B89A6D" }}>正常です</div>
            {!simpleMode && (
              <div style={{ fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.65, marginTop: "2px" }}>
                HTTP 200 OK — お願いを正常に受け取り、処理できたことを表します。
              </div>
            )}
          </div>
        </div>
      );
    }

    // Layer traversal phases: show context + packet viz
    if (isLayerPhase) {
      const activeIdx = cLayer ?? sLayer;
      const layer = activeIdx !== null ? OSI[activeIdx] : null;
      const isSending = phase === "req-gen" || phase === "resp-gen";
      const isReceiving = phase === "srv-recv" || phase === "cli-recv";

      const phaseTitle: Record<string, string> = {
        "req-gen":  "送る準備をしています",
        "srv-recv": "お願いを開いています",
        "resp-gen": "返事の準備をしています",
        "cli-recv": "返事を受け取っています",
      };

      return (
        <div>
          <div style={{ padding: "10px 14px 6px", borderBottom: "1px solid rgba(120,157,153,0.1)" }}>
            <div style={{ fontSize: "11px", color: "#9CA8AD", marginBottom: "4px", letterSpacing: "0.05em" }}>
              {phaseTitle[phase]}
            </div>
            {layer && (
              <div style={{ fontSize: "13px", color: "#F1EFE8", fontFamily: "'Noto Serif JP', serif", fontWeight: 300, lineHeight: 1.5 }}>
                {layer.roleJa}
              </div>
            )}
            {layer && (
              <div style={{ fontSize: "10px", color: "#9CA8AD", marginTop: "4px", lineHeight: 1.7 }}>
                {layer.descJa}
              </div>
            )}
            {layer && layer.transparent && (
              <div style={{ fontSize: "9px", color: "#9CA8AD", opacity: 0.5, marginTop: "4px", lineHeight: 1.6, borderLeft: "2px solid rgba(156,168,173,0.2)", paddingLeft: "6px" }}>
                {TRANSPARENT_NOTE}
              </div>
            )}
            {/* Show value — always when available (port/IP are shown at the step they're added) */}
            {layer && (layer.valueReqJa || layer.valueTech) && (
              <div style={{ marginTop: "5px" }}>
                <div style={{ fontSize: "10px", color: "#B89A6D", fontFamily: "monospace", letterSpacing: "0.04em" }}>
                  {simpleMode ? (layer.valueReqJa ?? layer.valueTech) : layer.valueTech}
                </div>
                {!simpleMode && layer.valueReqJa && (
                  <div style={{ fontSize: "8px", color: "#9CA8AD", opacity: 0.5, marginTop: "1px" }}>
                    ← このステップで追加されます
                  </div>
                )}
              </div>
            )}
          </div>
          <PacketEncap
            cLayer={cLayer} sLayer={sLayer}
            phase={phase} simpleMode={simpleMode} packet={packet}
          />
        </div>
      );
    }

    return null;
  };

  const ctxPanel = getContextPanel();

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

      {/* Route lines SVG */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4 }}>
        <line x1="2%" y1="72%" x2="98%" y2="72%" stroke="#789D99" strokeWidth="0.9"
          opacity={reqLineActive ? "0.4" : "0.1"} style={{ transition: "opacity 0.8s" }} />
        <line x1="2%" y1="72%" x2="98%" y2="72%" stroke="#B89A6D" strokeWidth="1.2"
          strokeDasharray="2000" strokeDashoffset={isReqSail && reqShipRight ? "0" : "2000"} opacity="0.5"
          style={{ transition: isReqSail && reqShipRight ? "stroke-dashoffset 4700ms linear" : "stroke-dashoffset 0ms" }} />
        {reqLineActive && (
          <>
            <line x1="30%" y1="70.2%" x2="32%" y2="72%" stroke="#789D99" strokeWidth="1" opacity="0.28" />
            <line x1="32%" y1="72%" x2="30%" y2="73.8%" stroke="#789D99" strokeWidth="1" opacity="0.28" />
            <line x1="60%" y1="70.2%" x2="62%" y2="72%" stroke="#789D99" strokeWidth="1" opacity="0.28" />
            <line x1="62%" y1="72%" x2="60%" y2="73.8%" stroke="#789D99" strokeWidth="1" opacity="0.28" />
          </>
        )}
        <line x1="2%" y1="75%" x2="98%" y2="75%" stroke="#789D99" strokeWidth="0.9" strokeDasharray="6 4"
          opacity={respLineActive ? "0.38" : "0.07"} style={{ transition: "opacity 0.8s" }} />
        <line x1="98%" y1="75%" x2="2%" y2="75%" stroke="#789D99" strokeWidth="1.2"
          strokeDasharray="2000" strokeDashoffset={isRespSail && respShipLeft ? "0" : "2000"} opacity="0.45"
          style={{ transition: isRespSail && respShipLeft ? "stroke-dashoffset 4700ms linear" : "stroke-dashoffset 0ms" }} />
        {respLineActive && (
          <>
            <line x1="70%" y1="73.2%" x2="68%" y2="75%" stroke="#789D99" strokeWidth="1" opacity="0.24" />
            <line x1="68%" y1="75%" x2="70%" y2="76.8%" stroke="#789D99" strokeWidth="1" opacity="0.24" />
            <line x1="40%" y1="73.2%" x2="38%" y2="75%" stroke="#789D99" strokeWidth="1" opacity="0.24" />
            <line x1="38%" y1="75%" x2="40%" y2="76.8%" stroke="#789D99" strokeWidth="1" opacity="0.24" />
          </>
        )}
        <line x1="0" y1="78%" x2="100%" y2="78%" stroke="#789D99" strokeWidth="0.5" opacity="0.15" />
      </svg>

      {/* INTRO */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        opacity: isIdle ? 1 : 0, transition: "opacity 0.9s",
        pointerEvents: isIdle ? "auto" : "none",
        zIndex: 20, padding: "0 32px",
      }}>
        <h1 style={{
          fontFamily: "'Noto Serif JP', serif", fontSize: "clamp(18px, 1.9vw, 28px)",
          fontWeight: 300, color: "#F1EFE8", letterSpacing: "0.04em",
          lineHeight: 1.9, textAlign: "center", marginBottom: "20px",
        }}>
          ボタンの裏側では、<br />小さな通信が旅をしている。
        </h1>
        <p style={{
          fontSize: "12px", color: "#9CA8AD", fontWeight: 300,
          lineHeight: 2.1, textAlign: "center", marginBottom: "36px", maxWidth: "280px",
        }}>
          「状態確認」を押すと、サーバーへお願いが送られ、その返事が戻ってきます。<br />
          普段は見えない通信の中身を、船旅として一緒に追いかけます。
        </p>
        <button onClick={onLaunch}
          style={{
            border: "1px solid #789D99", padding: "13px 40px",
            color: "#F1EFE8", fontSize: "13px", letterSpacing: "0.12em",
            background: "transparent", cursor: "pointer",
            transition: "border-color 0.3s, color 0.3s", outline: "none",
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#B89A6D"; e.currentTarget.style.color = "#B89A6D"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#789D99"; e.currentTarget.style.color = "#F1EFE8"; }}>
          通信の旅をはじめる
        </button>
        <div style={{ fontSize: "10px", color: "#9CA8AD", opacity: 0.4, marginTop: "10px" }}>
          {webDemo ? "Webデモ · 専門知識は必要ありません" : "物理ボタンの操作でも開始できます"}
        </div>
      </div>

      {/* CONTEXT PANEL (non-sailing, non-idle, non-complete phases) */}
      {ctxPanel && (
        <div style={{
          position: "absolute", top: "6%", left: "8%", right: "8%",
          zIndex: 15, pointerEvents: "auto",
          background: "rgba(11,34,51,0.75)",
          border: "1px solid rgba(120,157,153,0.18)",
          maxHeight: "75%", overflowY: "auto",
        }}>
          {ctxPanel}
        </div>
      )}

      {/* SAILING STATUS */}
      <div style={{
        position: "absolute", bottom: "18%", left: "50%", transform: "translateX(-50%)",
        textAlign: "center", zIndex: 12, opacity: isSailing ? 1 : 0,
        transition: "opacity 0.5s", pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {isReqSail && (
          <>
            <div style={{ fontSize: "11px", color: "#B89A6D", letterSpacing: "0.1em", marginBottom: "6px" }}>
              お願いを送信中 →
            </div>
            {!simpleMode && (
              <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD", lineHeight: 1.8 }}>
                {packet.srcIp}:{packet.srcPort}<br />→ {packet.dstIp}:{packet.dstPort}
              </div>
            )}
          </>
        )}
        {isRespSail && (
          <>
            <div style={{ fontSize: "11px", color: "#789D99", letterSpacing: "0.1em", marginBottom: "6px" }}>
              ← 返事を送信中
            </div>
            {!simpleMode && (
              <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD", lineHeight: 1.8 }}>
                {packet.dstIp}:{packet.dstPort}<br />→ {packet.srcIp}:{packet.srcPort}
              </div>
            )}
          </>
        )}
      </div>

      {/* COMPLETION */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        opacity: isComplete ? 1 : 0, transition: "opacity 1s",
        pointerEvents: "none", zIndex: 18, padding: "0 24px",
      }}>
        <p style={{
          fontFamily: "'Noto Serif JP', serif", fontSize: "clamp(14px, 1.4vw, 18px)",
          fontWeight: 300, color: "#F1EFE8", lineHeight: 1.9, textAlign: "center", marginBottom: "14px",
        }}>
          お願いと返事の往復が完了しました
        </p>
        <div style={{
          fontSize: "11px", color: "#9CA8AD", lineHeight: 2, textAlign: "left",
          maxWidth: "280px", marginBottom: "14px",
        }}>
          <div>あなたがしたこと：<span style={{ color: "#F1EFE8" }}>状態確認を押した</span></div>
          <div>サーバーへのお願い：<span style={{ color: "#F1EFE8" }}>状態を教えて</span></div>
          <div>入口での確認：<span style={{ color: "#F1EFE8" }}>届いた通信を確認し、中へ通した</span></div>
          <div>戻ってきた返事：<span style={{ color: "#B89A6D" }}>正常です</span></div>
        </div>
        <p style={{ fontSize: "10px", color: "#9CA8AD", lineHeight: 1.8, textAlign: "center", fontWeight: 300 }}>
          画面上のひとつの操作も、届け先の情報を付けながら<br />
          ネットワークを進み、返事を受け取ることで完了します。
        </p>
        {!simpleMode && (
          <div style={{
            marginTop: "12px", padding: "8px 14px",
            border: "1px solid rgba(120,157,153,0.2)",
            fontSize: "9px", fontFamily: "monospace", color: "#9CA8AD",
            lineHeight: 1.9, textAlign: "center",
          }}>
            {packet.protocol}リクエスト {packet.srcIp}:{packet.srcPort} → {packet.dstIp}:{packet.dstPort}<br />
            XDP ingress · {packet.xdpAction}<br />
            HTTP Response 200 OK
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VOYAGE LOG
// ─────────────────────────────────────────────────────────────────────────────

const TIMELINE = [
  { label: "操作を検知",        tech: "L7 Application",       minIdx: 1 },
  { label: "送る準備をする",    tech: "L7→L1 encapsulation",  minIdx: 7 },
  { label: "ネットワークへ送信",tech: "TCP/IP送信",             minIdx: REQ_SAIL_IDX },
  { label: "入口で確認",        tech: "XDP ingress",           minIdx: XDP_IDX },
  { label: "お願いを受け取る",  tech: "L1→L7 decapsulation",  minIdx: 17 },
  { label: "サーバーが処理",    tech: "HTTP処理",              minIdx: SRV_PROC_IDX },
  { label: "返事を送り返す",    tech: "L7→L1 encapsulation",  minIdx: RESP_SAIL_IDX },
  { label: "返事が届く",        tech: "L1→L7 decapsulation",  minIdx: 34 },
];

function VoyageLog({ open, frameIdx, simpleMode, packet, webDemo }: {
  open: boolean; frameIdx: number; simpleMode: boolean; packet: PacketInfo; webDemo: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div style={{
      maxHeight: open ? "300px" : "0",
      overflow: "hidden",
      transition: "max-height 0.55s cubic-bezier(0.4,0,0.2,1)",
      background: "#0D1E2A", borderTop: open ? "1px solid rgba(120,157,153,0.15)" : "none",
    }}>
      <div style={{ padding: "16px 24px 24px", display: "flex", gap: "24px", overflow: "auto" }}>
        {/* Timeline */}
        <div style={{ flexShrink: 0, minWidth: "150px" }}>
          <div style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "10px" }}>
            経過
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {TIMELINE.map((t, i) => {
              const done = frameIdx >= t.minIdx;
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "7px" }}>
                  <div style={{
                    width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, marginTop: "4px",
                    background: done ? "#789D99" : "transparent",
                    border: `1px solid ${done ? "#789D99" : "rgba(120,157,153,0.3)"}`,
                  }} />
                  <div>
                    <div style={{ fontSize: "11px", color: done ? "#F1EFE8" : "#9CA8AD", opacity: done ? 1 : 0.45 }}>
                      {t.label}
                    </div>
                    {!simpleMode && (
                      <div style={{ fontSize: "8px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.45 }}>
                        {t.tech}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Packet summary */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "10px" }}>
            通信の中身
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: "14px" }}>
            {[
              ["送ったお願い",   "状態を教えて",     null],
              ["戻ってきた返事", "正常です",          null],
              [`担当部署ラベル（L4・${webDemo ? "デモ" : "観測"}）`, `${packet.srcPort} → ${packet.dstPort}`, `${packet.protocol} ポート番号`],
              [`宛先の住所（L3・${webDemo ? "デモ" : "観測"}）`, `${packet.srcIp} →\n${packet.dstIp}`, "IPアドレス"],
              ["入口での確認結果", "通してよい",      simpleMode ? null : packet.xdpAction],
              ["往復時間",         "—",               "未計測"],
            ].map(([k, v, sub]) => (
              <div key={k as string}>
                <div style={{ fontSize: "9px", letterSpacing: "0.16em", color: "#9CA8AD", textTransform: "uppercase", marginBottom: "2px" }}>
                  {k}
                </div>
                <div style={{ fontSize: "11px", color: "#F1EFE8", whiteSpace: "pre-line" }}>{v}</div>
                {sub && (
                  <div style={{ fontSize: "8px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.5 }}>{sub}</div>
                )}
              </div>
            ))}
          </div>

          <button onClick={() => setShowDetail(d => !d)} style={linkBtnStyle}>
            {showDetail ? "▲ 閉じる" : "▼ パケットの構造を見る"}
          </button>
          {showDetail && (
            <div style={{
              marginTop: "10px", padding: "10px 12px",
              background: "rgba(0,0,0,0.2)", borderLeft: "2px solid rgba(120,157,153,0.3)",
              fontSize: "10px", fontFamily: "monospace", color: "#9CA8AD", lineHeight: 2,
            }}>
              {simpleMode ? (
                <>
                  <div>近くの配送情報</div>
                  <div style={{ paddingLeft: "12px" }}>└ 端末の住所</div>
                  <div style={{ paddingLeft: "24px" }}>└ アプリ番号</div>
                  <div style={{ paddingLeft: "36px" }}>└ 状態を教えて</div>
                </>
              ) : (
                <>
                  <div>Ethernet フレーム（L2）</div>
                  <div style={{ paddingLeft: "12px" }}>└ IP パケット（{packet.srcIp} → {packet.dstIp}）（L3）</div>
                  <div style={{ paddingLeft: "24px" }}>└ {packet.protocol} セグメント（{packet.srcPort} → {packet.dstPort}）（L4）</div>
                  <div style={{ paddingLeft: "36px" }}>└ HTTP GET /status（L7）</div>
                  <div style={{ paddingLeft: "48px" }}>└ Payload: "状態確認"</div>
                </>
              )}
              <div style={{ marginTop: "6px", opacity: 0.5, fontSize: "9px" }}>
                ※ 通信モデル上の構造です。実際の観測値ではありません。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [frameIdx, setFrameIdx]           = useState(0);
  const [playing, setPlaying]             = useState(false);
  const [logOpen, setLogOpen]             = useState(false);
  const [simpleMode, setSimpleMode]       = useState(true);
  const [reqShipRight, setReqShipRight]   = useState(false);
  const [respShipLeft, setRespShipLeft]   = useState(false);
  const [packet, setPacket] = useState<PacketInfo>(DEFAULT_PACKET);
  const [streamStatus, setStreamStatus] = useState("waiting");
  const [pps, setPps] = useState(0);
  const [total, setTotal] = useState(0);

  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdxRef = useRef(0);
  const frameIdxRef = useRef(0);

  const frame      = FRAMES[frameIdx];
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

  // Auto-advance
  useEffect(() => {
    if (!playing) return;
    if (frame.dur === 0 || frameIdx >= FRAMES.length - 1) { setPlaying(false); return; }
    timerRef.current = setTimeout(() => setFrameIdx(i => i + 1), frame.dur);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [frameIdx, playing, frame.dur]);

  // Ship sailing trigger
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

  // Open log on complete
  useEffect(() => {
    if (!isComplete) return;
    const timer = window.setTimeout(() => setLogOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [isComplete]);

  function goTo(idx: number) {
    const t = Math.max(0, Math.min(FRAMES.length - 1, idx));
    if (t >= REQ_SAIL_IDX + 1)  setReqShipRight(true); else setReqShipRight(false);
    if (t >= RESP_SAIL_IDX + 1) setRespShipLeft(true); else setRespShipLeft(false);
    setFrameIdx(t); setPlaying(false);
  }

  function start() {
    if (isWebDemo()) {
      setPacket(current => ({ ...current, srcPort: 52000 + Math.floor(Math.random() * 800) }));
    }
    setFrameIdx(1); setReqShipRight(false); setRespShipLeft(false);
    setLogOpen(false); setPlaying(true);
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFrameIdx(0); setPlaying(false); setLogOpen(false);
    setReqShipRight(false); setRespShipLeft(false);
  }

  function togglePlay() {
    if (frameIdx === 0) { start(); return; }
    if (isComplete) { reset(); return; }
    setPlaying(p => !p);
  }

  const reqShipStyle: CSSProperties = {
    position: "absolute", width: "200px", height: "64px",
    bottom: "7%", left: reqShipRight ? "76%" : "3%",
    transition: frame.phase === "req-sail" && reqShipRight ? "left 4700ms cubic-bezier(0.3,0.05,0.45,1)" : "none",
    zIndex: 12, opacity: frame.ship === "req" ? 1 : 0, pointerEvents: "none",
  };

  const respShipStyle: CSSProperties = {
    position: "absolute", width: "200px", height: "64px",
    bottom: "7%", left: respShipLeft ? "3%" : "76%",
    transition: frame.phase === "resp-sail" && respShipLeft ? "left 4700ms cubic-bezier(0.3,0.05,0.45,1)" : "none",
    zIndex: 12, opacity: frame.ship === "resp" ? 1 : 0, pointerEvents: "none",
  };

  const labelBase: CSSProperties = {
    position: "absolute", bottom: "calc(7% + 68px)",
    width: "200px", textAlign: "center",
    pointerEvents: "none", zIndex: 13,
  };

  // Quick-jump buttons config
  const quickJumps = [
    { label: "お願いを作る",   sub: "req-gen",  idx: 1 },
    { label: "海を渡る",       sub: "req-sail", idx: REQ_SAIL_IDX },
    { label: "入口で確認",     sub: "XDP",      idx: XDP_IDX },
    { label: "返事を作る",     sub: "resp-gen", idx: SRV_PROC_IDX },
    { label: "戻ってくる",     sub: "resp-sail",idx: RESP_SAIL_IDX },
  ];

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      overflow: "hidden", background: "#0B2233", color: "#F1EFE8",
      fontFamily: "'Noto Sans JP', 'Inter', sans-serif",
    }}>
      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: "48px", flexShrink: 0,
        borderBottom: "1px solid rgba(120,157,153,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#789D99" strokeWidth="0.7" />
            <path d="M1 8 Q8 3.5 15 8" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <path d="M1 8 Q8 12.5 15 8" stroke="#789D99" strokeWidth="0.6" fill="none" />
            <line x1="8" y1="1" x2="8" y2="15" stroke="#789D99" strokeWidth="0.4" />
          </svg>
          <span style={{ fontSize: "11px", color: "#F1EFE8", fontWeight: 300 }}>Packet Journey</span>
          <span style={{ fontSize: "9px", letterSpacing: "0.14em", color: "#9CA8AD", opacity: 0.6 }}>通信の旅</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ fontSize: "8px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.65, letterSpacing: "0.08em" }}>
            {streamStatus.toUpperCase()} · {pps} PPS · {total} TOTAL
          </div>
          {/* Mode toggle */}
          <button
            onClick={() => setSimpleMode(m => !m)}
            style={{
              fontSize: "10px", letterSpacing: "0.1em",
              color: "#9CA8AD", background: "transparent",
              border: "1px solid rgba(120,157,153,0.3)",
              padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
              transition: "color 0.2s, border-color 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#F1EFE8"; e.currentTarget.style.borderColor = "rgba(120,157,153,0.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#9CA8AD"; e.currentTarget.style.borderColor = "rgba(120,157,153,0.3)"; }}
          >
            {simpleMode ? "技術名も見る" : "やさしく見る"}
          </button>

          {frame.phase !== "idle" && (
            <button onClick={reset}
              style={{
                fontSize: "9px", letterSpacing: "0.16em", color: "#9CA8AD",
                textTransform: "uppercase", background: "transparent",
                border: "none", cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#F1EFE8")}
              onMouseLeave={e => (e.currentTarget.style.color = "#9CA8AD")}
            >
              最初から
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
        <PortColumn side="client" frame={frame} simpleMode={simpleMode} packet={packet} />
        <SeaCenter
          frame={frame} packet={packet} webDemo={isWebDemo()} onLaunch={start}
          reqShipRight={reqShipRight} respShipLeft={respShipLeft}
          simpleMode={simpleMode}
        />
        <PortColumn side="server" frame={frame} simpleMode={simpleMode} packet={packet} />

        {/* Request ship */}
        <div style={reqShipStyle}><ShipSVG /></div>
        {frame.ship === "req" && (
          <div style={{
            ...labelBase,
            left: reqShipRight ? "76%" : "3%",
            transition: frame.phase === "req-sail" && reqShipRight ? "left 4700ms cubic-bezier(0.3,0.05,0.45,1)" : "none",
          }}>
            <div style={{ fontSize: "11px", color: "#F1EFE8", fontWeight: 300 }}>お願いを送信中</div>
            {!simpleMode && <div style={{ fontSize: "9px", color: "#B89A6D", letterSpacing: "0.12em", fontFamily: "monospace" }}>REQUEST</div>}
          </div>
        )}

        {/* Response ship */}
        <div style={respShipStyle}><ShipSVG flip /></div>
        {frame.ship === "resp" && (
          <div style={{
            ...labelBase,
            left: respShipLeft ? "3%" : "76%",
            transition: frame.phase === "resp-sail" && respShipLeft ? "left 4700ms cubic-bezier(0.3,0.05,0.45,1)" : "none",
          }}>
            <div style={{ fontSize: "11px", color: "#F1EFE8", fontWeight: 300 }}>返事を送信中</div>
            {!simpleMode && <div style={{ fontSize: "9px", color: "#789D99", letterSpacing: "0.12em", fontFamily: "monospace" }}>RESPONSE / 200 OK</div>}
          </div>
        )}
      </main>

      {/* ── CONTROL BAR ── */}
      <div style={{
        flexShrink: 0, height: "52px",
        borderTop: "1px solid rgba(120,157,153,0.15)",
        background: "#0D1E2A",
        display: "flex", alignItems: "center",
        padding: "0 16px", gap: "6px",
      }}>
        <button onClick={() => goTo(frameIdx - 1)} disabled={frameIdx <= 0} style={ctrlBtnSt(frameIdx <= 0)}>
          <SkipBack size={12} />
        </button>
        <button onClick={togglePlay} style={ctrlBtnSt(false, true)}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button onClick={() => goTo(frameIdx + 1)} disabled={frameIdx >= FRAMES.length - 1} style={ctrlBtnSt(frameIdx >= FRAMES.length - 1)}>
          <SkipForward size={12} />
        </button>

        {/* Progress */}
        <div style={{ flex: "0 0 80px", height: "2px", background: "rgba(120,157,153,0.15)", position: "relative", margin: "0 8px" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${(frameIdx / (FRAMES.length - 1)) * 100}%`,
            background: "#789D99", transition: "width 0.4s",
          }} />
        </div>

        {/* Step label */}
        <div style={{ fontSize: "11px", color: "#9CA8AD", minWidth: "140px", whiteSpace: "nowrap" }}>
          {frame.labelJa}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "4px", alignItems: "center" }}>
          {/* Quick jumps */}
          {quickJumps.map(q => (
            <button key={q.idx} onClick={() => goTo(q.idx)} style={{
              background: "transparent",
              border: "1px solid rgba(120,157,153,0.2)",
              color: "#9CA8AD", cursor: "pointer",
              padding: "3px 8px", fontFamily: "inherit",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "0",
            }}>
              <span style={{ fontSize: "9px", letterSpacing: "0.06em" }}>{q.label}</span>
              {!simpleMode && (
                <span style={{ fontSize: "7px", fontFamily: "monospace", color: "#9CA8AD", opacity: 0.5 }}>{q.sub}</span>
              )}
            </button>
          ))}

          {/* Log toggle */}
          <button
            onClick={() => setLogOpen(o => !o)}
            style={{ ...ctrlBtnSt(false), display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", marginLeft: "6px" }}>
            {logOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            <span style={{ fontSize: "9px", letterSpacing: "0.1em" }}>航海記録</span>
          </button>

          {isComplete && (
            <button onClick={start} style={{ ...ctrlBtnSt(false), display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px" }}>
              <RotateCcw size={11} />
              <span style={{ fontSize: "9px" }}>もう一度</span>
            </button>
          )}
        </div>
      </div>

      {/* ── VOYAGE LOG ── */}
      <VoyageLog open={logOpen} frameIdx={frameIdx} simpleMode={simpleMode} packet={packet} webDemo={isWebDemo()} />

      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ctrlBtnSt(disabled: boolean, primary?: boolean): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${primary ? "rgba(120,157,153,0.4)" : "rgba(120,157,153,0.2)"}`,
    color: disabled ? "rgba(156,168,173,0.28)" : "#9CA8AD",
    cursor: disabled ? "default" : "pointer",
    padding: "5px 7px",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "color 0.2s, border-color 0.2s",
    fontFamily: "inherit",
  };
}

const linkBtnStyle: CSSProperties = {
  fontSize: "9px", letterSpacing: "0.16em", color: "#9CA8AD",
  background: "transparent", border: "1px solid rgba(120,157,153,0.22)",
  padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
};
