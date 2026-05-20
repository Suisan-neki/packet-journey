#![no_std]
#![no_main]

use aya_ebpf::{bindings::xdp_action, macros::xdp, programs::XdpContext};
use aya_log_ebpf::info;
use core::mem;

const ETH_HDR_LEN: usize = 14;
const ETH_P_IP: u16 = 0x0800;
const IPPROTO_ICMP: u8 = 1;
const IPPROTO_TCP: u8 = 6;
const IPPROTO_UDP: u8 = 17;

const ETH_TYPE_OFFSET: usize = 12;
const IPV4_VERSION_IHL_OFFSET: usize = ETH_HDR_LEN;
const IPV4_PROTOCOL_OFFSET: usize = ETH_HDR_LEN + 9;
const IPV4_MIN_HDR_LEN: usize = 20;
const TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS: usize = ETH_HDR_LEN + IPV4_MIN_HDR_LEN;

#[xdp]
pub fn xdp_hello(ctx: XdpContext) -> u32 {
    match try_xdp_hello(ctx) {
        Ok(ret) => ret,
        Err(_) => xdp_action::XDP_ABORTED,
    }
}

fn try_xdp_hello(ctx: XdpContext) -> Result<u32, u32> {
    let eth_type = read_be_u16(&ctx, ETH_TYPE_OFFSET)?;
    if eth_type != ETH_P_IP {
        info!(&ctx, "received non-IPv4 packet");
        return Ok(xdp_action::XDP_PASS);
    }

    ptr_at::<[u8; IPV4_MIN_HDR_LEN]>(&ctx, ETH_HDR_LEN)?;

    let version_ihl = unsafe { *ptr_at::<u8>(&ctx, IPV4_VERSION_IHL_OFFSET)? };
    let version = version_ihl >> 4;
    let ihl = version_ihl & 0x0f;
    if version != 4 || ihl < 5 {
        info!(&ctx, "received malformed IPv4 packet");
        return Ok(xdp_action::XDP_PASS);
    }
    if ihl != 5 {
        info!(&ctx, "received IPv4 packet with options");
        return Ok(xdp_action::XDP_PASS);
    }

    let protocol = read_u8(&ctx, IPV4_PROTOCOL_OFFSET)?;
    let transport_offset = TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS;
    match protocol {
        IPPROTO_ICMP => {
            let icmp = ptr_at::<u8>(&ctx, transport_offset)?;
            let icmp_type = unsafe { *icmp };
            info!(&ctx, "received IPv4 ICMP packet: type={}", icmp_type);
        }
        IPPROTO_TCP => {
            let ports = ptr_at::<[u8; 4]>(&ctx, transport_offset)? as *const u8;
            let src_port = read_be_u16_at(ports);
            let dst_port = read_be_u16_at(unsafe { ports.add(2) });
            info!(
                &ctx,
                "received IPv4 TCP packet: src_port={}, dst_port={}", src_port, dst_port
            );
        }
        IPPROTO_UDP => {
            let ports = ptr_at::<[u8; 4]>(&ctx, transport_offset)? as *const u8;
            let src_port = read_be_u16_at(ports);
            let dst_port = read_be_u16_at(unsafe { ports.add(2) });
            info!(
                &ctx,
                "received IPv4 UDP packet: src_port={}, dst_port={}", src_port, dst_port
            );
        }
        _ => info!(&ctx, "received IPv4 packet with other protocol"),
    }

    Ok(xdp_action::XDP_PASS)
}

#[inline(always)]
fn ptr_at<T>(ctx: &XdpContext, offset: usize) -> Result<*const T, u32> {
    let start = ctx.data();
    let end = ctx.data_end();
    let len = mem::size_of::<T>();

    if start + offset + len > end {
        return Err(xdp_action::XDP_ABORTED);
    }

    Ok((start + offset) as *const T)
}

#[inline(always)]
fn read_u8(ctx: &XdpContext, offset: usize) -> Result<u8, u32> {
    Ok(unsafe { *ptr_at::<u8>(ctx, offset)? })
}

#[inline(always)]
fn read_be_u16(ctx: &XdpContext, offset: usize) -> Result<u16, u32> {
    let high = read_u8(ctx, offset)? as u16;
    let low = read_u8(ctx, offset + 1)? as u16;

    Ok((high << 8) | low)
}

#[inline(always)]
fn read_be_u16_at(ptr: *const u8) -> u16 {
    let high = unsafe { *ptr } as u16;
    let low = unsafe { *ptr.add(1) } as u16;

    (high << 8) | low
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[unsafe(link_section = "license")]
#[unsafe(no_mangle)]
static LICENSE: [u8; 13] = *b"Dual MIT/GPL\0";
