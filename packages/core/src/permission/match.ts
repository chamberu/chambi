/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PERMISSION_ALL } from './constants.ts';

/**
 * True when `granted` is `*`, or has as many `:` segments as `wanted`
 * with every segment equal or `*` (a `*` segment matches exactly one
 * segment; case-sensitive).
 */
export function matchesPermission(granted: string, wanted: string): boolean {
    if (granted === PERMISSION_ALL) {
        return true;
    }

    const want = wanted.split(':');
    const have = granted.split(':');

    if (want.length !== have.length) {
        return false;
    }

    return have.every((segment, i) => segment === '*' || segment === want[i]);
}

/** True when any entry of `permissions` matches `wanted` (see matchesPermission). */
export function hasPermission(permissions: readonly string[], wanted: string): boolean {
    return permissions.some((granted) => matchesPermission(granted, wanted));
}

/** `tool:<agent>:<tool>`. */
export function toolPermission(agent: string, tool: string): string {
    return `tool:${agent}:${tool}`;
}
