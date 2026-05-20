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

#[xdp]
pub fn xdp_hello(ctx: XdpContext) -> u32 {
    match try_xdp_hello(ctx) {
        Ok(ret) => ret,
        Err(_) => xdp_action::XDP_ABORTED,
    }
}

fn try_xdp_hello(ctx: XdpContext) -> Result<u32, u32> {
    let eth_type = ((unsafe { *ptr_at::<u8>(&ctx, ETH_TYPE_OFFSET)? } as u16) << 8)
        | unsafe { *ptr_at::<u8>(&ctx, ETH_TYPE_OFFSET + 1)? } as u16;
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

    let protocol = unsafe { *ptr_at::<u8>(&ctx, IPV4_PROTOCOL_OFFSET)? };
    match protocol {
        IPPROTO_ICMP => info!(&ctx, "received IPv4 ICMP packet"),
        IPPROTO_TCP => info!(&ctx, "received IPv4 TCP packet"),
        IPPROTO_UDP => info!(&ctx, "received IPv4 UDP packet"),
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

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[unsafe(link_section = "license")]
#[unsafe(no_mangle)]
static LICENSE: [u8; 13] = *b"Dual MIT/GPL\0";
