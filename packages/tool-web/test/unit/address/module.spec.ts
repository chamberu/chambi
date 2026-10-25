/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { isBlockedAddress, parseAddress } from '../../../src/address/module.ts';

describe('parseAddress', () => {
    it('reads IPv4 and IPv6 into bytes', () => {
        expect(parseAddress('10.0.0.1')).toEqual(new Uint8Array([10, 0, 0, 1]));
        expect(parseAddress('::1')).toEqual(new Uint8Array([...new Array(15).fill(0), 1]));
        expect(parseAddress('[::ffff:1.2.3.4]')?.slice(10)).toEqual(new Uint8Array([0xFF, 0xFF, 1, 2, 3, 4]));
        expect(parseAddress('2001:db8::8a2e:370:7334')?.slice(0, 4)).toEqual(new Uint8Array([0x20, 0x01, 0x0D, 0xB8]));
    });

    it('answers undefined for anything else', () => {
        expect(parseAddress('example.com')).toBeUndefined();
        expect(parseAddress('1.2.3')).toBeUndefined();
        expect(parseAddress('')).toBeUndefined();
    });
});

describe('isBlockedAddress', () => {
    it.each([
        '127.0.0.1',
        '127.255.0.9',
        '10.1.2.3',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '100.100.100.200',
        '0.0.0.0',
        '224.0.0.1',
        '239.255.255.250',
        '240.0.0.1',
        '255.255.255.255',
        '198.18.0.1',
        '192.0.0.170',
        '::1',
        '::',
        'fe80::1',
        'fc00::1',
        'fd00:ec2::254',
        'ff02::1',
        'fec0::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '::ffff:169.254.169.254',
        '64:ff9b::a00:1',
        '2002:a00:1::',
        '[::1]',
        'not-an-ip',
    ])('refuses %s', (address) => {
        expect(isBlockedAddress(address)).toBe(true);
    });

    it.each([
        '93.184.215.14',
        '8.8.8.8',
        '172.32.0.1',
        '100.128.0.1',
        '2606:4700::1111',
        '2a00:1450:4001:80b::200e',
        '::ffff:8.8.8.8',
        '64:ff9b::808:808',
        '2002:808:808::1',
    ])('allows %s', (address) => {
        expect(isBlockedAddress(address)).toBe(false);
    });
});
