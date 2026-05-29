#![no_std]

/// 通常のフロー観測イベント（パケットを1個さばいた記録）。
pub const EVENT_KIND_FLOW: u8 = 0;
/// パケットレート閾値超過アラート（盾が発動した瞬間）。
pub const EVENT_KIND_RATE_ALERT: u8 = 1;

/// eBPF から RingBuf 経由で地上（ユーザー空間）へ運ぶ統一イベント。
///
/// `kind` で種別を見分ける。`#[repr(C)]` なのでカーネル側で書いた
/// バイト列をユーザー空間でそのまま読み取れる。
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FlowEvent {
    pub kind: u8,
    pub protocol: u8,
    pub _pad: [u8; 2],
    pub src_addr: [u8; 4],
    pub dst_addr: [u8; 4],
    pub src_port: u16,
    pub dst_port: u16,
    /// レートアラート時の「1秒間に観測したパケット数」。flow では 0。
    pub rate: u32,
}
