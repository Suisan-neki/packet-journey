use serde::{Deserialize, Serialize};

/// NDJSON 1 行として observation-hub が配信するイベント。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Flow(FlowEvent),
    Alert(AlertEvent),
    Stats(StatsEvent),
    Sensor(SensorEvent),
    PhysicalAction(PhysicalActionEvent),
    ActionCorrelated(ActionCorrelatedEvent),
    Guidance(GuidanceEvent),
    FhirSnapshot(FhirSnapshotEvent),
    TrafficHealth(TrafficHealthEvent),
    AttackState(AttackStateEvent),
    DefenseMode(DefenseModeEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowEvent {
    pub protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    pub src: String,
    pub src_port: u16,
    pub dst: String,
    pub dst_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlertEvent {
    pub dst: String,
    pub rate: u32,
    #[serde(default)]
    pub src: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatsEvent {
    pub pps: u64,
    pub total: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default)]
    pub pass: u64,
    #[serde(default)]
    pub drop: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrafficHealthEvent {
    pub node_id: String,
    pub success: bool,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttackStateEvent {
    pub node_id: String,
    pub active: bool,
    pub packets_sent: u64,
    pub pps: u64,
    pub target: String,
    pub dst_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DefenseModeEvent {
    pub mode: String,
    pub blocked_udp_port: u16,
}

/// ラズパイ等の物理ボタン操作（action-node から hub へ送る）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PhysicalActionEvent {
    pub node_id: String,
    pub action: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src_ip: Option<String>,
    /// この操作が発生させる通信のプロトコル。相関時に制御通信用パケットを除外する。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_protocol: Option<String>,
    /// この操作が発生させる通信の宛先ポート。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_dst_port: Option<u16>,
}

/// 物理操作と eBPF flow の相関結果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionCorrelatedEvent {
    pub node_id: String,
    pub action: String,
    pub label: String,
    pub protocol: String,
    pub src: String,
    pub src_port: u16,
    pub dst: String,
    pub dst_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SensorEvent {
    pub node_id: String,
    pub tag: String,
    pub metric: SensorMetric,
    pub value: f32,
    pub unit: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SensorMetric {
    Temperature,
    Humidity,
    Vibration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GuidanceEvent {
    pub scenario: ScenarioId,
    pub cause: CauseAxis,
    pub severity: Severity,
    pub headline: String,
    pub summary: String,
    pub actions: Vec<ActionItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unaffected_note: Option<String>,
    pub sources: Vec<SourceRef>,
    pub degraded: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioId {
    LateralMovement,
    AccessPointOverheat,
    PacketFlood,
    CombinedPhysicalNetwork,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CauseAxis {
    Network,
    Physical,
    Combined,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Watch,
    Urgent,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionItem {
    pub priority: u8,
    pub text: String,
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceRef {
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FhirSnapshotEvent {
    pub scenario: ScenarioId,
    pub note: String,
    pub patients: Vec<MockPatient>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MockPatient {
    pub id: String,
    pub name: String,
    pub room: String,
    pub chief_complaint: String,
    pub last_vitals: String,
}

/// 上流（xdp-hello / mock-sensor / action-node）から届く未加工 NDJSON 行を解釈する。
pub fn parse_upstream_line(line: &str) -> Option<UpstreamEvent> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let kind = value.get("type")?.as_str()?;

    match kind {
        "flow" => Some(UpstreamEvent::Flow(FlowEvent {
            protocol: value.get("protocol")?.as_str()?.to_string(),
            action: value
                .get("action")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            src: value.get("src")?.as_str()?.to_string(),
            src_port: value.get("src_port")?.as_u64()? as u16,
            dst: value.get("dst")?.as_str()?.to_string(),
            dst_port: value.get("dst_port")?.as_u64()? as u16,
        })),
        "alert" => Some(UpstreamEvent::Alert(AlertEvent {
            dst: value.get("dst")?.as_str()?.to_string(),
            rate: value.get("rate")?.as_u64()? as u32,
            src: value
                .get("src")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })),
        "stats" => Some(UpstreamEvent::Stats(StatsEvent {
            pps: value.get("pps")?.as_u64()?,
            total: value.get("total")?.as_u64()?,
            mode: value
                .get("mode")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            pass: value.get("pass").and_then(|v| v.as_u64()).unwrap_or_default(),
            drop: value.get("drop").and_then(|v| v.as_u64()).unwrap_or_default(),
        })),
        "traffic_health" => Some(UpstreamEvent::TrafficHealth(TrafficHealthEvent {
            node_id: value.get("node_id")?.as_str()?.to_string(),
            success: value.get("success")?.as_bool()?,
            latency_ms: value.get("latency_ms")?.as_u64()?,
            status_code: value
                .get("status_code")
                .and_then(|v| v.as_u64())
                .and_then(|v| u16::try_from(v).ok()),
        })),
        "attack_state" => Some(UpstreamEvent::AttackState(AttackStateEvent {
            node_id: value.get("node_id")?.as_str()?.to_string(),
            active: value.get("active")?.as_bool()?,
            packets_sent: value.get("packets_sent")?.as_u64()?,
            pps: value.get("pps")?.as_u64()?,
            target: value.get("target")?.as_str()?.to_string(),
            dst_port: u16::try_from(value.get("dst_port")?.as_u64()?).ok()?,
        })),
        "defense_mode" => Some(UpstreamEvent::DefenseMode(DefenseModeEvent {
            mode: value.get("mode")?.as_str()?.to_string(),
            blocked_udp_port: u16::try_from(value.get("blocked_udp_port")?.as_u64()?).ok()?,
        })),
        "sensor" => {
            let metric = match value.get("metric")?.as_str()? {
                "temperature" => SensorMetric::Temperature,
                "humidity" => SensorMetric::Humidity,
                "vibration" => SensorMetric::Vibration,
                _ => return None,
            };
            Some(UpstreamEvent::Sensor(SensorEvent {
                node_id: value.get("node_id")?.as_str()?.to_string(),
                tag: value.get("tag")?.as_str()?.to_string(),
                metric,
                value: value.get("value")?.as_f64()? as f32,
                unit: value.get("unit")?.as_str()?.to_string(),
            }))
        }
        "physical_action" => Some(UpstreamEvent::PhysicalAction(PhysicalActionEvent {
            node_id: value.get("node_id")?.as_str()?.to_string(),
            action: value.get("action")?.as_str()?.to_string(),
            label: value.get("label")?.as_str()?.to_string(),
            src_ip: value
                .get("src_ip")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            expected_protocol: value
                .get("expected_protocol")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            expected_dst_port: value
                .get("expected_dst_port")
                .and_then(|v| v.as_u64())
                .and_then(|v| u16::try_from(v).ok()),
        })),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum UpstreamEvent {
    Flow(FlowEvent),
    Alert(AlertEvent),
    Stats(StatsEvent),
    Sensor(SensorEvent),
    PhysicalAction(PhysicalActionEvent),
    TrafficHealth(TrafficHealthEvent),
    AttackState(AttackStateEvent),
    DefenseMode(DefenseModeEvent),
}

impl UpstreamEvent {
    pub fn to_stream_event(&self) -> StreamEvent {
        match self {
            Self::Flow(e) => StreamEvent::Flow(e.clone()),
            Self::Alert(e) => StreamEvent::Alert(e.clone()),
            Self::Stats(e) => StreamEvent::Stats(e.clone()),
            Self::Sensor(e) => StreamEvent::Sensor(e.clone()),
            Self::PhysicalAction(e) => StreamEvent::PhysicalAction(e.clone()),
            Self::TrafficHealth(e) => StreamEvent::TrafficHealth(e.clone()),
            Self::AttackState(e) => StreamEvent::AttackState(e.clone()),
            Self::DefenseMode(e) => StreamEvent::DefenseMode(e.clone()),
        }
    }
}

impl StreamEvent {
    pub fn to_json_line(&self) -> String {
        serde_json::to_string(self).expect("stream event serializes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flow_line() {
        let event = parse_upstream_line(
            r#"{"type":"flow","protocol":"TCP","src":"10.0.0.2","src_port":1234,"dst":"10.0.0.1","dst_port":443}"#,
        )
        .expect("flow");
        assert!(matches!(event, UpstreamEvent::Flow(_)));
    }

    #[test]
    fn parses_harbor_runtime_events() {
        assert!(matches!(
            parse_upstream_line(r#"{"type":"traffic_health","node_id":"pi-a","success":true,"latency_ms":12,"status_code":200}"#),
            Some(UpstreamEvent::TrafficHealth(_))
        ));
        assert!(matches!(
            parse_upstream_line(r#"{"type":"attack_state","node_id":"pi-a","active":true,"packets_sent":1000,"pps":1000,"target":"192.168.1.10","dst_port":4000}"#),
            Some(UpstreamEvent::AttackState(_))
        ));
        assert!(matches!(
            parse_upstream_line(r#"{"type":"defense_mode","mode":"protect","blocked_udp_port":4000}"#),
            Some(UpstreamEvent::DefenseMode(_))
        ));
    }


    #[test]
    fn parses_physical_action_line() {
        let event = parse_upstream_line(
            r#"{"type":"physical_action","node_id":"pi-1","action":"check_status","label":"状態確認","src_ip":"192.168.1.50"}"#,
        )
        .expect("physical_action");
        assert!(matches!(event, UpstreamEvent::PhysicalAction(_)));
    }
}
