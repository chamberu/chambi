/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isIP } from 'node:net';
import { BLOCKED_IPV4, BLOCKED_IPV6 } from './constants.ts';

type Range = { bytes: Uint8Array; prefix: number };

function parseIpv4(text: string): Uint8Array | undefined {
    if (isIP(text) !== 4) return undefined;
    return new Uint8Array(text.split('.').map(Number));
}

function parseIpv6(text: string): Uint8Array | undefined {
    if (isIP(text) !== 6) return undefined;
    let source = text.toLowerCase();
    // a trailing dotted quad becomes two groups
    const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(source);
    if (quad?.[1]) {
        const v4 = parseIpv4(quad[1])!;
        const tail = `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
        source = source.slice(0, quad.index) + tail;
    }
    const [head = '', rest] = source.split('::');
    const left = head ? head.split(':') : [];
    const right = rest ? rest.split(':') : [];
    const fill = rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill('0');
    const groups = [...left, ...fill, ...right];
    const bytes = new Uint8Array(16);
    groups.forEach((group, index) => {
        const value = Number.parseInt(group, 16);
        bytes[index * 2] = value >> 8;
        bytes[index * 2 + 1] = value & 0xFF;
    });
    return bytes;
}

/** The bytes of an IPv4 (4) or IPv6 (16) address (brackets allowed), else undefined. */
export function parseAddress(address: string): Uint8Array | undefined {
    const text = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
    return parseIpv4(text) ?? parseIpv6(text);
}

function toRanges(cidrs: readonly string[]): Range[] {
    return cidrs.map((cidr) => {
        const [address = '', prefix = ''] = cidr.split('/');
        return { bytes: parseAddress(address)!, prefix: Number(prefix) };
    });
}

const IPV4_RANGES = toRanges(BLOCKED_IPV4);
const IPV6_RANGES = toRanges(BLOCKED_IPV6);

function inRange(bytes: Uint8Array, range: Range): boolean {
    for (let bit = 0; bit < range.prefix; bit++) {
        const mask = 0x80 >> (bit % 8);
        if ((bytes[bit >> 3]! & mask) !== (range.bytes[bit >> 3]! & mask)) return false;
    }
    return true;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
    return prefix.every((value, index) => bytes[index] === value);
}

/** The IPv4 address an IPv4-mapped, NAT64 or 6to4 address carries. */
function embeddedIpv4(bytes: Uint8Array): Uint8Array | undefined {
    if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF])) return bytes.slice(12);
    if (startsWith(bytes, [0, 0x64, 0xFF, 0x9B, 0, 0, 0, 0, 0, 0, 0, 0])) return bytes.slice(12);
    if (startsWith(bytes, [0x20, 0x02])) return bytes.slice(2, 6);
    return undefined;
}

/**
 * True for every address a tool must not reach (loopback, private,
 * link-local, CGNAT, multicast, metadata, reserved) and for anything that
 * is no IP address.
 */
export function isBlockedAddress(address: string): boolean {
    const bytes = parseAddress(address);
    if (!bytes) return true;
    if (bytes.length === 4) return IPV4_RANGES.some((range) => inRange(bytes, range));
    const v4 = embeddedIpv4(bytes);
    if (v4) return IPV4_RANGES.some((range) => inRange(v4, range));
    return IPV6_RANGES.some((range) => inRange(bytes, range));
}
