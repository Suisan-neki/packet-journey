import { subscribeStream, isWebDemo } from "./stream.js";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "接続中",
  disconnected: "切断",
  demo: "デモ",
};

const DEMO_PI_IP = "192.168.1.50";

const state = {
  pps: 0,
  total: 0,
  alerts: 0,
  flows: [],
  flowRows: [],
  status: "waiting",
  demo: false,
  webDemo: false,
  demoTimer: null,
  lastProtocol: "—",
  highlightUntil: 0,
  highlightSrc: null,
};

const protocolColors = {
  TCP: "#3ecf8e",
  UDP: "#4cc9f0",
  ICMP: "#f4a261",
  OTHER: "#94a3b8",
};

const els = {};

function cacheElements() {
  els.status = document.querySelector("#stream-status");
  els.statusDot = document.querySelector("#stream-dot");
  els.demoToggle = document.querySelector("#demo-toggle");
  els.webBanner = document.querySelector("#web-banner");
  els.boothPanel = document.querySelector("#booth-panel");
  els.simulateButton = document.querySelector("#simulate-button");
  els.ppsValue = document.querySelector("#pps-value");
  els.totalValue = document.querySelector("#total-value");
  els.protocolValue = document.querySelector("#protocol-value");
  els.alertCount = document.querySelector("#alert-count");
  els.flowCount = document.querySelector("#flow-count");
  els.alertLog = document.querySelector("#alert-log");
  els.flowList = document.querySelector("#flow-list");
  els.flash = document.querySelector("#attack-flash");
  els.meter = document.querySelector("#pps-meter");
  els.waterfall = document.querySelector("#waterfall");
  els.toast = document.querySelector("#action-toast");
  els.toastLabel = document.querySelector("#toast-label");
  els.toastDetail = document.querySelector("#toast-detail");
}

