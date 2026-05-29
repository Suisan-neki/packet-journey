// 画面A: バックエンド（XDP/eBPF）の凄さを魅せる技術デモ用ダッシュボード。
// Rust から `packet-event` / `stream-status` が降ってくる前提。
// Tauri が無い素のブラウザでも、デモデータで動作確認できるようにしてある。

// ---- DOM ----
const gaugeCanvas = document.getElementById("gauge");
const streamCanvas = document.getElementById("stream");
const ppsValueEl = document.getElementById("ppsValue");
const totalValueEl = document.getElementById("totalValue");
const peakValueEl = document.getElementById("peakValue");
const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const demoBtn = document.getElementById("demoBtn");
const flashEl = document.getElementById("flash");
const shieldEl = document.getElementById("shield");
const shieldTextEl = document.getElementById("shieldText");
const alertLogEl = document.getElementById("alertLog");
const barLegacy = document.getElementById("barLegacy");
const barEbpf = document.getElementById("barEbpf");
const legacyVal = document.getElementById("legacyVal");
const ebpfVal = document.getElementById("ebpfVal");

// ---- 状態 ----
const state = {
  targetPps: 0,
  dispPps: 0,
  total: 0,
  peak: 0,
  gaugeMax: 1000,
  drops: [],
  sampleCounter: 0,
  shieldTimer: null,
  realDataSeen: false,
};

const PROTO_COLOR = {
  TCP: "#2fa6ff",
  UDP: "#19f0c3",
  ICMP: "#ffd24a",
  OTHER: "#9b6bff",
};

const NICE_STEPS = [
  500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000,
];

function niceCeil(v) {
  for (const s of NICE_STEPS) if (v <= s) return s;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function fmt(n) {
  return Math.round(n).toLocaleString("en-US");
}

// ---- イベント処理（実データ・デモ共通の入口） ----
function handleEvent(ev) {
  if (!ev || typeof ev !== "object") return;
  switch (ev.type) {
    case "stats":
      onStats(ev);
      break;
    case "flow":
      onFlow(ev);
      break;
    case "alert":
      onAlert(ev);
      break;
  }
}

function onStats(ev) {
  state.targetPps = Math.max(0, Number(ev.pps) || 0);
  if (typeof ev.total === "number") state.total = ev.total;
  if (state.targetPps > state.peak) state.peak = state.targetPps;
  if (state.targetPps > state.gaugeMax * 0.92) {
    state.gaugeMax = niceCeil(state.targetPps * 1.2);
  }
  totalValueEl.textContent = fmt(state.total);
  peakValueEl.textContent = fmt(state.peak);
  updateBars(state.targetPps);
}

function onFlow(ev) {
  // 高 PPS のときは間引いて滝に流す（描画負荷を抑えつつ濁流感を出す）。
  const stride = Math.max(1, Math.floor(state.dispPps / 400));
  state.sampleCounter++;
  if (state.sampleCounter % stride !== 0) return;
  spawnDrop(ev);
}

function onAlert(ev) {
  fireFlash();
  raiseShield(ev.dst);
  pushAlertLog(ev);
}

// ---- アラート演出 ----
function fireFlash() {
  flashEl.classList.remove("fire");
  void flashEl.offsetWidth; // リフロー強制でアニメ再生
  flashEl.classList.add("fire");
}

function raiseShield(dst) {
  shieldEl.classList.remove("shield-ok");
  shieldEl.classList.add("shield-alarm");
  shieldTextEl.textContent = `警告：DDoS 攻撃検知（宛先 IP: ${dst ?? "?"}）`;
  if (state.shieldTimer) clearTimeout(state.shieldTimer);
  state.shieldTimer = setTimeout(() => {
    shieldEl.classList.remove("shield-alarm");
    shieldEl.classList.add("shield-ok");
    shieldTextEl.textContent = "SHIELD ONLINE — 異常なし";
  }, 5000);
}

function pushAlertLog(ev) {
  const empty = alertLogEl.querySelector(".alert-empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  li.className = "alert-new";
  const t = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  li.innerHTML = `<span class="a-time">${t}</span>DDoS 検知: dst=<b>${
    ev.dst ?? "?"
  }</b> — ${fmt(ev.rate ?? 0)} pkt/s が閾値を突破`;
  alertLogEl.prepend(li);
  while (alertLogEl.children.length > 30) alertLogEl.lastChild.remove();
}

// ---- CPU 比較バー ----
function updateBars(pps) {
  // 従来型は負荷がトラフィックに比例して跳ね上がる想定。
  const legacy = Math.min(96, 20 + pps / 80);
  // eBPF はカーネル内完結でほぼ横ばい。
  const ebpf = Math.min(5, 0.6 + pps / 6000);
  setBar(barLegacy, legacyVal, legacy);
  setBar(barEbpf, ebpfVal, ebpf);
}

function setBar(el, label, pct) {
  el.style.height = Math.min(100, (pct / 50) * 100) + "%";
  label.textContent = pct.toFixed(1) + "%";
}

// ---- パケットの滝 ----
function spawnDrop(ev) {
  const color = PROTO_COLOR[ev.protocol] || PROTO_COLOR.OTHER;
  const lastOctet = (ev.src || "").split(".").pop() || "?";
  state.drops.push({
    x: Math.random(),
    y: -0.05,
    vy: 0.45 + Math.random() * 0.55,
    color,
    label: `${ev.protocol || "?"} .${lastOctet}`,
  });
  if (state.drops.length > 220) state.drops.splice(0, state.drops.length - 220);
}

// ---- Canvas セットアップ（DPR 対応） ----
function fitCanvas(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = aspect ? cssW * aspect : canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

let gauge = fitCanvas(gaugeCanvas, 260 / 420);
let stream = fitCanvas(streamCanvas, 320 / 900);
window.addEventListener("resize", () => {
  gauge = fitCanvas(gaugeCanvas, 260 / 420);
  stream = fitCanvas(streamCanvas, 320 / 900);
});

function drawGauge() {
  const { ctx, w, h } = gauge;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.82;
  const r = Math.min(w * 0.45, h * 0.72);
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const frac = Math.min(1, state.dispPps / state.gaugeMax);

  // 背景アーク
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#13233a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.stroke();

  // 値アーク（緑→黄→赤のグラデ）
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#19f0c3");
  grad.addColorStop(0.6, "#ffd24a");
  grad.addColorStop(1, "#ff3b5c");
  ctx.strokeStyle = grad;
  ctx.shadowColor = frac > 0.8 ? "#ff3b5c" : "#2fa6ff";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep * frac);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 目盛り
  ctx.strokeStyle = "#33506f";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = start + (sweep * i) / 10;
    const r1 = r - 22;
    const r2 = r - 12;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
  }

  // 針
  const a = start + sweep * frac;
  ctx.strokeStyle = "#ffffff";
  ctx.shadowColor = "#2fa6ff";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 14, cy - Math.sin(a) * 14);
  ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ハブ
  ctx.fillStyle = "#cfe2ff";
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  // スケール表記
  ctx.fillStyle = "#6b809d";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("0", cx - r + 2, cy + 14);
  ctx.textAlign = "right";
  ctx.fillText(fmt(state.gaugeMax), cx + r - 2, cy + 14);
}

