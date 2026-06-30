import { subscribeStream, isWebDemo } from "./stream.js";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "システム稼働中（通信を観測しています）",
  disconnected: "接続が切断されました",
  demo: "デモ（サンプルデータ）",
};

const DEMO_PI_IP = "192.168.1.50";
const WATERFALL_LINES = 60;

const state = {
  pps: 0,
  total: 0,
  alerts: 0,
  flowRows: [],
  status: "waiting",
  demo: false,
  webDemo: false,
  demoTimer: null,
  flowStepTimer: null,
  highlightUntil: 0,
  highlightSrc: null,
  lastActionLabel: null,
  hasAction: false,
};

const els = {};

function cacheElements() {
  els.status = document.querySelector("#stream-status");
  els.statusDot = document.querySelector("#stream-dot");
  els.demoToggle = document.querySelector("#demo-toggle");
  els.webBanner = document.querySelector("#web-banner");
  els.simulateButton = document.querySelector("#simulate-button");
  els.ppsValue = document.querySelector("#pps-value");
  els.totalValue = document.querySelector("#total-value");
  els.waterfall = document.querySelector("#waterfall-container");
  els.flowList = document.querySelector("#flow-list");
  els.alertLog = document.querySelector("#alert-log");
  els.flash = document.querySelector("#attack-flash");
  els.currentAction = document.querySelector("#current-action");
  els.behindSrc = document.querySelector("#behind-src");
  els.behindDst = document.querySelector("#behind-dst");
  els.behindSummary = document.querySelector("#behind-summary");
  els.captureToast = document.querySelector("#capture-toast");
  els.captureToastText = document.querySelector("#capture-toast-text");
  els.flowSteps = document.querySelectorAll(".flow-map__step");
}

