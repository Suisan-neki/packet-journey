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

export default function App() {
  const demo = isWebDemo();
  const [streamStatus, setStreamStatus] = useState(demo ? "demo" : "waiting");
  const [harbor, setHarbor] = useState<HarborState>(demo ? DEMO_STATE : INITIAL_STATE);
  const [latencies, setLatencies] = useState<number[]>(demo ? [18, 15, 16, 14, 15, 13, 14] : []);
  const [showDetails, setShowDetails] = useState(false);
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
      ].slice(0, 4),
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
          if (!success) addLog("通常HTTPの応答が途切れました。", "warn");
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
          addLog(active ? "UDP負荷通信を開始しました。" : "UDP負荷通信を停止しました。", active ? "warn" : "quiet");
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
              ? "PROTECTへ変更。指定UDPをXDP_DROPします。"
              : "MONITORへ変更。パケットを観測して通過させます。",
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDetails(false);
      if (event.key.toLowerCase() === "d") setShowDetails(current => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const modeIsProtect = harbor.mode === "protect";
  const dropRatio = harbor.total > 0 ? (harbor.dropped / harbor.total) * 100 : 0;
  const hasLatency = harbor.latencyMs > 0;
  const conclusion = harbor.attackActive
    ? modeIsProtect
      ? harbor.healthSuccess
        ? `指定UDPをXDPで遮断中。HTTPは${harbor.statusCode ?? "—"} / ${harbor.latencyMs || "—"}msで応答しています。`
        : "指定UDPをXDPで遮断中ですが、HTTP応答を確認できません。"
      : "UDP負荷を観測しています。MONITORでは遮断せず、サーバーへ通過させます。"
    : harbor.healthSuccess
      ? `UDP負荷は停止中。HTTPは${harbor.statusCode ?? "—"} / ${harbor.latencyMs || "—"}msで応答しています。`
      : "UDP負荷は停止中。HTTP応答を待っています。";

  const serviceMaintained = harbor.healthSuccess;
  const phase = !harbor.healthSuccess
    ? 0
    : !harbor.attackActive
      ? 1
      : !modeIsProtect
        ? 2
        : 3;

  return (
    <div className="booth-app">
      <header className="booth-header">
        <div className="brand">
          <div className="brand-ship"><ShipMark /></div>
          <div>
            <div className="brand-name">PACKET HARBOR</div>
            <div className="brand-sub">Raspberry Pi × Rust × eBPF/XDP</div>
          </div>
        </div>

        <div className="header-status">
          <span className={demo ? "sample-badge" : "live-badge"}>{demo ? "SAMPLE" : "LIVE"}</span>
          <div><small>MODE</small><strong>{harbor.mode.toUpperCase()}</strong></div>
          <div><small>STREAM</small><strong>{streamStatus.toUpperCase()}</strong></div>
          <button type="button" onClick={() => setShowDetails(true)}>技術詳細 <kbd>D</kbd></button>
        </div>
      </header>

      <div className="sample-notice">
        {demo
          ? "表示中の数値は実機デモの出力例です"
          : "2台のRaspberry PiとXDPから受信した実測値です"}
      </div>

      <main className="booth-screen">
        <section className={`verdict ${serviceMaintained ? "verdict--success" : "verdict--failure"}`}>
          <div className="verdict-label">いま起きていること</div>
          <h1>
            <span>不要な通信を入口で止め、</span>
            <strong>必要なサービスを守っています。</strong>
          </h1>
          <div className="verdict-state">
            <span>{serviceMaintained ? "SERVICE UP" : "CHECKING"}</span>
            <strong>{harbor.statusCode ?? "—"} <small>/ {harbor.latencyMs || "—"} ms</small></strong>
          </div>
        </section>

        <ol className="phase-strip" aria-label="デモの進行状況">
          {[
            ["1", "通常通信を確認"],
            ["2", "UDP負荷を開始"],
            ["3", "入口で遮断"],
            ["4", "HTTP応答を確認"],
          ].map(([number, label], index) => (
            <li key={number} className={index <= phase ? "is-complete" : ""}>
              <span>{number}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>

        <section className="live-experiment" aria-label="通信経路">
          <div className="experiment-heading">
            <span>LIVE PACKET PATH</span>
            <h2>同じ入口を通る、2種類の通信</h2>
          </div>

          <div className="path-board">
            <div className="path-row path-row--udp">
              <div className="path-source">
                <small>Raspberry Pi A</small>
                <strong>不要なUDP負荷</strong>
                <em>{harbor.attackActive ? `${formatCount(harbor.attackPps)} pps` : "停止中"}</em>
              </div>
              <div className="moving-line moving-line--udp" aria-hidden="true">
                {Array.from({ length: 9 }).map((_, index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
              </div>
              <div className="xdp-checkpoint">
                <small>Raspberry Pi B</small>
                <strong>XDP</strong>
                <span>{modeIsProtect ? "入口で判定" : "観測中"}</span>
              </div>
              <div className="blocked-line" aria-hidden="true"><i /><b>×</b></div>
              <div className="path-result path-result--blocked">
                <small>アプリへ届く前に</small>
                <strong>{modeIsProtect ? "遮断" : "通過"}</strong>
                <em>{formatCount(harbor.dropped)} packets</em>
              </div>
            </div>

            <div className="path-row path-row--http">
              <div className="path-source">
                <small>Raspberry Pi A</small>
                <strong>必要なHTTP通信</strong>
                <em>TCP :8080</em>
              </div>
              <div className="moving-line moving-line--http" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
              </div>
              <div className="xdp-checkpoint xdp-checkpoint--pass">
                <small>同じ入口</small>
                <strong>XDP</strong>
                <span>必要な通信は通過</span>
              </div>
              <div className="passed-line" aria-hidden="true"><i /><b>→</b></div>
              <div className="path-result path-result--service">
                <small>HTTPサービス</small>
                <strong>{harbor.healthSuccess ? "稼働中" : "応答待ち"}</strong>
                <em>{harbor.statusCode ?? "—"} / {harbor.latencyMs || "—"} ms</em>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-bar" aria-label="結論を支える実測値">
          <div className="proof-intro">
            <span>この3つが証拠です</span>
            <strong>演出ではなく、実測値</strong>
          </div>
          <div className="proof-item proof-item--load">
            <span>送った負荷</span>
            <strong>{formatCount(harbor.attackPps)} <small>pps</small></strong>
            <em>traffic-node</em>
          </div>
          <div className="proof-arrow" aria-hidden="true">→</div>
          <div className="proof-item proof-item--drop">
            <span>入口で遮断</span>
            <strong>{dropRatio.toFixed(1)}<small>%</small></strong>
            <em>XDP_DROP / per-CPU map</em>
          </div>
          <div className="proof-arrow" aria-hidden="true">→</div>
          <div className="proof-item proof-item--health">
            <span>サービスの応答</span>
            <strong>{harbor.statusCode ?? "—"} <small>/ {harbor.latencyMs || "—"}ms</small></strong>
            <em>実HTTP GET</em>
          </div>
        </section>
      </main>

      {showDetails && (
        <div className="details-backdrop" role="presentation" onMouseDown={() => setShowDetails(false)}>
          <section
            className="details-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="details-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <header>
              <div><span>TECHNICAL DETAILS</span><h2 id="details-title">このデモが実際に測っているもの</h2></div>
              <button type="button" onClick={() => setShowDetails(false)}>閉じる <kbd>Esc</kbd></button>
            </header>

            <div className="details-grid">
              <article>
                <span>構成</span>
                <h3>Raspberry Pi 2台</h3>
                <p>Pi Aの<code>traffic-node</code>がUDP負荷とHTTP GETを送信。Pi BがXDPで受信時に判定します。</p>
              </article>
              <article>
                <span>遮断位置</span>
                <h3>アプリより手前</h3>
                <div className="mini-path"><b>NIC</b><i />XDP<i />network stack<i />app</div>
                <p>指定UDPはソケットやアプリケーションへ届く前に<code>XDP_DROP</code>されます。</p>
              </article>
              <article>
                <span>カウンタ</span>
                <h3>per-CPU BPF map</h3>
                <dl>
                  <div><dt>XDP_PASS</dt><dd>{formatCount(harbor.passed)}</dd></div>
                  <div><dt>XDP_DROP</dt><dd>{formatCount(harbor.dropped)}</dd></div>
                  <div><dt>入口の流量</dt><dd>{formatCount(harbor.pps)} pps</dd></div>
                </dl>
              </article>
              <article>
                <span>サービス確認</span>
                <h3>実際のHTTP GET</h3>
                <p>UDP負荷とは別にHTTP :8080へ継続アクセスし、statusとlatencyを測定します。</p>
                <LatencyTrace values={latencies} />
              </article>
              <article>
                <span>モード</span>
                <h3>MONITOR / PROTECT</h3>
                <p><code>MONITOR</code>は観測して通過。<code>PROTECT</code>は指定UDPを入口で破棄します。</p>
              </article>
              <article>
                <span>直近のイベント</span>
                <h3>Event stream</h3>
                <ol className="details-log">
                  {logs.slice(0, 3).map(entry => (
                    <li key={entry.id}><time>{entry.time}</time><span>{entry.message}</span></li>
                  ))}
                </ol>
              </article>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
