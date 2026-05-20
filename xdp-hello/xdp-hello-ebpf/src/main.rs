#![no_std]
#![no_main]

use aya_ebpf::{
    bindings::xdp_action,
    macros::{map, xdp},
    maps::RingBuf,
    programs::XdpContext,
};
use aya_log_ebpf::info;
use core::mem;
use xdp_hello_common::FlowEvent;

const ETH_HDR_LEN: usize = 14;
const ETH_P_IP: u16 = 0x0800;
const IPPROTO_ICMP: u8 = 1;
const IPPROTO_TCP: u8 = 6;
const IPPROTO_UDP: u8 = 17;

const ETH_TYPE_OFFSET: usize = 12;
const IPV4_VERSION_IHL_OFFSET: usize = ETH_HDR_LEN;
const IPV4_PROTOCOL_OFFSET: usize = ETH_HDR_LEN + 9;
const IPV4_SRC_ADDR_OFFSET: usize = ETH_HDR_LEN + 12;
const IPV4_DST_ADDR_OFFSET: usize = ETH_HDR_LEN + 16;
const IPV4_MIN_HDR_LEN: usize = 20;
const TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS: usize = ETH_HDR_LEN + IPV4_MIN_HDR_LEN;
const TCP_DATA_OFFSET_OFFSET: usize = TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 12;
const TCP_MIN_HDR_LEN: usize = 20;

#[map]
static EVENTS: RingBuf = RingBuf::with_byte_size(1 << 20, 0);

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
    let src_addr = read_ipv4_addr(&ctx, IPV4_SRC_ADDR_OFFSET)?;
    let dst_addr = read_ipv4_addr(&ctx, IPV4_DST_ADDR_OFFSET)?;
    let transport_offset = TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS;
    match protocol {
        IPPROTO_ICMP => {
            let icmp = ptr_at::<u8>(&ctx, transport_offset)?;
            let icmp_type = unsafe { *icmp };
            emit_flow_event(src_addr, dst_addr, 0, 0, IPPROTO_ICMP);
            info!(
                &ctx,
                "received IPv4 ICMP packet: src={}.{}.{}.{}, dst={}.{}.{}.{}, type={}",
                src_addr[0],
                src_addr[1],
                src_addr[2],
                src_addr[3],
                dst_addr[0],
                dst_addr[1],
                dst_addr[2],
                dst_addr[3],
                icmp_type
            );
        }
        IPPROTO_TCP => {
            let ports = ptr_at::<[u8; 4]>(&ctx, transport_offset)? as *const u8;
            let src_port = read_be_u16_at(ports);
            let dst_port = read_be_u16_at(unsafe { ports.add(2) });
            let tcp_data_offset = read_u8(&ctx, TCP_DATA_OFFSET_OFFSET)? >> 4;
            emit_flow_event(src_addr, dst_addr, src_port, dst_port, IPPROTO_TCP);
            info!(
                &ctx,
                "received IPv4 TCP packet: src={}.{}.{}.{}:{}, dst={}.{}.{}.{}:{}",
                src_addr[0],
                src_addr[1],
                src_addr[2],
                src_addr[3],
                src_port,
                dst_addr[0],
                dst_addr[1],
                dst_addr[2],
                dst_addr[3],
                dst_port
            );
            log_http_method(
                &ctx,
                src_addr,
                dst_addr,
                src_port,
                dst_port,
                tcp_data_offset,
            );
        }
        IPPROTO_UDP => {
            let ports = ptr_at::<[u8; 4]>(&ctx, transport_offset)? as *const u8;
            let src_port = read_be_u16_at(ports);
            let dst_port = read_be_u16_at(unsafe { ports.add(2) });
            emit_flow_event(src_addr, dst_addr, src_port, dst_port, IPPROTO_UDP);
            info!(
                &ctx,
                "received IPv4 UDP packet: src={}.{}.{}.{}:{}, dst={}.{}.{}.{}:{}",
                src_addr[0],
                src_addr[1],
                src_addr[2],
                src_addr[3],
                src_port,
                dst_addr[0],
                dst_addr[1],
                dst_addr[2],
                dst_addr[3],
                dst_port
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
fn read_ipv4_addr(ctx: &XdpContext, offset: usize) -> Result<[u8; 4], u32> {
    let addr = ptr_at::<[u8; 4]>(ctx, offset)? as *const u8;

    Ok([
        unsafe { *addr },
        unsafe { *addr.add(1) },
        unsafe { *addr.add(2) },
        unsafe { *addr.add(3) },
    ])
}

#[inline(always)]
fn read_be_u16_at(ptr: *const u8) -> u16 {
    let high = unsafe { *ptr } as u16;
    let low = unsafe { *ptr.add(1) } as u16;

    (high << 8) | low
}

#[inline(always)]
fn log_http_method(
    ctx: &XdpContext,
    src_addr: [u8; 4],
    dst_addr: [u8; 4],
    src_port: u16,
    dst_port: u16,
    tcp_data_offset: u8,
) {
    let payload_offset = match tcp_data_offset {
        5 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + TCP_MIN_HDR_LEN,
        6 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 24,
        7 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 28,
        8 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 32,
        9 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 36,
        10 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 40,
        11 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 44,
        12 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 48,
        13 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 52,
        14 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 56,
        15 => TRANSPORT_OFFSET_WITHOUT_IPV4_OPTIONS + 60,
        _ => return,
    };

    let payload = match ptr_at::<[u8; 4]>(ctx, payload_offset) {
        Ok(payload) => payload as *const u8,
        Err(_) => return,
    };
    let b0 = unsafe { *payload };
    let b1 = unsafe { *payload.add(1) };
    let b2 = unsafe { *payload.add(2) };
    let b3 = unsafe { *payload.add(3) };

    if b0 == b'G' && b1 == b'E' && b2 == b'T' && b3 == b' ' {
        info!(
            ctx,
            "detected HTTP GET: src={}.{}.{}.{}:{}, dst={}.{}.{}.{}:{}",
            src_addr[0],
            src_addr[1],
            src_addr[2],
            src_addr[3],
            src_port,
            dst_addr[0],
            dst_addr[1],
            dst_addr[2],
            dst_addr[3],
            dst_port
        );
    } else if b0 == b'P' && b1 == b'O' && b2 == b'S' && b3 == b'T' {
        info!(
            ctx,
            "detected HTTP POST: src={}.{}.{}.{}:{}, dst={}.{}.{}.{}:{}",
            src_addr[0],
            src_addr[1],
            src_addr[2],
            src_addr[3],
            src_port,
            dst_addr[0],
            dst_addr[1],
            dst_addr[2],
            dst_addr[3],
            dst_port
        );
    }
}

#[inline(always)]
fn emit_flow_event(
    src_addr: [u8; 4],
    dst_addr: [u8; 4],
    src_port: u16,
    dst_port: u16,
    protocol: u8,
) {
    let Some(mut entry) = EVENTS.reserve::<FlowEvent>(0) else {
        return;
    };

    entry.write(FlowEvent {
        src_addr,
        dst_addr,
        src_port,
        dst_port,
        protocol,
        _pad: [0; 3],
    });
    entry.submit(0);
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[unsafe(link_section = "license")]
#[unsafe(no_mangle)]
static LICENSE: [u8; 13] = *b"Dual MIT/GPL\0";
