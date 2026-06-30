import { subscribeStream, isWebDemo } from "./stream.js";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "システム稼働中（通信を観測しています）",
  disconnected: "接続が切断されました",
  demo: "デモ（サンプルデータ）",
};

const LAYER_NARRATION = {
  idle: "ボタンを押すと、OSIの L7 から L2 へ視点が下がり、同じ通信を別の層で見ます",
  l7: "L7 アプリケーション層 — ボタンやアプリの操作が見えます",
  high: "L7 アプリケーション層 — ボタンやアプリの操作が見えます",
  descend: "L7 → L4 → L3 → L2 … OSIの上から下へ視点を下げています",
  l4l3: "L4 トランスポート層 + L3 ネットワーク層 — TCP/UDP と IP でパケットが流れます",
  mid: "L4 トランスポート層 + L3 ネットワーク層 — TCP/UDP と IP でパケットが流れます",
  l2: "L2 データリンク層 — XDP がカーネル内でパケットを観測しています",
  low: "L2 データリンク層 — XDP がカーネル内でパケットを観測しています",
  linked: "つながった！L7 の操作と、L4·L3·L2 のパケットは同じ出来事です",
  ascend: "低い層で見えたことを、L7 の画面に戻して表示しています",
};

const OSI_FOCUS = {
  idle: "いまの視点: L7（操作）",
  l7: "いまの視点: L7 アプリケーション層",
  high: "いまの視点: L7 アプリケーション層",
  descend: "いまの視点: L7 → L4 → L3 → L2 へ移動中",
  l4l3: "いまの視点: L4 + L3",
  mid: "いまの視点: L4 + L3",
  l2: "いまの視点: L2 データリンク層",
  low: "いまの視点: L2 データリンク層",
  linked: "いまの視点: L7 と L4·L3·L2 が対応",
  ascend: "いまの視点: L7 に戻る",
};

const LAYER_TO_OSI = {
  idle: { active: [7], pulse: null },
  l7: { active: [7], pulse: 7 },
  high: { active: [7], pulse: 7 },
  descend: { active: [7, 4, 3], pulse: 4 },
  l4l3: { active: [4, 3], pulse: 4 },
  mid: { active: [4, 3], pulse: 4 },
  l2: { active: [2, 3, 4], pulse: 2 },
  low: { active: [2, 3, 4], pulse: 2 },
  linked: { active: [7, 4, 3, 2], pulse: null },
  ascend: { active: [7, 4, 3, 2], pulse: 7 },
};
const DEMO_PI_IP = "192.168.1.50";
const MAX_PACKETS = 12;

