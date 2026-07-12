#![no_std]

/// 通常のフロー観測イベント。
pub const EVENT_KIND_FLOW: u8 = 0;
/// パケットレート閾値超過アラート。
pub const EVENT_KIND_RATE_ALERT: u8 = 1;

pub const PACKET_ACTION_PASS: u8 = 0;
pub const PACKET_ACTION_DROP: u8 = 1;

pub const DEFENSE_MODE_MONITOR: u32 = 0;
pub const DEFENSE_MODE_PROTECT: u32 = 1;
pub const CONFIG_MODE_INDEX: u32 = 0;
pub const CONFIG_BLOCKED_UDP_PORT_INDEX: u32 = 1;

pub const COUNTER_PASS_INDEX: u32 = 0;
pub const COUNTER_DROP_INDEX: u32 = 1;

pub const fn packet_action(
    mode: u32,
    protocol: u8,
    dst_port: u16,
    blocked_udp_port: u32,
) -> u8 {
    const IPPROTO_UDP: u8 = 17;

    if mode == DEFENSE_MODE_PROTECT
        && protocol == IPPROTO_UDP
        && dst_port as u32 == blocked_udp_port
    {
        PACKET_ACTION_DROP
    } else {
        PACKET_ACTION_PASS
    }
}

/// eBPFからRingBuf経由でユーザー空間へ渡すサンプルイベント。
///
/// 集計値はCOUNTERS mapを正として扱う。RingBufは個々の通信を
/// 画面へ表示するためのサンプル経路であり、混雑時の全数保証はしない。
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FlowEvent {
    pub kind: u8,
    pub protocol: u8,
    pub action: u8,
    pub _pad: u8,
    pub src_addr: [u8; 4],
    pub dst_addr: [u8; 4],
    pub src_port: u16,
    pub dst_port: u16,
    /// レートアラート時の1秒間の観測数。flowでは0。
    pub rate: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_never_drops_the_attack_port() {
        assert_eq!(
            packet_action(DEFENSE_MODE_MONITOR, 17, 4000, 4000),
            PACKET_ACTION_PASS
        );
    }

    #[test]
    fn protect_drops_only_configured_udp_port() {
        assert_eq!(
            packet_action(DEFENSE_MODE_PROTECT, 17, 4000, 4000),
            PACKET_ACTION_DROP
        );
        assert_eq!(
            packet_action(DEFENSE_MODE_PROTECT, 17, 4001, 4000),
            PACKET_ACTION_PASS
        );
        assert_eq!(
            packet_action(DEFENSE_MODE_PROTECT, 6, 4000, 4000),
            PACKET_ACTION_PASS
        );
    }
}
