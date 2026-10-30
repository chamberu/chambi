/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Agent, ChannelSubscription } from '@chamvi/core';
import type { IScheduleLock, IScheduledComponent, ScheduledComponentOptions } from 'hubwire';
import { defineScheduledComponent } from 'hubwire';
import type { CronChannelErrorContext } from '../channel/types.ts';
import { fireCronSubscription, readCronOptions } from '../tick/index.ts';
import type { SchedulerOptions } from './types.ts';

type ComponentContext = Required<Pick<SchedulerOptions, 'engine' | 'lockTtlMs' | 'onError'>> &
    Pick<SchedulerOptions, 'dispatch'> & { lock: IScheduleLock };

/**
 * The hubwire component options for one cron subscription. hubwire's onSkip
 * is not wired: on N replicas, N - 1 skip every tick.
 */
export function buildComponentOptions(
    ctx: ComponentContext,
    agent: Agent,
    subscription: ChannelSubscription,
): ScheduledComponentOptions {
    const { expression, timezone } = readCronOptions(agent, subscription);

    return {
        name: `cron:${agent.name}:${subscription.id}`,
        schedule: expression,
        timezone,
        lock: ctx.lock,
        lockTtlMs: ctx.lockTtlMs,
        // a start pass never takes the lock: it would fire on every replica on every start
        runOnStart: false,
        run: async ({ scheduledAt }) => {
            await fireCronSubscription({
                engine: ctx.engine,
                agent,
                subscription,
                scheduledAt,
                dispatch: ctx.dispatch,
            });
        },
        hooks: { onError: (error) => ctx.onError(error, { agent: agent.name, subscription: subscription.id }) },
    };
}

/** The agent's subscriptions of the cron channel `channel`. */
export function cronSubscriptionsOf(agent: Agent, channel: string): ChannelSubscription[] {
    return (agent.definition.channels ?? []).filter((s) => s.channel === channel);
}

/**
 * One hubwire component per subscription of the agent naming `channel`, with
 * the subscription's id. A subscription hubwire cannot schedule throws
 * InvalidAgentDefinitionError, or, with `onInvalid`, is reported there and
 * the agent gets no components at all.
 */
export function buildAgentComponents(
    ctx: ComponentContext,
    agent: Agent,
    channel: string,
    onInvalid?: (error: InvalidAgentDefinitionError, errorCtx: CronChannelErrorContext) => void,
): Array<{ subscription: string; component: IScheduledComponent }> {
    const components: Array<{ subscription: string; component: IScheduledComponent }> = [];

    for (const subscription of cronSubscriptionsOf(agent, channel)) {
        try {
            components.push({
                subscription: subscription.id,
                component: defineScheduledComponent(buildComponentOptions(ctx, agent, subscription)),
            });
        } catch (e) {
            const error = toDefinitionError(agent, subscription, e);

            if (!onInvalid) {
                throw error;
            }

            onInvalid(error, { agent: agent.name, subscription: subscription.id });

            return [];
        }
    }

    return components;
}

/** A hubwire definition error as InvalidAgentDefinitionError naming the agent and subscription. */
export function toDefinitionError(agent: Agent, subscription: ChannelSubscription, e: unknown): InvalidAgentDefinitionError {
    if (e instanceof InvalidAgentDefinitionError) {
        return e;
    }

    return new InvalidAgentDefinitionError(
        `Agent "${agent.name}" subscription "${subscription.id}": ${Error.isError(e) ? e.message : String(e)}`,
    );
}