function setStatus(status) {
  let key = status;
  if (state.webDemo) {
    key = "connected";
  } else if (state.demo) {
    key = "demo";
  }
  state.status = key;
  els.status.textContent = STATUS_LABELS[key] ?? key;
  els.statusDot.className = `status-dot ${key}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("ja-JP", { hour12: false });
}

function setActiveFlowStep(step) {
  els.flowSteps.forEach((el) => {
    el.classList.toggle("flow-map__step--active", el.dataset.step === step);
  });
}

function showCaptureToast(message) {
  els.captureToastText.textContent = message;
  els.captureToast.hidden = false;
  els.captureToast.classList.remove("visible");
  void els.captureToast.offsetWidth;
  els.captureToast.classList.add("visible");
  window.clearTimeout(showCaptureToast.timer);
  showCaptureToast.timer = window.setTimeout(() => {
    els.captureToast.classList.remove("visible");
    window.setTimeout(() => {
      els.captureToast.hidden = true;
    }, 300);
  }, 4000);
}

function plainSummary(label, src, dst) {
  if (src && dst && src !== "—" && dst !== "—") {
    return `「${label}」という信号が、${src} と ${dst} の間でやり取りされました。`;
  }
  return `「${label}」という操作が、ネットワーク上では送信元と宛先の間の通信として見えます。`;
}

function setCurrentAction(text, active = true) {
  els.currentAction.textContent = text;
  els.currentAction.classList.toggle("current-action--idle", !active);
}

function updateStats() {
  els.ppsValue.textContent = formatNumber(state.pps);
  els.totalValue.textContent = formatNumber(state.total);
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
    return;
  }

  if (event.type === "physical_action") {
    state.lastActionLabel = event.label ?? "操作";
    state.hasAction = true;
    setCurrentAction(`【${state.lastActionLabel}】ボタンが押されました`);
    setActiveFlowStep("flow");
    window.clearTimeout(state.flowStepTimer);
    state.flowStepTimer = window.setTimeout(() => setActiveFlowStep("observe"), 400);
    showCaptureToast("操作を検知しました。通信を待っています…");
    return;
  }

  if (event.type === "action_correlated") {
    const label = event.label ?? state.lastActionLabel ?? "操作";
    setCurrentAction(`【${label}】ボタンが押されました`);
    els.behindSrc.textContent = event.src ?? "—";
    els.behindDst.textContent = event.dst ?? "—";
    els.behindSummary.textContent = plainSummary(label, event.src, event.dst);
    state.highlightSrc = event.src;
    state.highlightUntil = performance.now() + 5000;
    window.clearTimeout(state.flowStepTimer);
    setActiveFlowStep("display");
    showCaptureToast(
      "【通信を捕捉しました！】あなたの操作がネットワーク上に見つかりました。",
    );
    pushFlowRow(event, true);
    pulseWaterfallHighlight(event.protocol);
    window.setTimeout(() => setActiveFlowStep("button"), 5000);
    return;
  }

  if (event.type === "flow") {
    state.total += 1;
    pushFlowRow(event, false);
    updateStats();
  }
}

function pushFlowRow(event, highlighted) {
  const row = {
    time: formatTime(),
    src: event.src ?? "0.0.0.0",
    dst: event.dst ?? "0.0.0.0",
    protocol: event.protocol ?? "OTHER",
    highlighted,
  };
  state.flowRows.unshift(row);
  state.flowRows = state.flowRows.slice(0, 8);
  renderFlowList();
}

function renderFlowList() {
  els.flowList.replaceChildren();
  if (state.flowRows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "flow-list-empty";
    empty.textContent = "通信が捕捉されるとここに表示されます";
    els.flowList.appendChild(empty);
    return;
  }

  state.flowRows.forEach((row, index) => {
    const el = document.createElement("div");
    el.className = `flow-row${row.highlighted ? " flow-row--hit" : ""}${
      index > 0 ? " flow-row--dim" : ""
    }`;

    const time = document.createElement("time");
    time.textContent = row.time;
    const src = document.createElement("span");
    src.textContent = row.src;
    const dst = document.createElement("span");
    dst.textContent = row.dst;

    el.append(time, src, dst);
    els.flowList.appendChild(el);
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
  item.textContent = `${target} 宛て ${rate} 件/秒 を超過`;
  els.alertLog.prepend(item);
  while (els.alertLog.children.length > 4) {
    els.alertLog.lastElementChild.remove();
  }
}

function protocolClass(protocol) {
  switch (protocol) {
    case "TCP":
      return "waterfall-line--tcp";
    case "UDP":
      return "waterfall-line--udp";
    case "ICMP":
      return "waterfall-line--icmp";
    default:
      return "waterfall-line--other";
  }
}

function setupWaterfall() {
  els.waterfall.replaceChildren();
  for (let i = 0; i < WATERFALL_LINES; i += 1) {
    const line = document.createElement("div");
    const protocols = ["TCP", "UDP", "ICMP", "OTHER"];
    const protocol = protocols[Math.floor(Math.random() * protocols.length)];
    line.className = `waterfall-line ${protocolClass(protocol)}`;
    line.style.left = `${(i / WATERFALL_LINES) * 100 + (Math.random() * 2 - 1)}%`;
    line.style.height = `${Math.random() * 60 + 20}px`;
    line.style.animationDuration = `${Math.random() * 2 + 1.5}s`;
    line.style.animationDelay = `${Math.random() * 3}s`;
    line.dataset.protocol = protocol;
    els.waterfall.appendChild(line);
  }
}

function pulseWaterfallHighlight(protocol) {
  const lines = els.waterfall.querySelectorAll(".waterfall-line");
  const target = lines[Math.floor(Math.random() * lines.length)];
  if (!target) {
    return;
  }
  target.classList.remove(
    "waterfall-line--tcp",
    "waterfall-line--udp",
    "waterfall-line--icmp",
    "waterfall-line--other",
  );
  target.classList.add("waterfall-line--hit", protocolClass(protocol ?? "TCP"));
  window.setTimeout(() => {
    target.classList.remove("waterfall-line--hit");
    target.classList.add(protocolClass(target.dataset.protocol ?? "OTHER"));
  }, 2000);
}

function randomIp() {
  return `192.168.1.${40 + Math.floor(Math.random() * 10)}`;
}

function emitDemoFlow() {
  const protocols = ["TCP", "UDP", "ICMP"];
  const burst = 2 + Math.floor(Math.random() * 4);
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
  const baseline = 40 + Math.floor(Math.random() * 180);
  state.pps = Math.random() > 0.88 ? baseline + 180 : baseline;
  state.total += burst;
  if (state.pps > 400) {
    handleEvent({ type: "alert", dst: "192.168.1.10", rate: state.pps });
  }
  updateStats();
}

function emitSimulatedButtonPress() {
  handleEvent({
    type: "physical_action",
    node_id: "booth-pi-1",
    action: "check_status",
    label: "状態確認",
    src_ip: DEMO_PI_IP,
  });
  window.setTimeout(() => {
    handleEvent({
      type: "action_correlated",
      node_id: "booth-pi-1",
      action: "check_status",
      label: "状態確認",
      protocol: "TCP",
      src: DEMO_PI_IP,
      src_port: 52000 + Math.floor(Math.random() * 800),
      dst: "192.168.1.10",
      dst_port: 8080,
    });
  }, 200);
}

function startBackgroundDemo() {
  if (state.demoTimer) {
    return;
  }
  state.demo = true;
  els.demoToggle.setAttribute("aria-pressed", "true");
  els.demoToggle.classList.add("active");
  setStatus("demo");
  emitDemoFlow();
  state.demoTimer = window.setInterval(emitDemoFlow, 2200);
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
  els.demoToggle.hidden = true;
  startBackgroundDemo();
  els.simulateButton.addEventListener("click", () => {
    els.simulateButton.disabled = true;
    emitSimulatedButtonPress();
    window.setTimeout(() => {
      els.simulateButton.disabled = false;
    }, 800);
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
  setupWaterfall();
  updateStats();
  renderFlowList();
  setCurrentAction("ボタンを押すとここに表示されます", false);
  setStatus("waiting");
  setActiveFlowStep("button");
  els.demoToggle.addEventListener("click", toggleDemo);
  connectStream();
});
