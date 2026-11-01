/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import { isObject } from 'smob';
import type { ChatPayload } from '../channel/types.ts';

/**
 * Whether a chat subscription takes `payload`: its adapter (when set), one of
 * its events, then its filter. A throwing filter throws.
 */
export function matchesChatSubscription(subscription: ChannelSubscription, payload: ChatPayload): boolean {
    const { options } = subscription;

    if (!isObject(options)) {
        return false;
    }

    if (options.adapter !== undefined && options.adapter !== payload.adapter) {
        return false;
    }

    if (!Array.isArray(options.events) || !options.events.includes(payload.event)) {
        return false;
    }

    return typeof options.filter === 'function' ? options.filter(payload) === true : true;
}
