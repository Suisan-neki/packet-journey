use crate::events::{
    ActionItem, AlertEvent, CauseAxis, FlowEvent, GuidanceEvent, ScenarioId, SensorEvent,
    SensorMetric, Severity, SourceRef, UpstreamEvent,
};
use crate::mock_fhir::snapshot_for_scenario;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

const LATERAL_DST_THRESHOLD: usize = 8;
const LATERAL_WINDOW: Duration = Duration::from_secs(5);
const RATE_ALERT_THRESHOLD: u32 = 100;
const OVERHEAT_TEMP_C: f32 = 42.0;
const OVERHEAT_DELTA_C: f32 = 8.0;

#[derive(Debug, Default)]
pub struct JudgmentEngine {
    lateral: HashMap<String, LateralWindow>,
    sensors: HashMap<String, SensorNodeState>,
    active_network_src: Option<String>,
    last_guidance: Option<ScenarioId>,
}

#[derive(Debug)]
struct LateralWindow {
    started: Instant,
    destinations: HashSet<String>,
}

#[derive(Debug)]
struct SensorNodeState {
    baseline_temp_c: f32,
    last_temp_c: f32,
    overheat: bool,
    tag: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum JudgmentOutput {
    Guidance(GuidanceEvent),
    FhirSnapshot(crate::events::FhirSnapshotEvent),
}

impl JudgmentEngine {
    pub fn ingest(&mut self, event: &UpstreamEvent) -> Vec<JudgmentOutput> {
        match event {
            UpstreamEvent::Flow(flow) => self.ingest_flow(flow),
            UpstreamEvent::Alert(alert) => self.ingest_alert(alert),
            UpstreamEvent::Sensor(sensor) => self.ingest_sensor(sensor),
            UpstreamEvent::Stats(_) => Vec::new(),
        }
    }

    fn ingest_flow(&mut self, flow: &FlowEvent) -> Vec<JudgmentOutput> {
        let window = self
            .lateral
            .entry(flow.src.clone())
            .or_insert_with(|| LateralWindow {
                started: Instant::now(),
                destinations: HashSet::new(),
            });

        if window.started.elapsed() > LATERAL_WINDOW {
            window.started = Instant::now();
            window.destinations.clear();
        }

        window.destinations.insert(flow.dst.clone());

        if window.destinations.len() >= LATERAL_DST_THRESHOLD {
            let unique_dst = window.destinations.len();
            return self.emit_if_new(ScenarioId::LateralMovement, || {
                lateral_movement_guidance(flow, unique_dst)
            });
        }

        Vec::new()
    }

    fn ingest_alert(&mut self, alert: &AlertEvent) -> Vec<JudgmentOutput> {
        if alert.rate < RATE_ALERT_THRESHOLD {
            return Vec::new();
        }

        let overheat = self.sensors.values().any(|s| s.overheat);
        if overheat {
            return self.emit_if_new(ScenarioId::CombinedPhysicalNetwork, || {
                combined_guidance(alert)
            });
        }

        if alert.rate >= 200 {
            self.active_network_src = alert.src.clone();
            return self.emit_if_new(ScenarioId::LateralMovement, || {
                flood_as_lateral_guidance(alert)
            });
        }

        self.emit_if_new(ScenarioId::PacketFlood, || packet_flood_guidance(alert))
    }

    fn ingest_sensor(&mut self, sensor: &SensorEvent) -> Vec<JudgmentOutput> {
        if sensor.metric != SensorMetric::Temperature {
            return Vec::new();
        }

        let node = self
            .sensors
            .entry(sensor.node_id.clone())
            .or_insert_with(|| SensorNodeState {
                baseline_temp_c: sensor.value,
                last_temp_c: sensor.value,
                overheat: false,
                tag: sensor.tag.clone(),
            });

        if node.baseline_temp_c > sensor.value {
            node.baseline_temp_c = sensor.value;
        }
        node.last_temp_c = sensor.value;
        node.tag = sensor.tag.clone();

        let spike = sensor.value >= OVERHEAT_TEMP_C
            || sensor.value >= node.baseline_temp_c + OVERHEAT_DELTA_C;
        node.overheat = spike;

        if !spike {
            return Vec::new();
        }

        if self.active_network_src.is_some() || self.has_recent_network_stress() {
            return self.emit_if_new(ScenarioId::CombinedPhysicalNetwork, || {
                combined_from_sensor_guidance(sensor)
            });
        }

        self.emit_if_new(ScenarioId::AccessPointOverheat, || {
            overheat_guidance(sensor)
        })
    }

    fn has_recent_network_stress(&self) -> bool {
        self.lateral
            .values()
            .any(|w| w.destinations.len() >= LATERAL_DST_THRESHOLD)
    }

