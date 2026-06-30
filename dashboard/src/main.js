import { subscribeStream, isWebDemo } from "./stream.js";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "システム稼働中（通信を観測しています）",
  disconnected: "接続が切断されました",
  demo: "デモ（サンプルデータ）",
};

const DEMO_PI_IP = "192.168.1.50";
const MAX_PACKETS = 12;

const PROTOCOL_META = {
  TCP: {
    name: "TCP",
    hint: "データを正確かつ確実に届ける",
    explain: "Web やメールなど、取りこぼしが困る通信に使われます",
  },
  UDP: {
    name: "UDP",
    hint: "届いたかは問わず、とにかく速く送る",
    explain: "動画配信や名前解決など、速度優先の通信に使われます",
  },
  ICMP: {
    name: "ICMP",
    hint: "相手につながるか調べる",
    explain: "ping など、疎通確認に使われます",
  },
  OTHER: {
    name: "その他",
    hint: "その他の形式",
    explain: "上記以外の通信ルールです",
  },
};

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
  els.waterfallIdle = document.querySelector("#waterfall-idle");
  els.packetLatest = document.querySelector("#packet-latest");
  els.flowList = document.querySelector("#flow-list");
  els.alertLog = document.querySelector("#alert-log");
  els.flash = document.querySelector("#attack-flash");
  els.currentAction = document.querySelector("#current-action");
  els.behindProtocol = document.querySelector("#behind-protocol");
  els.behindSrc = document.querySelector("#behind-src");
  els.behindSrcPort = document.querySelector("#behind-src-port");
  els.behindDst = document.querySelector("#behind-dst");
  els.behindDstPort = document.querySelector("#behind-dst-port");
  els.behindSummary = document.querySelector("#behind-summary");
  els.captureToast = document.querySelector("#capture-toast");
  els.captureToastText = document.querySelector("#capture-toast-text");
  els.flowSteps = document.querySelectorAll(".flow-map__step");
}

function protocolMeta(protocol) {
  return PROTOCOL_META[protocol] ?? PROTOCOL_META.OTHER;
}

function portHint(port) {
  switch (port) {
    case 80:
      return "Web（HTTP）";
    case 443:
      return "Web（HTTPS）";
    case 8080:
      return "展示サーバー（状態確認）";
    case 53:
      return "名前解決（DNS）";
    default:
      return `ポート ${port}`;
  }
}

function formatEndpoint(ip, port) {
  if (port) {
    return `${ip}:${port}`;
  }
  return ip ?? "—";
}

function protocolClass(protocol) {
  switch (protocol) {
    case "TCP":
      return "packet-drop--tcp";
    case "UDP":
      return "packet-drop--udp";
    case "ICMP":
      return "packet-drop--icmp";
    default:
      return "packet-drop--other";
  }
}

