/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import type { ChatEvent, ChatPayload } from '../channel/types.ts';

export type ChatSubscriptionOptions = {
    /** Only messages of this adapter (its name); default every adapter of the channel. */
    adapter?: string;
    /**
     * The messages that start a run: `direct` (a direct chat), `mention` (the
     * bot mentioned in a group), `message` (any other group message). Default
     * `['direct', 'mention']`.
     */
    events?: readonly ChatEvent[];
    /** Default `chat:<events joined by ','>`, with the adapter `chat:<adapter>:<events>`. */
    id?: string;
    /** Runs after the event match; a message it refuses starts no run of this subscription. */
    filter?: (payload: ChatPayload) => boolean;
    /** Shared-store execution cap within the agent; omitted or false adds no cap. */
    concurrencyMaxRuns?: number | false;
};

/** A chat of one adapter, for `to()`. */
export type ChatTarget = {
    /** The adapter's name. */
    adapter: string;
    /** The Chat SDK thread id. */
    threadId: string;
};

/** Makes chat subscriptions and addresses for one channel name. */
export type ChatSubscriber = {
    /** A subscription to the channel's incoming messages. */
    on(options?: ChatSubscriptionOptions): ChannelSubscription<ChatPayload>;
    /** The address of a chat; ValidationError when it does not fit 255 characters. */
    to(target: ChatTarget): string;
};