    fn emit_if_new(
        &mut self,
        scenario: ScenarioId,
        build: impl FnOnce() -> GuidanceEvent,
    ) -> Vec<JudgmentOutput> {
        if self.last_guidance == Some(scenario) {
            return Vec::new();
        }

        self.last_guidance = Some(scenario);
        let guidance = build();
        let mut outputs = vec![JudgmentOutput::Guidance(guidance.clone())];
        if guidance.degraded {
            outputs.push(JudgmentOutput::FhirSnapshot(snapshot_for_scenario(scenario)));
        }
        outputs
    }
}

fn lateral_movement_guidance(flow: &FlowEvent, unique_dst: usize) -> GuidanceEvent {
    GuidanceEvent {
        scenario: ScenarioId::LateralMovement,
        cause: CauseAxis::Network,
        severity: Severity::Critical,
        headline: "受付端末から異常な横展開通信を検知しました".to_string(),
        summary: format!(
            "端末 {} が短時間に {} 台以上へ不審な通信を大量送信しています。",
            flow.src, unique_dst
        ),
        actions: vec![
            ActionItem {
                priority: 1,
                text: format!(
                    "直ちに端末 {} の LAN ケーブルを物理的に抜くか、Wi-Fi をオフにしてください。",
                    flow.src
                ),
                reversible: true,
            },
            ActionItem {
                priority: 2,
                text: "その端末での電子カルテの操作を直ちに中止してください。".to_string(),
                reversible: true,
            },
            ActionItem {
                priority: 3,
                text: "他の診察室の端末は通常通り利用可能です。".to_string(),
                reversible: true,
            },
        ],
        unaffected_note: Some("他の診察室の端末は通常通り利用可能です。".to_string()),
        sources: vec![
            SourceRef {
                kind: "flow".to_string(),
                detail: format!(
                    "src={}:{} が {} 宛先へ短時間接続",
                    flow.src, flow.src_port, unique_dst
                ),
            },
            SourceRef {
                kind: "rule".to_string(),
                detail: format!(
                    "lateral_movement: unique_dst>={LATERAL_DST_THRESHOLD} within {}s",
                    LATERAL_WINDOW.as_secs()
                ),
            },
        ],
        degraded: false,
    }
}

fn flood_as_lateral_guidance(alert: &AlertEvent) -> GuidanceEvent {
    let target = alert.src.clone().unwrap_or_else(|| alert.dst.clone());
    GuidanceEvent {
        scenario: ScenarioId::LateralMovement,
        cause: CauseAxis::Network,
        severity: Severity::Critical,
        headline: "端末から異常な大量通信を検知しました".to_string(),
        summary: format!(
            "観測ノードが {} 宛の通信で {} PPS を検知しました。",
            alert.dst, alert.rate
        ),
        actions: vec![
            ActionItem {
                priority: 1,
                text: format!(
                    "直ちに端末 {} の LAN ケーブルを物理的に抜くか、Wi-Fi をオフにしてください。",
                    target
                ),
                reversible: true,
            },
            ActionItem {
                priority: 2,
                text: "その端末での電子カルテの操作を直ちに中止してください。".to_string(),
                reversible: true,
            },
            ActionItem {
                priority: 3,
                text: "他の診察室の端末は通常通り利用可能です。".to_string(),
                reversible: true,
            },
        ],
        unaffected_note: Some("他の診察室の端末は通常通り利用可能です。".to_string()),
        sources: vec![SourceRef {
            kind: "alert".to_string(),
            detail: format!("dst={}, rate={}/s", alert.dst, alert.rate),
        }],
        degraded: false,
    }
}

fn packet_flood_guidance(alert: &AlertEvent) -> GuidanceEvent {
    GuidanceEvent {
        scenario: ScenarioId::PacketFlood,
        cause: CauseAxis::Network,
        severity: Severity::Urgent,
        headline: "ネットワーク上で通信集中を検知しました".to_string(),
        summary: format!(
            "宛先 {} へ {} PPS の通信集中があります。業務影響の有無を確認してください。",
            alert.dst, alert.rate
        ),
        actions: vec![ActionItem {
            priority: 1,
            text: "該当セグメントの端末で不要な大量アクセスがないか確認してください。".to_string(),
            reversible: true,
        }],
        unaffected_note: None,
        sources: vec![SourceRef {
            kind: "alert".to_string(),
            detail: format!("dst={}, rate={}/s", alert.dst, alert.rate),
        }],
        degraded: false,
    }
}

fn overheat_guidance(sensor: &SensorEvent) -> GuidanceEvent {
    GuidanceEvent {
        scenario: ScenarioId::AccessPointOverheat,
        cause: CauseAxis::Physical,
        severity: Severity::Urgent,
        headline: "診察室の Wi-Fi 機器が過熱寸前です".to_string(),
        summary: format!(
            "センサー {}（{}）が {:.1}{} を報告しています。通信途切れの前兆の可能性があります。",
            sensor.node_id, sensor.tag, sensor.value, sensor.unit
        ),
        actions: vec![
            ActionItem {
                priority: 1,
                text: "診察室の端末を壁のジャックから LAN ケーブルで直接接続（有線）に切り替えてください。"
                    .to_string(),
                reversible: true,
            },
            ActionItem {
                priority: 2,
                text: "該当 Wi-Fi 機器の周辺に物が置かれていないか（熱がこもっていないか）確認してください。"
                    .to_string(),
                reversible: true,
            },
        ],
        unaffected_note: Some("有線接続に切り替えれば、当該診察室の端末は継続利用できる可能性があります。".to_string()),
        sources: vec![SourceRef {
            kind: "sensor".to_string(),
            detail: format!(
                "node={}, tag={}, temp={:.1}{}",
                sensor.node_id, sensor.tag, sensor.value, sensor.unit
            ),
        }],
        degraded: false,
    }
}

fn combined_guidance(alert: &AlertEvent) -> GuidanceEvent {
    GuidanceEvent {
        scenario: ScenarioId::CombinedPhysicalNetwork,
        cause: CauseAxis::Combined,
        severity: Severity::Critical,
        headline: "物理環境の異常が通信障害を引き起こしています".to_string(),
        summary: format!(
            "温度上昇と通信異常（{} PPS）が同時に観測されています。ソフトウェア障害ではなく設備起因の可能性が高いです。",
            alert.rate
        ),
        actions: vec![
            ActionItem {
                priority: 1,
                text: "該当機器の周辺の換気・排熱を確認し、有線接続へ切り替えてください。".to_string(),
                reversible: true,
            },
            ActionItem {
                priority: 2,
                text: "ベンダー連絡前に、縮退ビューで最低限の診療情報を確認できる状態を維持してください。"
                    .to_string(),
                reversible: true,
            },
        ],
        unaffected_note: None,
        sources: vec![SourceRef {
            kind: "alert".to_string(),
            detail: format!("dst={}, rate={}/s", alert.dst, alert.rate),
        }],
        degraded: true,
    }
}

fn combined_from_sensor_guidance(sensor: &SensorEvent) -> GuidanceEvent {
    GuidanceEvent {
        scenario: ScenarioId::CombinedPhysicalNetwork,
        cause: CauseAxis::Combined,
        severity: Severity::Critical,
        headline: "物理環境の異常が通信障害を引き起こしています".to_string(),
        summary: format!(
            "センサー {} が {:.1}{} を報告し、同時に通信異常が観測されています。",
            sensor.node_id, sensor.value, sensor.unit
        ),
        actions: vec![
            ActionItem {
                priority: 1,
                text: "該当機器の周辺の換気・排熱を確認し、有線接続へ切り替えてください。".to_string(),
                reversible: true,
            },
            ActionItem {
                priority: 2,
                text: "ベンダー連絡前に、縮退ビューで最低限の診療情報を確認できる状態を維持してください。"
                    .to_string(),
                reversible: true,
            },
        ],
        unaffected_note: None,
        sources: vec![SourceRef {
            kind: "sensor".to_string(),
            detail: format!(
                "node={}, temp={:.1}{}",
                sensor.node_id, sensor.value, sensor.unit
            ),
        }],
        degraded: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{AlertEvent, FlowEvent, SensorEvent};

    #[test]
    fn lateral_movement_triggers_after_many_destinations() {
        let mut engine = JudgmentEngine::default();
        let mut outputs = Vec::new();

        for i in 2..12 {
            outputs.extend(engine.ingest(&UpstreamEvent::Flow(FlowEvent {
                protocol: "TCP".to_string(),
                src: "10.10.0.50".to_string(),
                src_port: 40000,
                dst: format!("10.10.0.{i}"),
                dst_port: 445,
            })));
        }

        assert!(outputs.iter().any(|o| matches!(
            o,
            JudgmentOutput::Guidance(g) if g.scenario == ScenarioId::LateralMovement
        )));
    }

    #[test]
    fn overheat_triggers_physical_guidance() {
        let mut engine = JudgmentEngine::default();
        let outputs = engine.ingest(&UpstreamEvent::Sensor(SensorEvent {
            node_id: "ap-exam-1".to_string(),
            tag: "exam-room-ap".to_string(),
            metric: SensorMetric::Temperature,
            value: 46.0,
            unit: "C".to_string(),
        }));

        assert!(outputs.iter().any(|o| matches!(
            o,
            JudgmentOutput::Guidance(g) if g.scenario == ScenarioId::AccessPointOverheat
        )));
    }

    #[test]
    fn combined_triggers_with_alert_and_overheat() {
        let mut engine = JudgmentEngine::default();
        engine.ingest(&UpstreamEvent::Sensor(SensorEvent {
            node_id: "ap-exam-1".to_string(),
            tag: "exam-room-ap".to_string(),
            metric: SensorMetric::Temperature,
            value: 46.0,
            unit: "C".to_string(),
        }));
        let outputs = engine.ingest(&UpstreamEvent::Alert(AlertEvent {
            dst: "10.10.0.1".to_string(),
            rate: 240,
            src: Some("10.10.0.50".to_string()),
        }));

        assert!(outputs.iter().any(|o| matches!(
            o,
            JudgmentOutput::Guidance(g) if g.scenario == ScenarioId::CombinedPhysicalNetwork && g.degraded
        )));
    }
}
