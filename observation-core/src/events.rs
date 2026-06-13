use serde::{Deserialize, Serialize};

/// NDJSON 1 行として observation-hub が配信するイベント。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Flow(FlowEvent),
    Alert(AlertEvent),
    Stats(StatsEvent),
    Sensor(SensorEvent),
    Guidance(GuidanceEvent),
    FhirSnapshot(FhirSnapshotEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowEvent {
    pub protocol: String,
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

/// 上流（xdp-hello / mock-sensor）から届く未加工 NDJSON 行を解釈する。
pub fn parse_upstream_line(line: &str) -> Option<UpstreamEvent> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let kind = value.get("type")?.as_str()?;

    match kind {
        "flow" => Some(UpstreamEvent::Flow(FlowEvent {
            protocol: value.get("protocol")?.as_str()?.to_string(),
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
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum UpstreamEvent {
    Flow(FlowEvent),
    Alert(AlertEvent),
    Stats(StatsEvent),
    Sensor(SensorEvent),
}

impl UpstreamEvent {
    pub fn to_stream_event(&self) -> StreamEvent {
        match self {
            Self::Flow(e) => StreamEvent::Flow(e.clone()),
            Self::Alert(e) => StreamEvent::Alert(e.clone()),
            Self::Stats(e) => StreamEvent::Stats(e.clone()),
            Self::Sensor(e) => StreamEvent::Sensor(e.clone()),
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
}