function drawStream(dt) {
  const { ctx, w, h } = stream;
  // 残像でトレイルを作る
  ctx.fillStyle = "rgba(4, 8, 15, 0.30)";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.font = "11px ui-monospace, monospace";
  const dropsToKeep = [];
  for (const d of state.drops) {
    d.y += d.vy * dt * 0.6;
    if (d.y > 1.1) continue;
    const px = 30 + d.x * (w - 60);
    const py = d.y * (h + 30) - 15;
    ctx.fillStyle = d.color;
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 8;
    ctx.fillText(d.label, px, py);
    ctx.shadowBlur = 0;
    dropsToKeep.push(d);
  }
  state.drops = dropsToKeep;
}

// ---- メインループ ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(3, (now - last) / 16.67);
  last = now;
  state.dispPps += (state.targetPps - state.dispPps) * 0.18;
  ppsValueEl.textContent = fmt(state.dispPps);
  drawGauge();
  drawStream(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 接続ステータス ----
function setStatus(payload) {
  const connected = !!(payload && payload.connected);
  statusPill.classList.toggle("status-on", connected);
  statusPill.classList.toggle("status-off", !connected);
  if (connected) {
    state.realDataSeen = true;
    statusText.textContent = `接続中 ${payload.addr ?? ""}`.trim();
  } else {
    statusText.textContent = "未接続（VM 起動待ち）";
  }
}

// ---- Tauri 連携 ----
const tauri = window.__TAURI__;
if (tauri && tauri.event && tauri.event.listen) {
  tauri.event.listen("packet-event", (e) => handleEvent(e.payload));
  tauri.event.listen("stream-status", (e) => setStatus(e.payload));
} else {
  statusText.textContent = "ブラウザ表示（Tauri 外）";
}

// ---- デモデータ ----
let demoTimer = null;
let demoBase = 600;
let demoTotal = 0;

function randIp() {
  return `192.168.${1 + Math.floor(Math.random() * 5)}.${Math.floor(
    Math.random() * 254,
  )}`;
}

function makeFlow() {
  const protos = ["TCP", "TCP", "TCP", "UDP", "ICMP", "OTHER"];
  return {
    type: "flow",
    protocol: protos[Math.floor(Math.random() * protos.length)],
    src: randIp(),
    dst: "10.0.0.20",
  };
}

function demoTick() {
  demoBase += (Math.random() - 0.5) * 280;
  demoBase = Math.max(150, Math.min(4500, demoBase));
  let pps = demoBase + (Math.random() - 0.5) * 300;
  if (Math.random() < 0.04) pps *= 3; // たまにスパイク
  pps = Math.max(0, Math.round(pps));
  demoTotal += Math.round(pps / 10);
  handleEvent({ type: "stats", pps, total: demoTotal });
  const drops = Math.min(24, Math.round(pps / 120));
  for (let i = 0; i < drops; i++) handleEvent(makeFlow());
  if (Math.random() < 0.025) {
    handleEvent({
      type: "alert",
      dst: randIp(),
      rate: 100 + Math.floor(Math.random() * 500),
    });
  }
}

demoBtn.addEventListener("click", () => {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
    demoBtn.classList.remove("on");
    demoBtn.textContent = "デモデータ: OFF";
  } else {
    demoTimer = setInterval(demoTick, 100);
    demoBtn.classList.add("on");
    demoBtn.textContent = "デモデータ: ON";
  }
});
