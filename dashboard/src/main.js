import { listen } from "@tauri-apps/api/event";

const STATUS_LABELS = {
  waiting: "待機中",
  connected: "接続中",
  disconnected: "切断",
  demo: "デモ",
};

const CAUSE_LABELS = {
  network: "通信異常",
  physical: "物理環境",
  combined: "複合（物理＋通信）",
};

const SEVERITY_LABELS = {
  watch: "注意",
  urgent: "緊急",
  critical: "直ちに対応",
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
  activeView: "tech",
  guidance: null,
  fhirSnapshot: null,
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
  els.viewTabs = document.querySelectorAll(".view-tab");
  els.viewPanels = {
    tech: document.querySelector("#view-tech"),
    clinical: document.querySelector("#view-clinical"),
    degraded: document.querySelector("#view-degraded"),
  };
  els.clinicalHeadline = document.querySelector("#clinical-headline");
  els.clinicalSummary = document.querySelector("#clinical-summary");
  els.clinicalBadge = document.querySelector("#clinical-badge");
  els.clinicalActions = document.querySelector("#clinical-actions");
  els.clinicalUnaffected = document.querySelector("#clinical-unaffected");
  els.clinicalSources = document.querySelector("#clinical-sources");
  els.degradedNote = document.querySelector("#degraded-note");
  els.patientGrid = document.querySelector("#patient-grid");
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
    return;
  }

  if (event.type === "sensor") {
    return;
  }

  if (event.type === "guidance") {
    state.guidance = event;
    renderClinical(event);
    if (event.degraded) {
      switchView("degraded");
    } else {
      switchView("clinical");
    }
    return;
  }

  if (event.type === "fhir_snapshot") {
    state.fhirSnapshot = event;
    renderDegraded(event);
    switchView("degraded");
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

function renderClinical(guidance) {
  const severity = guidance.severity ?? "watch";
  const cause = guidance.cause ?? "network";

  els.clinicalHeadline.textContent = guidance.headline ?? "異常を検知しました";
  els.clinicalSummary.textContent =
    guidance.summary ?? "低レイヤ観測に基づく初動判断です。";
  els.clinicalBadge.textContent = `${SEVERITY_LABELS[severity] ?? severity} / ${
    CAUSE_LABELS[cause] ?? cause
  }`;
  els.clinicalBadge.className = `clinical-badge clinical-badge--${severity}`;

  els.clinicalActions.replaceChildren();
  const actions = guidance.actions ?? [];
  if (actions.length === 0) {
    const item = document.createElement("li");
    item.className = "action-item action-item--calm";
    item.textContent = "初動手順はありません。";
    els.clinicalActions.appendChild(item);
  } else {
    actions
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .forEach((action) => {
        const item = document.createElement("li");
        item.className = "action-item";
        item.textContent = action.text ?? "";
        els.clinicalActions.appendChild(item);
      });
  }

  els.clinicalUnaffected.textContent =
    guidance.unaffected_note ?? "影響範囲の追加情報はありません。";

  els.clinicalSources.replaceChildren();
  const sources = guidance.sources ?? [];
  if (sources.length === 0) {
    const item = document.createElement("li");
    item.textContent = "根拠データはありません。";
    els.clinicalSources.appendChild(item);
  } else {
    sources.forEach((source) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${source.kind ?? "source"}</strong> ${source.detail ?? ""}`;
      els.clinicalSources.appendChild(item);
    });
  }
}

function renderDegraded(snapshot) {
  els.degradedNote.textContent =
    snapshot.note ??
    "模擬 FHIR データです。実診療データの救出は検証用の設計可能性確認のみを目的としています。";

  const patients = snapshot.patients ?? [];
  els.patientGrid.replaceChildren();

  if (patients.length === 0) {
    const card = document.createElement("article");
    card.className = "patient-card patient-card--empty";
    card.innerHTML = "<p>表示できる患者データがありません。</p>";
    els.patientGrid.appendChild(card);
    return;
  }

  patients.forEach((patient) => {
    const card = document.createElement("article");
    card.className = "patient-card";
    card.innerHTML = `
      <header class="patient-card__header">
        <strong>${patient.name ?? "不明"}</strong>
        <span>${patient.room ?? "—"}</span>
      </header>
      <p class="patient-card__id">ID: ${patient.id ?? "—"}</p>
      <p class="patient-card__complaint">${patient.chief_complaint ?? ""}</p>
      <p class="patient-card__vitals">${patient.last_vitals ?? ""}</p>
    `;
    els.patientGrid.appendChild(card);
  });
}

function switchView(view) {
  state.activeView = view;
  els.viewTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  Object.entries(els.viewPanels).forEach(([key, panel]) => {
    panel.hidden = key !== view;
  });
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

function emitDemoGuidance() {
  handleEvent({
    type: "guidance",
    scenario: "lateral_movement",
    cause: "network",
    severity: "critical",
    headline: "受付端末から異常な横展開通信を検知しました",
    summary: "端末 10.10.0.50 が短時間に多数の宛先へ不審な通信を送信しています。",
    actions: [
      {
        priority: 1,
        text: "直ちに端末 10.10.0.50 の LAN ケーブルを物理的に抜くか、Wi-Fi をオフにしてください。",
        reversible: true,
      },
      {
        priority: 2,
        text: "その端末での電子カルテの操作を直ちに中止してください。",
        reversible: true,
      },
      {
        priority: 3,
        text: "他の診察室の端末は通常通り利用可能です。",
        reversible: true,
      },
    ],
    unaffected_note: "他の診察室の端末は通常通り利用可能です。",
    sources: [
      { kind: "flow", detail: "src=10.10.0.50 が 10 宛先へ短時間接続" },
      { kind: "rule", detail: "lateral_movement: unique_dst>=8 within 5s" },
    ],
    degraded: false,
  });
}

function toggleDemo() {
  state.demo = !state.demo;
  els.demoToggle.setAttribute("aria-pressed", String(state.demo));
  els.demoToggle.classList.toggle("active", state.demo);

  if (state.demo) {
    setStatus("demo");
    state.demoTimer = window.setInterval(() => {
      emitDemoFlow();
      if (Math.random() > 0.7) {
        emitDemoGuidance();
      }
    }, 1800);
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
  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  setupCanvasSizing();
  subscribeTauriEvents();
  animate();
});
