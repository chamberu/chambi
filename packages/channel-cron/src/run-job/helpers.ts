/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    ChannelSubscription,
    Engine,
    IRunRepository,
    Run,
} from '@chamvi/core';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isCronChannel } from '../channel/helpers.ts';

/**
 * The cron subscription a job fires: `subscriptionId`, or the agent's only
 * subscription of a cron channel the engine holds. Throws
 * InvalidAgentDefinitionError when it is missing or ambiguous.
 */
export function resolveCronSubscription(engine: Engine, agent: Agent, subscriptionId?: string): ChannelSubscription {
    const crons = (agent.definition.channels ?? []).filter((s) => isCronChannel(engine.getChannel(s.channel)));
    if (subscriptionId !== undefined) {
        const subscription = crons.find((s) => s.id === subscriptionId);
        if (!subscription) {
            throw new InvalidAgentDefinitionError(`Agent "${agent.name}" has no cron subscription "${subscriptionId}".`);
        }
        return subscription;
    }
    if (crons.length !== 1) {
        throw new InvalidAgentDefinitionError(
            `Agent "${agent.name}" has ${crons.length} cron subscriptions; pass the subscription id.`,
        );
    }
    return crons[0] as ChannelSubscription;
}

/**
 * Whether a queued run is held back by a run of its concurrency key that waits
 * for an approval: it starts only once a human answers (or the approval times
 * out), so a job must not wait for it.
 */
export async function isQueuedBehindApproval(store: Pick<IRunRepository, 'find'>, run: Run): Promise<boolean> {
    if (run.status !== 'queued' || run.concurrencyKey === undefined) return false;
    const { total } = await store.find({
        agent: run.agent,
        status: ['waiting'],
        concurrencyKey: run.concurrencyKey,
        limit: 1,
    });
    return total > 0;
}
