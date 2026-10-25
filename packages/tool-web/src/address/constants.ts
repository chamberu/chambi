/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * IPv4 ranges no tool reaches: this network, private (RFC 1918), CGNAT
 * (also Alibaba's metadata 100.100.100.200), loopback, link-local (also
 * the cloud metadata 169.254.169.254), IETF protocol assignments,
 * documentation, benchmarking, multicast, reserved and broadcast.
 */
export const BLOCKED_IPV4: readonly string[] = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
];

/**
 * IPv6 ranges no tool reaches: unspecified, loopback and the deprecated
 * IPv4-compatible block (`::/96`), discard, the local-use NAT64 block,
 * documentation, unique local (also AWS's metadata fd00:ec2::254),
 * link-local, site-local and multicast. IPv4-mapped (`::ffff:0:0/96`),
 * NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses are judged by
 * the IPv4 address they carry.
 */
export const BLOCKED_IPV6: readonly string[] = [
    '::/96',
    '100::/64',
    '64:ff9b:1::/48',
    '2001:db8::/32',
    'fc00::/7',
    'fe80::/10',
    'fec0::/10',
    'ff00::/8',
];
