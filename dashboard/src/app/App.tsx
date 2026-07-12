import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { isWebDemo, subscribeStream } from "../stream.js";

type HarborMode = "monitor" | "protect";

interface HarborEvent {
  type?: string;
  mode?: string;
  pps?: number;
  total?: number;
  pass?: number;
  drop?: number;
  success?: boolean;
  latency_ms?: number;
  status_code?: number;
  active?: boolean;
  packets_sent?: number;
  target?: string;
  dst_port?: number;
  protocol?: string;
  action?: string;
  src?: string;
  src_port?: number;
  dst?: string;
}

interface HarborState {
  mode: HarborMode;
  pps: number;
  total: number;
  passed: number;
  dropped: number;
  healthSuccess: boolean;
  latencyMs: number;
  statusCode: number | null;
  attackActive: boolean;
  attackPps: number;
  attackPackets: number;
  attackPort: number;
  target: string;
}

interface LogEntry {
  id: number;
  time: string;
  message: string;
  tone: "quiet" | "pass" | "drop" | "warn";
}

const DEMO_STATE: HarborState = {
  mode: "protect",
  pps: 1874,
  total: 148620,
  passed: 6254,
  dropped: 142366,
  healthSuccess: true,
  latencyMs: 14,
  statusCode: 200,
  attackActive: true,
  attackPps: 1832,
  attackPackets: 98420,
  attackPort: 4000,
  target: "192.168.1.10",
};

const INITIAL_STATE: HarborState = {
  mode: "monitor",
  pps: 0,
  total: 0,
  passed: 0,
  dropped: 0,
  healthSuccess: false,
  latencyMs: 0,
  statusCode: null,
  attackActive: false,
  attackPps: 0,
  attackPackets: 0,
  attackPort: 4000,
  target: "192.168.1.10",
};

function nowLabel() {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ja-JP").format(Math.max(0, Math.round(value)));
}

function ShipMark() {
  return (
    <svg viewBox="0 0 220 72" aria-hidden="true">
      <path d="M10 44 Q16 57 28 60 L192 60 Q204 57 210 44 Z" className="ship-hull" />
      <rect x="26" y="37" width="168" height="7" className="ship-deck" />
      <rect x="128" y="20" width="42" height="17" className="ship-cabin" />
      <rect x="133" y="24" width="6" height="4" className="ship-window" />
      <rect x="143" y="24" width="6" height="4" className="ship-window" />
      <rect x="153" y="24" width="6" height="4" className="ship-window" />
      <rect x="160" y="8" width="8" height="13" className="ship-stack" />
      <line x1="116" y1="8" x2="116" y2="37" className="ship-mast" />
      <rect x="32" y="28" width="24" height="9" className="cargo cargo--sand" />
      <rect x="60" y="28" width="24" height="9" className="cargo cargo--green" />
      <rect x="88" y="28" width="24" height="9" className="cargo cargo--dim" />
    </svg>
  );
}