const PROTOCOL_META = {
  TCP: {
    name: "TCP",
    osi: 4,
    hint: "データを正確かつ確実に届ける",
    explain: "Web やメールなど、取りこぼしが困る通信に使われます",
  },
  UDP: {
    name: "UDP",
    osi: 4,
    hint: "届いたかは問わず、とにかく速く送る",
    explain: "動画配信や名前解決など、速度優先の通信に使われます",
  },
  ICMP: {
    name: "ICMP",
    osi: 3,
    hint: "相手につながるか調べる",
    explain: "ping など、疎通確認に使われます",
  },
  OTHER: {
    name: "その他",
    osi: 4,
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
  currentLayer: "l7",
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
  els.layerNarration = document.querySelector("#layer-narration");
  els.layerBridgeCard = document.querySelector("#layer-bridge-card");
  els.bridgeHighText = document.querySelector("#bridge-high-text");
  els.bridgeLowText = document.querySelector("#bridge-low-text");
  els.mainCanvas = document.querySelector("#main-canvas");
  els.panelLeft = document.querySelector(".panel--left");
  els.panelRight = document.querySelector(".panel--right");
  els.osiLayers = document.querySelectorAll(".osi-layer");
  els.osiFocus = document.querySelector("#osi-focus");
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
  const visualStep =
    step === "descend"
      ? "l4l3"
      : step === "ascend"
        ? "linked"
        : step === "idle" || step === "high"
          ? "l7"
          : step === "mid"
            ? "l4l3"
            : step === "low"
              ? "l2"
              : step;
  els.flowSteps.forEach((el) => {
    el.classList.toggle("flow-map__step--active", el.dataset.step === visualStep);
  });
}

function setOsiHighlight(layerKey) {
  const config = LAYER_TO_OSI[layerKey] ?? LAYER_TO_OSI.idle;
  els.osiLayers?.forEach((el) => {
    const n = Number(el.dataset.osi);
    el.classList.toggle("osi-layer--active", config.active.includes(n));
    el.classList.toggle("osi-layer--pulse", config.pulse === n);
  });
  if (els.osiFocus && OSI_FOCUS[layerKey]) {
    els.osiFocus.textContent = OSI_FOCUS[layerKey];
  }
}

function setLayerNarration(key) {
  if (els.layerNarration && LAYER_NARRATION[key]) {
    els.layerNarration.textContent = LAYER_NARRATION[key];
  }
}

function setActiveLayer(layer) {
  state.currentLayer = layer;
  setActiveFlowStep(layer);
  setLayerNarration(layer);
  setOsiHighlight(layer);

  const isLow = layer === "l2" || layer === "linked" || layer === "low";
  const isHigh = layer === "l7" || layer === "linked" || layer === "high";
  els.panelLeft?.classList.toggle("panel--layer-active", isLow);
  els.panelRight?.classList.toggle("panel--layer-active", isHigh);
  els.mainCanvas?.classList.toggle("main-canvas--linked", layer === "linked");
}

function showLayerBridge(label, protocol, route) {
  const meta = protocolMeta(protocol);
  const osiLabel = meta.osi === 3 ? "L3" : "L4";
  els.bridgeHighText.textContent = `L7:「${label}」ボタンを押した`;
  els.bridgeLowText.textContent = `${osiLabel} ${meta.name} + L3 IP — ${route}（L2で観測）`;
  els.layerBridgeCard.hidden = false;
}

function hideLayerBridge() {
  els.layerBridgeCard.hidden = true;
  els.mainCanvas?.classList.remove("main-canvas--linked");
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
  const osiProto = `L${meta.osi} ${meta.name}`;
  return `L7 の「${label}」は、OSI の下位層では ${osiProto} パケット（L3: ${route}）として観測されました。${purpose} への通信です。同じ出来事を、層の違う見方で捉えています。`;
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

  els.behindProtocol.textContent = `L${meta.osi} ${meta.name} — ${meta.hint}`;
  els.behindProtocol.className = `proto-badge ${protoBadgeClass(protocol)}`;
  els.behindSrc.textContent = event.src ?? "—";
  els.behindDst.textContent = event.dst ?? "—";

  if (event.src_port) {
    els.behindSrcPort.textContent = `L4 ポート ${event.src_port}`;
  } else {
    els.behindSrcPort.textContent = "";
  }

  if (event.dst_port) {
    els.behindDstPort.textContent = `L4 ${portHint(event.dst_port)}`;
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
  el.style.left = `${4 + Math.random() * 62}%`;
  el.style.maxWidth = "min(260px, 88%)";
  el.style.animationDuration = `${highlight ? 3.4 : 2.2 + Math.random() * 1.2}s`;

  const proto = document.createElement("span");
  proto.className = "packet-drop__proto";
  proto.textContent = `L${meta.osi} ${meta.name} — ${meta.hint}`;

  const route = document.createElement("span");
  route.className = "packet-drop__route";
  route.textContent = `L3 ${formatEndpoint(event.src, event.src_port)} → ${formatEndpoint(
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
    hideLayerBridge();
    setActiveLayer("l7");
    window.clearTimeout(state.flowStepTimer);
    state.flowStepTimer = window.setTimeout(() => {
      setActiveLayer("descend");
      window.setTimeout(() => setActiveLayer("l2"), 550);
    }, 350);
    showCaptureToast("L7 で操作を検知。L4·L3·L2 のパケットを探しています…");
    return;
  }

  if (event.type === "action_correlated") {
    const label = event.label ?? state.lastActionLabel ?? "操作";
    const protocol = event.protocol ?? "TCP";
    const route = `${formatEndpoint(event.src, event.src_port)} → ${formatEndpoint(
      event.dst,
      event.dst_port,
    )}`;
    setCurrentAction(`【${label}】ボタンが押されました`);
    setBehindData({ ...event, label });
    showLayerBridge(label, protocol, route);
    state.highlightSrc = event.src;
    state.highlightUntil = performance.now() + 5000;
    window.clearTimeout(state.flowStepTimer);
    setActiveLayer("linked");
    showCaptureToast("つながった！L7 の操作と L4·L3·L2 のパケットは同じ出来事です");
    pushFlowRow(event, true);
    dropPacket(event, { highlight: true });
    state.flowStepTimer = window.setTimeout(() => {
      setActiveLayer("ascend");
      window.setTimeout(() => {
        setActiveLayer("l7");
        hideLayerBridge();
        state.hasAction = false;
      }, 1200);
    }, 4500);
    return;
  }

  if (event.type === "flow") {
    state.total += 1;
    dropPacket(event);
    pushFlowRow(event, false);
    updateStats();
    if (!state.hasAction && (state.currentLayer === "l7" || state.currentLayer === "high")) {
      setActiveLayer("l4l3");
    }
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
  setActiveLayer("l7");
  hideLayerBridge();
  els.demoToggle.addEventListener("click", toggleDemo);
  connectStream();
});
