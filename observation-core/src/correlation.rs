use crate::events::{
    ActionCorrelatedEvent, FlowEvent, PhysicalActionEvent, StreamEvent, UpstreamEvent,
};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

const MATCH_WINDOW: Duration = Duration::from_secs(2);
const MAX_PENDING: usize = 32;

#[derive(Debug, Clone)]
struct PendingAction {
    action: PhysicalActionEvent,
    received_at: Instant,
}

/// 物理操作イベントと eBPF flow の時刻・送信元 IP で相関する。
#[derive(Debug, Default)]
pub struct CorrelationEngine {
    pending: VecDeque<PendingAction>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CorrelationOutput {
    Passthrough(StreamEvent),
    Correlated(ActionCorrelatedEvent),
}

impl CorrelationEngine {
    pub fn ingest(&mut self, upstream: &UpstreamEvent) -> Vec<CorrelationOutput> {
        match upstream {
            UpstreamEvent::PhysicalAction(action) => self.ingest_physical_action(action.clone()),
            UpstreamEvent::Flow(flow) => self.ingest_flow(flow.clone()),
            other => vec![CorrelationOutput::Passthrough(other.to_stream_event())],
        }
    }

    fn ingest_physical_action(&mut self, action: PhysicalActionEvent) -> Vec<CorrelationOutput> {
        self.prune_expired();
        self.pending.push_back(PendingAction {
            action: action.clone(),
            received_at: Instant::now(),
        });
        while self.pending.len() > MAX_PENDING {
            self.pending.pop_front();
        }
        vec![CorrelationOutput::Passthrough(StreamEvent::PhysicalAction(
            action,
        ))]
    }

    fn ingest_flow(&mut self, flow: FlowEvent) -> Vec<CorrelationOutput> {
        self.prune_expired();
        let mut outputs = vec![CorrelationOutput::Passthrough(StreamEvent::Flow(
            flow.clone(),
        ))];

        if let Some(index) = self.find_matching_index(&flow) {
            let pending = self.pending.remove(index).expect("index valid");
            outputs.push(CorrelationOutput::Correlated(ActionCorrelatedEvent {
                node_id: pending.action.node_id,
                action: pending.action.action,
                label: pending.action.label,
                protocol: flow.protocol.clone(),
                src: flow.src.clone(),
                src_port: flow.src_port,
                dst: flow.dst.clone(),
                dst_port: flow.dst_port,
            }));
        }

        outputs
    }

    fn find_matching_index(&self, flow: &FlowEvent) -> Option<usize> {
        self.pending.iter().position(|pending| {
            let within_window = pending.received_at.elapsed() <= MATCH_WINDOW;
            if !within_window {
                return false;
            }
            let src_matches = pending
                .action
                .src_ip
                .as_ref()
                .is_none_or(|expected| expected == &flow.src);
            let protocol_matches = pending
                .action
                .expected_protocol
                .as_ref()
                .is_none_or(|expected| expected.eq_ignore_ascii_case(&flow.protocol));
            let dst_port_matches = pending
                .action
                .expected_dst_port
                .is_none_or(|expected| expected == flow.dst_port);

            src_matches && protocol_matches && dst_port_matches
        })
    }

    fn prune_expired(&mut self) {
        self.pending
            .retain(|p| p.received_at.elapsed() <= MATCH_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_action(src_ip: Option<&str>) -> PhysicalActionEvent {
        PhysicalActionEvent {
            node_id: "booth-pi-1".to_string(),
            action: "check_status".to_string(),
            label: "状態確認".to_string(),
            src_ip: src_ip.map(str::to_string),
            expected_protocol: Some("TCP".to_string()),
            expected_dst_port: Some(8080),
        }
    }

    fn sample_flow(src: &str) -> FlowEvent {
        FlowEvent {
            protocol: "TCP".to_string(),
            action: Some("PASS".to_string()),
            src: src.to_string(),
            src_port: 52341,
            dst: "192.168.1.10".to_string(),
            dst_port: 8080,
        }
    }

    #[test]
    fn correlates_flow_after_physical_action() {
        let mut engine = CorrelationEngine::default();
        let _ = engine.ingest(&UpstreamEvent::PhysicalAction(sample_action(Some(
            "192.168.1.50",
        ))));

        let outputs = engine.ingest(&UpstreamEvent::Flow(sample_flow("192.168.1.50")));
        assert_eq!(outputs.len(), 2);
        assert!(matches!(
            outputs[0],
            CorrelationOutput::Passthrough(StreamEvent::Flow(_))
        ));
        assert!(matches!(outputs[1], CorrelationOutput::Correlated(_)));
    }


    #[test]
    fn ignores_control_plane_flow_from_same_source() {
        let mut engine = CorrelationEngine::default();
        let _ = engine.ingest(&UpstreamEvent::PhysicalAction(sample_action(Some(
            "192.168.1.50",
        ))));

        let outputs = engine.ingest(&UpstreamEvent::Flow(FlowEvent {
            protocol: "TCP".to_string(),
            action: Some("PASS".to_string()),
            src: "192.168.1.50".to_string(),
            src_port: 52341,
            dst: "192.168.1.10".to_string(),
            dst_port: 9001,
        }));
        assert_eq!(outputs.len(), 1);
    }

    #[test]
    fn ignores_flow_with_mismatched_src() {
        let mut engine = CorrelationEngine::default();
        let _ = engine.ingest(&UpstreamEvent::PhysicalAction(sample_action(Some(
            "192.168.1.50",
        ))));

        let outputs = engine.ingest(&UpstreamEvent::Flow(sample_flow("10.0.0.2")));
        assert_eq!(outputs.len(), 1);
    }
}