function LatencyTrace({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (values.length === 0) return "";
    const max = Math.max(80, ...values);
    return values
      .map((value, index) => {
        const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100;
        const y = 34 - Math.min(30, (value / max) * 30);
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);

  return (
    <svg className="latency-trace" viewBox="0 0 100 38" preserveAspectRatio="none" aria-label="直近のHTTP応答時間">
      <line x1="0" y1="34" x2="100" y2="34" />
      {points && <polyline points={points} />}
    </svg>
  );
}

function Meter({
  label,
  value,
  unit,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone?: "plain" | "pass" | "drop";
}) {
  return (
    <section className={`meter meter--${tone}`}>
      <div className="meter-label">{label}</div>
      <div className="meter-reading">
        <span>{value}</span>
        {unit && <small>{unit}</small>}
      </div>
      <div className="meter-note">{note}</div>
    </section>
  );
}

export default function App() {
  const demo = isWebDemo();
  const [streamStatus, setStreamStatus] = useState(demo ? "demo" : "waiting");
  const [harbor, setHarbor] = useState<HarborState>(demo ? DEMO_STATE : INITIAL_STATE);
  const [latencies, setLatencies] = useState<number[]>(demo ? [18, 15, 16, 14, 15, 13, 14] : []);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 1,
      time: "--:--:--",
      message: demo
        ? "WEB展示見本を表示しています。数値は実機の出力例です。"
        : "観測ノードからの接続を待っています。",
      tone: "quiet",
    },
  ]);

  function addLog(message: string, tone: LogEntry["tone"] = "quiet") {
    setLogs(current =>
      [
        {
          id: Date.now() + Math.random(),
          time: nowLabel(),
          message,
          tone,
        },
        ...current,
      ].slice(0, 6),
    );
  }

  useEffect(() => {
    let disposed = false;
    let unsubscribe: undefined | (() => void);

    void subscribeStream({
      onStatus: status => {
        if (!disposed) setStreamStatus(status);
      },
      onEvent: raw => {
        if (disposed) return;
        const event = raw as HarborEvent;

        if (event.type === "stats") {
          setHarbor(current => ({
            ...current,
            mode: event.mode === "protect" ? "protect" : event.mode === "monitor" ? "monitor" : current.mode,
            pps: Number(event.pps ?? current.pps),
            total: Number(event.total ?? current.total),
            passed: Number(event.pass ?? current.passed),
            dropped: Number(event.drop ?? current.dropped),
          }));
          return;
        }

        if (event.type === "traffic_health") {
          const latency = Number(event.latency_ms ?? 0);
          const success = Boolean(event.success);
          setHarbor(current => ({
            ...current,
            healthSuccess: success,
            latencyMs: latency,
            statusCode: event.status_code == null ? null : Number(event.status_code),
          }));
          setLatencies(current => [...current, latency].slice(-30));
          if (!success) addLog("通常航路のHTTP応答が途切れました。", "warn");
          return;
        }

        if (event.type === "attack_state") {
          const active = Boolean(event.active);
          setHarbor(current => ({
            ...current,
            attackActive: active,
            attackPps: Number(event.pps ?? 0),
            attackPackets: Number(event.packets_sent ?? current.attackPackets),
            attackPort: Number(event.dst_port ?? current.attackPort),
            target: event.target ?? current.target,
          }));
          addLog(active ? "負荷航路からUDP通信が流れ始めました。" : "UDP負荷通信が停止しました。", active ? "warn" : "quiet");
          return;
        }

        if (event.type === "defense_mode") {
          const mode: HarborMode = event.mode === "protect" ? "protect" : "monitor";
          setHarbor(current => ({
            ...current,
            mode,
            attackPort: Number(event.dst_port ?? current.attackPort),
          }));
          addLog(
            mode === "protect"
              ? "港門を閉じました。指定UDPをカーネル入口で遮断します。"
              : "港門を開きました。通信を観測のみ行います。",
            mode === "protect" ? "drop" : "quiet",
          );
          return;
        }

        if (event.type === "flow" && (event.action === "DROP" || event.protocol === "TCP")) {
          const route = `${event.src ?? "?"}:${event.src_port ?? "?"} → ${event.dst ?? "?"}:${event.dst_port ?? "?"}`;
          addLog(
            `${event.protocol ?? "IP"} ${route} / ${event.action ?? "PASS"}`,
            event.action === "DROP" ? "drop" : "pass",
          );
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

  const modeIsProtect = harbor.mode === "protect";
  const healthLabel = harbor.healthSuccess ? "応答あり" : "応答なし";
  const dropRatio = harbor.total > 0 ? (harbor.dropped / harbor.total) * 100 : 0;
  const sceneClass = [
    "harbor-scene",
    harbor.attackActive ? "is-under-load" : "",
    modeIsProtect ? "is-protecting" : "is-monitoring",
    harbor.healthSuccess ? "health-up" : "health-down",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="harbor-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="brand-name">PACKET HARBOR</div>
            <div className="brand-sub">通信を守る港</div>
          </div>
        </div>

        <div className="mode-indicator" aria-label={`現在の防御モード: ${harbor.mode}`}>
          <span className="mode-title">XDP GATE</span>
          <div className="mode-scale">
            <span>MONITOR</span>
            <i className={modeIsProtect ? "at-protect" : "at-monitor"} />
            <span>PROTECT</span>
          </div>
        </div>

        <div className="connection">
          <span className={`connection-lamp connection-lamp--${streamStatus}`} />
          <div>
            <div>{demo ? "WEB展示見本" : "実機観測"}</div>
            <small>{streamStatus.toUpperCase()}</small>
          </div>
        </div>
      </header>

      <div className="truth-strip">
        <strong>{demo ? "SAMPLE" : "LIVE"}</strong>
        <span>
          {demo
            ? "この画面の数値は表示見本です。実機版ではRaspberry PiとXDPのイベントだけを表示します。"
            : "画面上の数値はRaspberry PiとXDPから届いた実測値です。"}
        </span>
      </div>

      <main className={sceneClass}>
        <section className="harbor-intro">
          <p className="eyebrow">INGRESS OBSERVATION / XDP</p>
          <h1>見えない通信は、<br />港の入口で選別される。</h1>
          <p className="intro-copy">
            正常なHTTPは通す。負荷UDPは入口で止める。<br />
            ここで動くものは、すべて実際のパケットに結びついています。
          </p>
        </section>

        <section className="route-map" aria-label="通信経路">
          <div className="route-side route-side--sender">
            <span className="side-index">A</span>
            <div className="side-name">送信側</div>
            <div className="side-device">Raspberry Pi</div>
            <div className="side-address">traffic-node</div>
          </div>

          <div className="water">
            <svg className="water-lines" viewBox="0 0 900 280" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 62 Q75 46 150 62 T300 62 T450 62 T600 62 T750 62 T900 62" />
              <path d="M0 192 Q75 176 150 192 T300 192 T450 192 T600 192 T750 192 T900 192" />
              <path d="M0 250 Q110 234 220 250 T440 250 T660 250 T880 250" />
            </svg>

            <div className="route route--normal">
              <div className="route-label">
                <strong>通常航路</strong>
                <span>HTTP / TCP :8080</span>
              </div>
              <div className="route-rule" />
              <div className="normal-vessel"><ShipMark /></div>
              <div className="route-result route-result--normal">
                <span>{healthLabel}</span>
                <strong>{harbor.latencyMs || "—"}<small>ms</small></strong>
              </div>
            </div>

            <div className="route route--attack">
              <div className="route-label">
                <strong>負荷航路</strong>
                <span>UDP :{harbor.attackPort}</span>
              </div>
              <div className="route-rule" />
              <div className="attack-stream" aria-hidden="true">
                {Array.from({ length: 18 }).map((_, index) => (
                  <i
                    key={index}
                    style={{ "--packet-index": index } as CSSProperties}
                  />
                ))}
              </div>
              {modeIsProtect && harbor.attackActive && (
                <div className="stopped-packets" aria-hidden="true">
                  {Array.from({ length: 7 }).map((_, index) => <i key={index} />)}
                </div>
              )}
              <div className="route-result route-result--attack">
                <span>{modeIsProtect ? "入口で遮断" : "観測して通過"}</span>
                <strong>{formatCount(harbor.attackPps)}<small>pps</small></strong>
              </div>
            </div>

            <div className="xdp-gate" aria-label={modeIsProtect ? "XDP防御中" : "XDP観測中"}>
              <div className="gate-tower">
                <span>XDP</span>
                <strong>{modeIsProtect ? "防御" : "観測"}</strong>
              </div>
              <div className="gate-bars">
                {Array.from({ length: 6 }).map((_, index) => <i key={index} />)}
              </div>
              <div className="gate-foot">KERNEL INGRESS</div>
            </div>
          </div>

          <div className="route-side route-side--server">
            <span className="side-index">B</span>
            <div className="side-name">守られる側</div>
            <div className="side-device">Raspberry Pi</div>
            <div className="side-address">{harbor.target}</div>
          </div>
        </section>
      </main>

      <section className="instrument-deck">
        <div className="latency-panel">
          <div className="instrument-heading">
            <span>HTTP RESPONSE</span>
            <strong>{harbor.healthSuccess ? "航路維持" : "応答断"}</strong>
          </div>
          <LatencyTrace values={latencies} />
          <div className="trace-caption">直近30回の応答時間 / {harbor.statusCode ?? "—"} STATUS</div>
        </div>

        <Meter label="現在の流量" value={formatCount(harbor.pps)} unit="pps" note="XDP入口で観測" />
        <Meter label="通過" value={formatCount(harbor.passed)} note="XDP_PASS" tone="pass" />
        <Meter label="遮断" value={formatCount(harbor.dropped)} note={`XDP_DROP / ${dropRatio.toFixed(1)}%`} tone="drop" />

        <div className="logbook">
          <div className="instrument-heading">
            <span>HARBOR LOG</span>
            <strong>航海日誌</strong>
          </div>
          <ol>
            {logs.map(entry => (
              <li key={entry.id} className={`log--${entry.tone}`}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
