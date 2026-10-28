/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { assertConcurrencyMaxRuns } from '../channel/concurrency.ts';
import { AGENT_CHANNEL_NAME } from '../channel/constants.ts';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import { DEFAULT_MAX_HANDOFFS_PER_RUN, HANDOFF_SUBSCRIPTION_ID } from './constants.ts';
import type { HandoffSubscriber } from './types.ts';

/**
 * The opt-in for startHandoff(): an agent with `handoff.on()` in its
 * channels accepts runs its own runs hand off (channel `agent`, id
 * `handoff`, so at most one per agent). Pure data, like `http.on()`.
 */
export const handoff: HandoffSubscriber = {
    on: (options = {}) => {
        assertConcurrencyMaxRuns(options.concurrencyMaxRuns, 'handoff.on() concurrencyMaxRuns');
        const maxPerRun = options.maxPerRun ?? DEFAULT_MAX_HANDOFFS_PER_RUN;
        if (!Number.isSafeInteger(maxPerRun) || maxPerRun <= 0) {
            throw new InvalidAgentDefinitionError('handoff.on({ maxPerRun }) must be a positive integer.');
        }
        return {
            channel: AGENT_CHANNEL_NAME,
            id: HANDOFF_SUBSCRIPTION_ID,
            ...(options.concurrencyMaxRuns !== undefined ? { concurrencyMaxRuns: options.concurrencyMaxRuns } : {}),
            options: { schema: options.schema, maxPerRun },
            ...(options.concurrencyKey ? { concurrencyKey: options.concurrencyKey } : {}),
            ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        };
    },
};
