import { useEffect, useMemo, useState } from "react";
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

  return (
    <div className="demo-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-ship"><ShipMark /></div>
          <div>
            <div className="brand-name">PACKET HARBOR</div>
            <div className="brand-sub">Raspberry Pi × Rust × eBPF/XDP</div>
          </div>
        </div>

        <div className="run-state">
          <div className="state-item">
            <span>表示</span>
            <strong>{demo ? "SAMPLE" : "LIVE"}</strong>
          </div>
          <div className="state-item">
            <span>防御モード</span>
            <strong className={modeIsProtect ? "text-drop" : ""}>{harbor.mode.toUpperCase()}</strong>
          </div>
          <div className="state-item">
            <span>接続</span>
            <strong>{streamStatus.toUpperCase()}</strong>
          </div>
        </div>
      </header>

      <div className="truth-note">
        {demo
          ? "公開ページは実機出力の表示例です。LIVE版では、以下の数値を2台のRaspberry PiとXDPから受信します。"
          : "この画面は、2台のRaspberry PiとXDPから受信した実測値だけで更新されています。"}
      </div>

      <main>
        <section className="answer">
          <div className="answer-label">この実験から、いま分かること</div>
          <h1>{conclusion}</h1>
          <p>
            左から順に、<strong>送った通信</strong>、<strong>カーネル入口の判断</strong>、
            <strong>サービスへの影響</strong>を確認してください。
          </p>
        </section>

        <section className="causal-flow" aria-label="実験の因果関係">
          <article className="stage stage--input">
            <header className="stage-head">
              <span className="step-number">1</span>
              <div>
                <p>INPUT</p>
                <h2>何を送ったか</h2>
              </div>
            </header>

            <div className="source-node">
              <strong>Raspberry Pi A</strong>
              <span>traffic-node</span>
            </div>

            <div className="traffic-line traffic-line--normal">
              <div>
                <span>通常通信</span>
                <strong>HTTP / TCP :8080</strong>
              </div>
              <em>{harbor.healthSuccess ? "送信中" : "応答待ち"}</em>
            </div>

            <div className="traffic-line traffic-line--attack">
              <div>
                <span>負荷通信</span>
                <strong>UDP :{harbor.attackPort}</strong>
              </div>
              <em>{harbor.attackActive ? `${formatCount(harbor.attackPps)} pps` : "停止中"}</em>
            </div>

            <dl className="detail-list">
              <div><dt>送信済みUDP</dt><dd>{formatCount(harbor.attackPackets)} packets</dd></div>
              <div><dt>送信先</dt><dd>{harbor.target}</dd></div>
            </dl>

            <p className="stage-source">
              取得元: <code>traffic-node</code> の <code>attack_state</code>
            </p>
          </article>

          <div className="flow-arrow" aria-hidden="true">
            <span>NICへ到着</span>
            <i />
          </div>

          <article className="stage stage--xdp">
            <header className="stage-head">
              <span className="step-number">2</span>
              <div>
                <p>DECISION</p>
                <h2>XDPがどう判断したか</h2>
              </div>
            </header>

            <div className="hook-position">
              <span>NIC</span>
              <i />
              <strong>XDP HOOK</strong>
              <i />
              <span>Linux network stack</span>
            </div>

            <div className="mode-reading">
              <span>現在のポリシー</span>
              <strong>{modeIsProtect ? "指定UDPを入口で破棄" : "観測して通過"}</strong>
              <code>{modeIsProtect ? "XDP_DROP" : "XDP_PASS"}</code>
            </div>

            <div className="counter-grid">
              <div>
                <span>入口の流量</span>
                <strong>{formatCount(harbor.pps)} <small>pps</small></strong>
              </div>
              <div className="counter-pass">
                <span>通過</span>
                <strong>{formatCount(harbor.passed)}</strong>
                <small>XDP_PASS</small>
              </div>
              <div className="counter-drop">
                <span>遮断</span>
                <strong>{formatCount(harbor.dropped)}</strong>
                <small>XDP_DROP / {dropRatio.toFixed(1)}%</small>
              </div>
            </div>

            <p className="technical-note">
              パケットがソケットやアプリへ届く前のXDPフックで判定。
              カウンタは<strong>per-CPU BPF map</strong>から集計します。
            </p>
            <p className="stage-source">
              取得元: XDPプログラムの <code>stats</code>
            </p>
          </article>

          <div className="flow-arrow" aria-hidden="true">
            <span>通過分のみ</span>
            <i />
          </div>

          <article className="stage stage--result">
            <header className="stage-head">
              <span className="step-number">3</span>
              <div>
                <p>OUTCOME</p>
                <h2>サービスは維持できたか</h2>
              </div>
            </header>

            <div className={`service-result ${harbor.healthSuccess ? "service-result--up" : "service-result--down"}`}>
              <span>Raspberry Pi B / HTTP :8080</span>
              <strong>{harbor.healthSuccess ? "応答を維持" : "応答なし"}</strong>
            </div>

            <div className="http-reading">
              <div>
                <span>HTTP status</span>
                <strong>{harbor.statusCode ?? "—"}</strong>
              </div>
              <div>
                <span>応答時間</span>
                <strong>{hasLatency ? harbor.latencyMs : "—"} <small>ms</small></strong>
              </div>
            </div>

            <LatencyTrace values={latencies} />
            <p className="trace-caption">直近30回のHTTP GET応答時間</p>

            <p className="technical-note">
              UDP負荷とは別にHTTP GETを継続し、遮断中も本来のサービスが応答できるか確認します。
            </p>
            <p className="stage-source">
              取得元: <code>traffic-node</code> の <code>traffic_health</code>
            </p>
          </article>
        </section>

        <section className="reading-guide">
          <div className="guide-title">
            <span>TECHNICAL READING</span>
            <h2>数値が証明していること</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>観測値</th>
                <th>取得場所</th>
                <th>この値から分かること</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>UDP pps / packets</td>
                <td>送信側 Raspberry Pi</td>
                <td>負荷通信を実際に生成している</td>
              </tr>
              <tr>
                <td>XDP_PASS / XDP_DROP</td>
                <td>受信側カーネルのper-CPU BPF map</td>
                <td>入口で通過・破棄した実パケット数</td>
              </tr>
              <tr>
                <td>HTTP status / latency</td>
                <td>送信側から受信側へのHTTP GET</td>
                <td>防御中も本来のサービスが利用可能か</td>
              </tr>
            </tbody>
          </table>

          <div className="mode-comparison">
            <div className={!modeIsProtect ? "is-current" : ""}>
              <span>MONITOR</span>
              <strong>観測する</strong>
              <p>統計を取り、パケットはサーバーへ通過させる。</p>
            </div>
            <div className={modeIsProtect ? "is-current" : ""}>
              <span>PROTECT</span>
              <strong>入口で止める</strong>
              <p>指定UDPをXDP_DROPし、アプリへ到達させない。</p>
            </div>
          </div>
        </section>

        <section className="event-log">
          <div>
            <span>RECENT EVENTS</span>
            <h2>直近の状態変化</h2>
          </div>
          <ol>
            {logs.map(entry => (
              <li key={entry.id} className={`log--${entry.tone}`}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