function protoBadgeClass(protocol) {
  switch (protocol) {
    case "TCP":
      return "proto-badge--tcp";
    case "UDP":
      return "proto-badge--udp";
    case "ICMP":
      return "proto-badge--icmp";
    default:
      return "proto-badge--other";
  }
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

function correlatedSummary(label, protocol, src, srcPort, dst, dstPort) {
  const meta = protocolMeta(protocol);
  const route = `${formatEndpoint(src, srcPort)} → ${formatEndpoint(dst, dstPort)}`;
  const purpose = dstPort ? portHint(dstPort) : meta.hint;
  return `【${label}】の操作は ${meta.name}（${meta.hint}）のパケットとして ${route} を通りました。${purpose} への通信です。`;
}

function setCurrentAction(text, active = true) {
  els.currentAction.textContent = text;
  els.currentAction.classList.toggle("current-action--idle", !active);
}

function updateStats() {
  els.ppsValue.textContent = formatNumber(state.pps);
  els.totalValue.textContent = formatNumber(state.total);
}

function setBehindData(event) {
  const protocol = event.protocol ?? "OTHER";
  const meta = protocolMeta(protocol);

  els.behindProtocol.textContent = `${meta.name} — ${meta.hint}`;
  els.behindProtocol.className = `proto-badge ${protoBadgeClass(protocol)}`;
  els.behindSrc.textContent = event.src ?? "—";
  els.behindDst.textContent = event.dst ?? "—";

  if (event.src_port) {
    els.behindSrcPort.textContent = `ポート ${event.src_port}`;
  } else {
    els.behindSrcPort.textContent = "";
  }

  if (event.dst_port) {
    els.behindDstPort.textContent = portHint(event.dst_port);
  } else {
    els.behindDstPort.textContent = "";
  }

  els.behindSummary.textContent = correlatedSummary(
    event.label ?? state.lastActionLabel ?? "操作",
    protocol,
    event.src,
    event.src_port,
    event.dst,
    event.dst_port,
  );
}

function updateLatestPacket(event, highlight = false) {
  const protocol = event.protocol ?? "OTHER";
  const meta = protocolMeta(protocol);
  const route = `${formatEndpoint(event.src, event.src_port)} → ${formatEndpoint(
    event.dst,
    event.dst_port,
  )}`;
  const purpose = event.dst_port ? portHint(event.dst_port) : meta.explain;

  els.packetLatest.classList.remove("packet-latest--idle");
  if (highlight) {
    els.packetLatest.classList.add("packet-latest--hit");
  } else {
    els.packetLatest.classList.remove("packet-latest--hit");
  }

  els.packetLatest.replaceChildren();

  const badge = document.createElement("span");
  badge.className = `proto-badge ${protoBadgeClass(protocol)}`;
  badge.textContent = meta.name;

  const body = document.createElement("span");
  body.className = "packet-latest__body";
  body.textContent = `${meta.hint} ｜ ${route} ｜ ${purpose}`;

  els.packetLatest.append(badge, body);
}

function dropPacket(event, { highlight = false } = {}) {
  const protocol = event.protocol ?? "OTHER";
  const meta = protocolMeta(protocol);

  if (els.waterfallIdle) {
    els.waterfallIdle.hidden = true;
  }

  const el = document.createElement("div");
  el.className = `packet-drop ${protocolClass(protocol)}${
    highlight ? " packet-drop--hit" : ""
  }`;
  el.style.left = `${6 + Math.random() * 82}%`;
  el.style.animationDuration = `${highlight ? 3.4 : 2.2 + Math.random() * 1.2}s`;

  const proto = document.createElement("span");
  proto.className = "packet-drop__proto";
  proto.textContent = `${meta.name} — ${meta.hint}`;

  const route = document.createElement("span");
  route.className = "packet-drop__route";
  route.textContent = `${formatEndpoint(event.src, event.src_port)} → ${formatEndpoint(
    event.dst,
    event.dst_port,
  )}`;

  const role = document.createElement("span");
  role.className = "packet-drop__role";
  role.textContent = event.dst_port ? portHint(event.dst_port) : meta.explain;

  el.append(proto, route, role);
  els.waterfall.appendChild(el);

  const drops = els.waterfall.querySelectorAll(".packet-drop");
  if (drops.length > MAX_PACKETS) {
    drops[0].remove();
  }

  el.addEventListener("animationend", () => el.remove());

  updateLatestPacket(event, highlight);
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
    showCaptureToast("操作を検知しました。対応するパケットを待っています…");
    return;
  }

  if (event.type === "action_correlated") {
    const label = event.label ?? state.lastActionLabel ?? "操作";
    setCurrentAction(`【${label}】ボタンが押されました`);
    setBehindData({ ...event, label });
    state.highlightSrc = event.src;
    state.highlightUntil = performance.now() + 5000;
    window.clearTimeout(state.flowStepTimer);
    setActiveFlowStep("display");
    showCaptureToast(
      `【捕捉】${event.protocol ?? "TCP"} パケットとして ${formatEndpoint(event.src, event.src_port)} から届きました`,
    );
    pushFlowRow(event, true);
    dropPacket(event, { highlight: true });
    window.setTimeout(() => setActiveFlowStep("button"), 5000);
    return;
  }

  if (event.type === "flow") {
    state.total += 1;
    dropPacket(event);
    pushFlowRow(event, false);
    updateStats();
  }
}

function pushFlowRow(event, highlighted) {
  const row = {
    time: formatTime(),
    src: formatEndpoint(event.src, event.src_port),
    dst: formatEndpoint(event.dst, event.dst_port),
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
    empty.textContent = "捕捉したパケットがここに並びます";
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

    const proto = document.createElement("span");
    proto.className = `flow-row__proto ${protoBadgeClass(row.protocol)}`;
    proto.textContent = row.protocol;

    const src = document.createElement("span");
    src.textContent = row.src;
    const dst = document.createElement("span");
    dst.textContent = row.dst;

    el.append(time, proto, src, dst);
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
  item.textContent = `${target} 宛て ${rate} パケット/秒 を超過`;
  els.alertLog.prepend(item);
  while (els.alertLog.children.length > 4) {
    els.alertLog.lastElementChild.remove();
  }
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
      dst_port: [80, 443, 8080, 53][Math.floor(Math.random() * 4)],
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
  updateStats();
  renderFlowList();
  setCurrentAction("ボタンを押すとここに表示されます", false);
  setStatus("waiting");
  setActiveFlowStep("button");
  els.demoToggle.addEventListener("click", toggleDemo);
  connectStream();
});
