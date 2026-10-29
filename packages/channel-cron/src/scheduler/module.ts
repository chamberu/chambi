/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { hostname } from 'node:os';
import { pid } from 'node:process';
import type { Agent, AgentChange } from '@chamvi/core';
import { defineScheduledComponent } from 'hubwire';
import { CRON_CHANNEL_NAME } from '../channel/constants.ts';
import { createRepositoryScheduleLock } from '../lock/index.ts';
import { readCronOptions } from '../tick/index.ts';
import { SCHEDULE_LOCK_TTL_MS } from './constants.ts';
import { buildAgentComponents, cronSubscriptionsOf, toDefinitionError } from './helpers.ts';
import type { IScheduler, SchedulerOptions } from './types.ts';

/**
 * Throws InvalidAgentDefinitionError for a subscription of the cron channel
 * `channel` (default `cron`) hubwire cannot schedule (an expression croner
 * refuses, a timezone, an expression without a future run), as the channel's
 * start does; schedules nothing.
 */
export function assertSchedulable(agent: Agent, channel: string = CRON_CHANNEL_NAME): void {
    for (const subscription of cronSubscriptionsOf(agent, channel)) {
        try {
            const { expression, timezone } = readCronOptions(agent, subscription);
            defineScheduledComponent({
                name: `cron:${agent.name}:${subscription.id}`,
                schedule: expression,
                timezone,
                run: async () => {},
            });
        } catch (e) {
            throw toDefinitionError(agent, subscription, e);
        }
    }
}

/**
 * Schedules every subscription of the cron channel `channel` of the engine's
 * agents as one hubwire component, guarded by a per-tick lock in the engine's
 * store, so replicas sharing the store dispatch each tick once. Validates
 * every subscription up front: throws InvalidAgentDefinitionError for one
 * hubwire cannot schedule; a folder agent's (one with a revision) goes to
 * `onError` instead and leaves that agent unscheduled. Follows the engine's
 * `agents.changed` events: an added agent is scheduled, a replaced one
 * rescheduled, a removed one unscheduled; a replacement hubwire cannot
 * schedule goes to `onError` and leaves the agent unscheduled.
 * Internal: the cron channel creates one per start.
 */
export function createScheduler(opts: SchedulerOptions): IScheduler {
    const { engine, channel } = opts;
    const ctx = {
        engine,
        dispatch: opts.dispatch,
        lock: createRepositoryScheduleLock(engine.repositories.locks, opts.owner ?? `${hostname()}-${pid}`),
        lockTtlMs: opts.lockTtlMs ?? SCHEDULE_LOCK_TTL_MS,
        // eslint-disable-next-line no-console
        onError: opts.onError ?? ((error, errorCtx) => console.error('[chamvi]', error, errorCtx)),
    } satisfies Parameters<typeof buildAgentComponents>[0];

    type Scheduled = ReturnType<typeof buildAgentComponents>;
    const byAgent = new Map<string, Scheduled>();
    for (const agent of engine.listAgents()) {
        // a folder agent (one with a revision) never fails the scheduler: it was checked before it was registered
        const folder = engine.agentRevision(agent.name) !== undefined;
        byAgent.set(agent.name, buildAgentComponents(ctx, agent, channel, folder ? ctx.onError : undefined));
    }

    let started = false;
    let stopped = false;
    // stops of replaced and removed agents' components, awaited by stop()
    const pending = new Set<Promise<void>>();

    const retire = (agent: string, scheduled: Scheduled) => {
        for (const { subscription, component } of scheduled) {
            const settle = component.stop()
                .then(() => component.settled())
                .catch((error: unknown) => ctx.onError(error, { agent, subscription }))
                .finally(() => pending.delete(settle));
            pending.add(settle);
        }
    };

    const onChange = (change: AgentChange) => {
        if (stopped) return;
        const previous = byAgent.get(change.name);
        byAgent.delete(change.name);
        if (previous) retire(change.name, previous);
        if (change.kind === 'removed') return;

        const agent = engine.getAgent(change.name);
        if (!agent) return;
        const scheduled = buildAgentComponents(ctx, agent, channel, ctx.onError);
        byAgent.set(agent.name, scheduled);
        if (!started) return;
        for (const { subscription, component } of scheduled) {
            component.start().catch((error: unknown) => ctx.onError(error, { agent: agent.name, subscription }));
        }
    };
    const unsubscribe = engine.on('agents.changed', onChange);

    const all = () => Array.from(byAgent.values()).flat().map(({ component }) => component);

    return {
        async start() {
            if (started || stopped) return;
            started = true;
            await Promise.all(all().map((c) => c.start()));
        },
        async stop() {
            if (!stopped) {
                stopped = true;
                unsubscribe();
            }
            const components = all();
            await Promise.all(components.map((c) => c.stop()));
            await Promise.all([...components.map((c) => c.settled()), ...pending]);
        },
    };
}
