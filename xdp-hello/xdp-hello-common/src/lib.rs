#![no_std]

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct FlowEvent {
    pub src_addr: [u8; 4],
    pub dst_addr: [u8; 4],
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
    pub _pad: [u8; 3],
}
