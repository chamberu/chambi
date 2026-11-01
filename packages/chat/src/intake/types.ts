/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelDispatchEnvelope, ConversationTarget } from '@chamvi/core';

/** One dispatch of an accepted message (internal): the agent's envelope, plus the conversation for a bound agent. */
export type ChatDispatch = {
    agent: string;
    envelope: ChannelDispatchEnvelope;
    conversation?: ConversationTarget;
};

/** A failed dispatch of one attempt (internal). */
export type ChatDispatchFailure = {
    agent: string;
    error: unknown;
    /** a retry may succeed (a store failure), unlike a refusal (validation, policy, agent gone) */
    transient: boolean;
};
