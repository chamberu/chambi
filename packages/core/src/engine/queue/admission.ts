/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import type { Agent } from '../../agent/types.ts';
import { RunStatus } from '../../run/constants.ts';
import type { Run } from '../../run/types.ts';
import type { RunQueueOptions } from './types.ts';

function hasCaps(agent: Agent | undefined): boolean {
    return typeof agent?.definition.maxConcurrentRuns === 'number' ||
        (agent?.definition.channels ?? []).some((subscription) => typeof subscription.maxConcurrentRuns === 'number');
}

/** Count and transition share the agent lock, including starts of uncapped sibling subscriptions. */
export async function admitRun(
    opts: RunQueueOptions,
    run: Run,
    start: (candidate: Run) => Promise<Run | undefined>,
    mayStart?: (candidate: Run) => boolean,
): Promise<Run | undefined> {
    if (!hasCaps(opts.getAgent(run.agent))) return start(run);
    const key = `admission:${run.agent}`;
    const owner = randomUUID();
    if (!await opts.store.acquire(key, owner, opts.claimTtlMs)) return undefined;
    try {
        const candidate = await opts.store.getRun(run.id);
        if (!candidate || candidate.status !== RunStatus.QUEUED || (mayStart && !mayStart(candidate))) return undefined;
        const agent = opts.getAgent(candidate.agent);
        if (!agent && !candidate.cancelRequested) return undefined;
        if (!candidate.cancelRequested && agent) {
            const agentCap = agent.definition.maxConcurrentRuns;
            const subscriptionCap = agent.definition.channels
                ?.find((subscription) => subscription.id === candidate.trigger.trigger)?.maxConcurrentRuns;
            if (typeof agentCap === 'number' || typeof subscriptionCap === 'number') {
                const { data: running } = await opts.store.listRuns({ agent: candidate.agent, status: [RunStatus.RUNNING] });
                if (typeof agentCap === 'number' && running.length >= agentCap) return undefined;
                if (typeof subscriptionCap === 'number' &&
                    running.filter((active) => active.trigger.trigger === candidate.trigger.trigger).length >= subscriptionCap) return undefined;
            }
        }
        return await start(candidate);
    } finally {
        try {
            await opts.store.release(key, owner);
        } catch (error) {
            try {
                opts.onError(error, run);
            } catch {
                // A throwing reporter must not prevent launch after the running transition.
            }
        }
    }
}
