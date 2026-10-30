/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { isObject } from 'smob';
import type { IAppEvent } from 'routup';
import type { HttpAppOptions } from '../app/types.ts';
import { routePath } from './helpers.ts';

export function validateChannelRateLimits(options: HttpAppOptions, channels: readonly IChannel[]): void {
    const policies = options.channelRateLimits;

    if (policies === undefined) {
        return;
    }

    if (!isObject(policies)) {
        throw new InvalidAgentDefinitionError('channelRateLimits must be an object of mounted channel policies.');
    }

    const names = new Set(channels.map((channel) => channel.name));

    for (const [name, policy] of Object.entries(policies)) {
        if (!names.has(name)) {
            throw new InvalidAgentDefinitionError(`channelRateLimits names unmounted channel "${name}".`);
        }

        if (policy === false) {
            continue;
        }

        if (!isObject(policy) || !Number.isSafeInteger(policy.max) || policy.max < 1) {
            throw new InvalidAgentDefinitionError(`channelRateLimits.${name}.max must be a positive safe integer.`);
        }

        if (policy.windowMs !== undefined &&
            (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1 || policy.windowMs > 2 ** 31 - 1)) {
            throw new InvalidAgentDefinitionError(`channelRateLimits.${name}.windowMs must be a positive integer no greater than 2147483647.`);
        }
    }
}

/** Only the mounted POST endpoint and its subpaths select a channel policy. */
export function matchesChannel(event: IAppEvent, basePath: string, name: string): boolean {
    if (event.method !== 'POST') {
        return false;
    }

    const base = basePath.toLowerCase();
    const path = event.path.toLowerCase();

    if (base && path !== base && !path.startsWith(`${base}/`)) {
        return false;
    }

    const relative = routePath(event, basePath);
    const own = `/channels/${name}`;

    return relative === own || relative.startsWith(`${own}/`);
}
