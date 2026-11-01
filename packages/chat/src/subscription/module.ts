/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, assertConcurrencyMaxRuns } from '@chamvi/core';
import type { ChannelSubscription } from '@chamvi/core';
import { isObject } from 'smob';
import { CHAT_CHANNEL_NAME } from '../channel/constants.ts';
import { encodeChatAddress } from '../channel/helpers.ts';
import type { ChatEvent, ChatPayload } from '../channel/types.ts';
import { CHAT_EVENTS, DEFAULT_CHAT_EVENTS } from './constants.ts';
import { chatConcurrencyKey, chatIdempotencyKey } from './helpers.ts';
import type { ChatSubscriber, ChatSubscriptionOptions, ChatTarget } from './types.ts';

function invalid(message: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`chat.on(): ${message}`);
}

function readEvents(events: unknown): ChatEvent[] {
    if (events === undefined) {
        return [...DEFAULT_CHAT_EVENTS];
    }

    if (!Array.isArray(events) || events.length === 0) {
        throw invalid(`events must list at least one of ${CHAT_EVENTS.join(', ')}.`);
    }

    const list: ChatEvent[] = [];

    for (const event of events) {
        if (!CHAT_EVENTS.includes(event)) {
            throw invalid(`event ${JSON.stringify(event)} must be one of ${CHAT_EVENTS.join(', ')}.`);
        }

        if (!list.includes(event)) {
            list.push(event);
        }
    }

    return list;
}

/**
 * A subscription of `channel` (a chat channel's name) to its incoming
 * messages. The idempotency key is a hash of channel, adapter, thread and
 * message id, the concurrency key one of channel, adapter and thread (one run
 * per chat at a time). `adapters` (a channel's adapter names) narrows the
 * adapter option. Throws InvalidAgentDefinitionError for an invalid option.
 */
export function createChatSubscription(
    channel: string,
    options: ChatSubscriptionOptions = {},
    adapters?: readonly string[],
): ChannelSubscription<ChatPayload> {
    if (!isObject(options)) {
        throw invalid('options must be an object.');
    }

    assertConcurrencyMaxRuns(options.concurrencyMaxRuns, 'chat.on() concurrencyMaxRuns');

    const { adapter, filter } = options;

    if (adapter !== undefined && (typeof adapter !== 'string' || adapter.length === 0)) {
        throw invalid('adapter must be a non-empty string.');
    }

    if (adapter !== undefined && adapters && !adapters.includes(adapter)) {
        throw invalid(`the channel has no adapter "${adapter}".`);
    }

    if (filter !== undefined && typeof filter !== 'function') {
        throw invalid('filter must be a function.');
    }

    const events = readEvents(options.events);
    const id = options.id ?? ['chat', ...(adapter !== undefined ? [adapter] : []), events.join(',')].join(':');

    if (typeof id !== 'string' || id.length === 0) {
        throw invalid('id must not be empty.');
    }

    return {
        channel,
        id,
        ...(options.concurrencyMaxRuns !== undefined ? { concurrencyMaxRuns: options.concurrencyMaxRuns } : {}),
        options: {
            events,
            ...(adapter !== undefined ? { adapter } : {}),
            ...(filter ? { filter } : {}),
        },
        concurrencyKey: (payload) => chatConcurrencyKey(channel, payload),
        idempotencyKey: (payload) => chatIdempotencyKey(channel, payload),
    };
}

/** The address of a chat; ValidationError when it does not fit (see encodeChatAddress). */
export function chatAddress(target: ChatTarget): string {
    return encodeChatAddress(target);
}

/**
 * Subscriptions and addresses for the default chat channel (`chatChannel()`,
 * named `chat`): `chat.on({ events: ['direct'] })`, `chat.to({ adapter,
 * threadId })`. Pure data, so agent folders use it without a channel
 * instance; it cannot check adapter names, a channel's own `on()`/`to()` do.
 */
export const chat: ChatSubscriber = {
    on: (options) => createChatSubscription(CHAT_CHANNEL_NAME, options),
    to: chatAddress,
};