function setStatus(status) {
  const key = state.demo || state.webDemo ? "demo" : status;
  state.status = key;
  els.status.textContent = STATUS_LABELS[key] ?? key;
  els.statusDot.className = `status-dot ${key}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function showActionToast(label, detail) {
  els.toastLabel.textContent = label;
  els.toastDetail.textContent = detail;
  els.toast.hidden = false;
  els.toast.classList.add("visible");
  window.clearTimeout(showActionToast.timer);
  showActionToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
    window.setTimeout(() => {
      els.toast.hidden = true;
    }, 280);
  }, 4200);
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

  if (event.type === "physical_action") {
    showActionToast(
      event.label ?? "物理操作",
      `${event.node_id ?? "node"} — パケット待ち…`,
    );
    return;
  }

  if (event.type === "action_correlated") {
    const detail = `${event.protocol} ${event.src}:${event.src_port} → ${event.dst}:${event.dst_port}`;
    showActionToast(`「${event.label}」を捕捉`, detail);
    state.highlightSrc = event.src;
    state.highlightUntil = performance.now() + 5000;
    pushFlow(event, true);
    updateStats();
    renderFlowList();
    return;
  }

  if (event.type === "flow") {
    state.total += 1;
    state.lastProtocol = event.protocol ?? "OTHER";
    pushFlow(event, false);
    updateStats();
    renderFlowList();
  }
}

function pushFlow(event, highlighted) {
  const entry = {
    protocol: event.protocol ?? "OTHER",
    src: event.src ?? "0.0.0.0",
    dst: event.dst ?? "0.0.0.0",
    srcPort: event.src_port ?? 0,
    dstPort: event.dst_port ?? 0,
    at: performance.now(),
    highlighted,
  };
  state.flows.push(entry);
  state.flows = state.flows.slice(-160);
  state.flowRows.unshift(entry);
  state.flowRows = state.flowRows.slice(0, 12);
}

function updateStats() {
  els.ppsValue.textContent = formatNumber(state.pps);
  els.totalValue.textContent = formatNumber(state.total);
  els.protocolValue.textContent = state.lastProtocol;
  els.alertCount.textContent = formatNumber(state.alerts);
  els.flowCount.textContent = `${formatNumber(state.flows.length)} 件`;
}

function renderFlowList() {
  els.flowList.replaceChildren();
  state.flowRows.forEach((flow) => {
    const row = document.createElement("div");
    row.className = `flow-item${flow.highlighted ? " flow-item--hit" : ""}`;
    row.innerHTML = `<strong>${flow.protocol}</strong><span>${flow.src}:${flow.srcPort} → ${flow.dst}:${flow.dstPort}</span>`;
    els.flowList.appendChild(row);
  });
}

function addAlert(event) {
  els.flash.classList.remove("active");
  void els.flash.offsetWidth;
  els.flash.classList.add("active");

  const item = document.createElement("div");
  item.className = "alert-item";
  const target = event.dst ?? "不明";
  const rate = formatNumber(event.rate ?? 0);
  item.innerHTML = `<strong>${target}</strong><span>${rate} pps 超過</span>`;
  els.alertLog.prepend(item);
  while (els.alertLog.children.length > 6) {
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
  ctx.strokeStyle = "#1e293b";
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
  gradient.addColorStop(0, "#3ecf8e");
  gradient.addColorStop(0.55, "#4cc9f0");
  gradient.addColorStop(1, "#ef4444");

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
}

function drawWaterfall() {
  const canvas = els.waterfall;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now();
  const highlightActive = now < state.highlightUntil;

  ctx.fillStyle = "rgba(8, 12, 20, 0.42)";
  ctx.fillRect(0, 0, width, height);

  state.flows.forEach((flow, index) => {
    const age = Math.min((now - flow.at) / 6000, 1);
    const x = (index / 160) * width;
    const y = age * height;
    const length = 18 + (flow.dstPort % 46);
    const color = protocolColors[flow.protocol] ?? protocolColors.OTHER;
    const isHit =
      flow.highlighted ||
      (highlightActive && flow.src === state.highlightSrc && age < 0.2);

    ctx.globalAlpha = 1 - age * 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = isHit ? 3.6 : flow.protocol === "TCP" ? 2.2 : 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + 16);
    ctx.stroke();

    if (isHit) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - 2, y - 2, length + 8, 22);
    }
  });

  ctx.globalAlpha = 1;
}

function animate() {
  drawMeter();
  drawWaterfall();
  requestAnimationFrame(animate);
}

function randomIp() {
  return `192.168.1.${40 + Math.floor(Math.random() * 10)}`;
}

function emitDemoFlow() {
  const protocols = ["TCP", "UDP", "ICMP"];
  const burst = 3 + Math.floor(Math.random() * 8);
  for (let i = 0; i < burst; i += 1) {
    handleEvent({
      type: "flow",
      protocol: protocols[Math.floor(Math.random() * protocols.length)],
      src: randomIp(),
      src_port: 1024 + Math.floor(Math.random() * 50000),
      dst: "192.168.1.10",
      dst_port: [80, 443, 8080][Math.floor(Math.random() * 3)],
    });
  }
  const baseline = 60 + Math.floor(Math.random() * 220);
  state.pps = Math.random() > 0.88 ? baseline + 700 : baseline;
  if (state.pps > 650) {
    handleEvent({ type: "alert", dst: "192.168.1.10", rate: state.pps });
  }
  updateStats();
}

function emitSimulatedButtonPress() {
  const srcPort = 52000 + Math.floor(Math.random() * 800);
  handleEvent({
    type: "physical_action",
    node_id: "booth-pi-1",
    action: "check_status",
    label: "状態確認ボタン",
    src_ip: DEMO_PI_IP,
  });
  window.setTimeout(() => {
    handleEvent({
      type: "action_correlated",
      node_id: "booth-pi-1",
      action: "check_status",
      label: "状態確認ボタン",
      protocol: "TCP",
      src: DEMO_PI_IP,
      src_port: srcPort,
      dst: "192.168.1.10",
      dst_port: 8080,
    });
  }, 180);
}

function startBackgroundDemo() {
  if (state.demoTimer) {
    return;
  }
  state.demo = true;
  els.demoToggle.setAttribute("aria-pressed", "true");
  els.demoToggle.classList.add("active");
  setStatus("demo");
  state.demoTimer = window.setInterval(emitDemoFlow, 2000);
}

function stopBackgroundDemo() {
  window.clearInterval(state.demoTimer);
  state.demoTimer = null;
  state.demo = false;
  els.demoToggle.setAttribute("aria-pressed", "false");
  els.demoToggle.classList.remove("active");
}

function toggleDemo() {
  if (state.demoTimer) {
    stopBackgroundDemo();
    setStatus("waiting");
    return;
  }
  startBackgroundDemo();
}

function setupWebDemo() {
  state.webDemo = true;
  els.webBanner.hidden = false;
  els.boothPanel.hidden = false;
  els.demoToggle.hidden = true;
  startBackgroundDemo();
  els.simulateButton.addEventListener("click", () => {
    els.simulateButton.disabled = true;
    emitSimulatedButtonPress();
    window.setTimeout(() => {
      els.simulateButton.disabled = false;
    }, 600);
  });
}

async function connectStream() {
  const mode = await subscribeStream({
    onStatus(status) {
      if (!state.demo && !state.webDemo) {
        setStatus(status);
      }
    },
    onEvent(event) {
      if (state.demo || state.webDemo) {
        return;
      }
      handleEvent(event);
    },
  });

  if (mode === "web" || isWebDemo()) {
    setupWebDemo();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  updateStats();
  setStatus("waiting");
  els.demoToggle.addEventListener("click", toggleDemo);
  setupCanvasSizing();
  connectStream();
  animate();
});
