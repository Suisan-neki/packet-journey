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
