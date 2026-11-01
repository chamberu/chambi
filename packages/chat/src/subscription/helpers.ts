/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import { isObject } from 'smob';
import { hashKey } from '../channel/helpers.ts';
import type { ChatPayload } from '../channel/types.ts';

/**
 * The idempotency key of a message: one run per agent, message and chat (a
 * hash of channel, adapter, thread, sender and message id; a platform such as
 * WhatsApp identifies a message by chat, sender and id).
 */
export function chatIdempotencyKey(channel: string, payload: Pick<ChatPayload, 'adapter' | 'threadId' | 'message'>): string {
    return hashKey([channel, payload.adapter, payload.threadId, payload.message.author.id, payload.message.id]);
}

/** The concurrency key of a chat: one run per chat at a time (a hash of channel, adapter and thread). */
export function chatConcurrencyKey(channel: string, payload: Pick<ChatPayload, 'adapter' | 'threadId'>): string {
    return hashKey([channel, payload.adapter, payload.threadId]);
}

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
