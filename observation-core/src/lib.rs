pub mod correlation;
pub mod events;
pub mod judgment;
pub mod mock_fhir;

pub use correlation::{CorrelationEngine, CorrelationOutput};
pub use events::{
    parse_upstream_line, ActionCorrelatedEvent, ActionItem, AlertEvent, CauseAxis, FlowEvent,
    GuidanceEvent, MockPatient, PhysicalActionEvent, ScenarioId, SensorEvent, SensorMetric,
    Severity, SourceRef, StreamEvent, UpstreamEvent,
};
pub use judgment::{JudgmentEngine, JudgmentOutput};
pub use mock_fhir::snapshot_for_scenario;
