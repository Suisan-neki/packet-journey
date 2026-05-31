import { listen } from "@tauri-apps/api/event";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "接続中",
  disconnected: "切断",
  demo: "デモ",
};

const state = {
  pps: 0,
  total: 0,
  alerts: 0,
  flows: [],
  status: "waiting",
  demo: false,
  demoTimer: null,
  lastProtocol: "—",
};

const protocolColors = {
  TCP: "#28c76f",
  UDP: "#00cfe8",
  ICMP: "#ff9f43",
  OTHER: "#8392a5",
};

const els = {};

function cacheElements() {
  els.status = document.querySelector("#stream-status");
  els.statusDot = document.querySelector("#stream-dot");
  els.demoToggle = document.querySelector("#demo-toggle");
  els.ppsValue = document.querySelector("#pps-value");
  els.totalValue = document.querySelector("#total-value");
  els.protocolValue = document.querySelector("#protocol-value");
  els.alertCount = document.querySelector("#alert-count");
  els.flowCount = document.querySelector("#flow-count");
  els.alertLog = document.querySelector("#alert-log");
  els.flash = document.querySelector("#attack-flash");
  els.meter = document.querySelector("#pps-meter");
  els.waterfall = document.querySelector("#waterfall");
}

function setStatus(status) {
  const key = state.demo ? "demo" : status;
  state.status = key;
  els.status.textContent = STATUS_LABELS[key] ?? key;
  els.statusDot.className = `status-dot ${key}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function handleEvent(event) {
  if (event.type === "stats") {
    state.pps = Number(event.pps ?? 0);
    state.total = Number(event.total ?? state.total);
    updateStats();
    return;
  }

  if (event.type === "alert") {
    state.alerts += 1;
    addAlert(event);
    updateStats();
    return;
  }

  if (event.type === "flow") {
    state.total += 1;
    state.lastProtocol = event.protocol ?? "OTHER";
    state.flows.push({
      protocol: state.lastProtocol,
      src: event.src ?? "0.0.0.0",
      dst: event.dst ?? "0.0.0.0",
      srcPort: event.src_port ?? 0,
      dstPort: event.dst_port ?? 0,
      at: performance.now(),
    });
    state.flows = state.flows.slice(-140);
    updateStats();
  }
}

function updateStats() {
  els.ppsValue.textContent = formatNumber(state.pps);
  els.totalValue.textContent = formatNumber(state.total);
  els.protocolValue.textContent = state.lastProtocol;
  els.alertCount.textContent = formatNumber(state.alerts);
  els.flowCount.textContent = `${formatNumber(state.flows.length)} 件`;
}

function addAlert(event) {
  els.flash.classList.remove("active");
  void els.flash.offsetWidth;
  els.flash.classList.add("active");

  const item = document.createElement("div");
  item.className = "alert-item";
  const target = event.dst ?? "不明";
  const rate = formatNumber(event.rate ?? 0);
  item.innerHTML = `<strong>${target}</strong><span>${rate} PPS で超過</span>`;
  els.alertLog.prepend(item);

  while (els.alertLog.children.length > 5) {
    els.alertLog.lastElementChild.remove();
  }
}

function fitCanvasToDisplay(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function setupCanvasSizing() {
  const resize = () => {
    fitCanvasToDisplay(els.meter);
    fitCanvasToDisplay(els.waterfall);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(els.meter);
  observer.observe(els.waterfall);
}

function drawMeter() {
  const canvas = els.meter;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height * 0.82;
  const radius = Math.min(width * 0.42, height * 0.74);
  const maxPps = 1000;
  const ratio = Math.min(state.pps / maxPps, 1);
  const start = Math.PI;
  const end = Math.PI * 2;
  const angle = start + ratio * Math.PI;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(10, Math.round(height * 0.08));

  ctx.beginPath();
  ctx.strokeStyle = "#233044";
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
  gradient.addColorStop(0, "#28c76f");
  gradient.addColorStop(0.55, "#00cfe8");
  gradient.addColorStop(1, "#ea5455");

  ctx.beginPath();
  ctx.strokeStyle = gradient;
  ctx.arc(cx, cy, radius, start, angle);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(radius - 20, 0);
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.fillStyle = "#f8fafc";
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawWaterfall() {
  const canvas = els.waterfall;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now();

  ctx.fillStyle = "rgba(10, 15, 24, 0.34)";
  ctx.fillRect(0, 0, width, height);

  state.flows.forEach((flow, index) => {
    const age = Math.min((now - flow.at) / 6000, 1);
    const x = (index / 140) * width;
    const y = age * height;
    const length = 18 + (flow.dstPort % 46);
    const color = protocolColors[flow.protocol] ?? protocolColors.OTHER;

    ctx.globalAlpha = 1 - age * 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = flow.protocol === "TCP" ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + 16);
    ctx.stroke();
  });

  ctx.globalAlpha = 1;
}

function animate() {
  drawMeter();
  drawWaterfall();
  requestAnimationFrame(animate);
}

function randomIp() {
  return `10.10.${Math.floor(Math.random() * 4)}.${2 + Math.floor(Math.random() * 220)}`;
}

function emitDemoFlow() {
  const protocols = ["TCP", "UDP", "ICMP"];
  const burst = 4 + Math.floor(Math.random() * 10);

  for (let i = 0; i < burst; i += 1) {
    handleEvent({
      type: "flow",
      protocol: protocols[Math.floor(Math.random() * protocols.length)],
      src: randomIp(),
      src_port: 1024 + Math.floor(Math.random() * 50000),
      dst: "10.10.0.1",
      dst_port: [22, 80, 443, 8081][Math.floor(Math.random() * 4)],
    });
  }

  const baseline = 80 + Math.floor(Math.random() * 260);
  state.pps = Math.random() > 0.82 ? baseline + 700 : baseline;
  if (state.pps > 650) {
    handleEvent({ type: "alert", dst: "10.10.0.1", rate: state.pps });
  }
  updateStats();
}

function toggleDemo() {
  state.demo = !state.demo;
  els.demoToggle.setAttribute("aria-pressed", String(state.demo));
  els.demoToggle.classList.toggle("active", state.demo);

  if (state.demo) {
    setStatus("demo");
    state.demoTimer = window.setInterval(emitDemoFlow, 180);
    return;
  }

  window.clearInterval(state.demoTimer);
  state.demoTimer = null;
  setStatus(state.status === "demo" ? "waiting" : state.status);
}

async function subscribeTauriEvents() {
  await listen("stream-status", (event) => {
    if (!state.demo) {
      setStatus(event.payload);
    }
  });

  await listen("packet-event", (event) => {
    if (state.demo) {
      return;
    }

    try {
      handleEvent(JSON.parse(event.payload));
    } catch {
      // Malformed lines are ignored so a single bad event does not stop the dashboard.
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  updateStats();
  setStatus("waiting");
  els.demoToggle.addEventListener("click", toggleDemo);
  setupCanvasSizing();
  subscribeTauriEvents();
  animate();
});
