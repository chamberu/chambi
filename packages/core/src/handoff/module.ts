/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { isObject } from 'smob';
import type { StateSchema } from '../state/types.ts';
import { AGENT_CHANNEL_NAME } from '../channel/constants.ts';
import { inject } from '../context/module.ts';
import { currentToolCall } from '../effect/frame.ts';
import { stableHash } from '../effect/helpers.ts';
import { InvalidRunStateError, ValidationError } from '../errors/index.ts';
import type { ToolContext } from '../tool/types.ts';
import {
    DEFAULT_MAX_HANDOFFS_PER_RUN,
    HANDOFF_CONTEXT,
    HANDOFF_SUBSCRIPTION_ID,
    MAX_HANDOFF_DEPTH,
} from './constants.ts';
import {
    assertHandoffKey,
    claimKey,
    findHandoffSubscription,
    validatePayload,
} from './helpers.ts';
import type { HandoffInput, HandoffResult } from './types.ts';

/**
 * Starts a run of the calling run's own agent (fire and forget): channel
 * `agent`, subscription `handoff`, the parent's invoker, `trigger.parent`
 * naming this run. The agent opts in with `handoff.on()`. Effect-recorded
 * per run and call, and deduplicated across runs by the idempotency key
 * (`handoff:<key>`), so a second run handing off the same key gets the first
 * child (`deduplicated: true`). A handed-off run cannot hand off again, and
 * a run starts at most `maxPerRun` hand-offs over all its executions.
 */
export async function startHandoff<S extends StateSchema = StateSchema>(
    ctx: ToolContext<S>,
    input: HandoffInput,
): Promise<HandoffResult> {
    const frame = currentToolCall();
    if (!frame) {
        throw new InvalidRunStateError('startHandoff() runs inside a tool call, not in the tools factory.');
    }
    if (ctx?.run?.runId !== frame.runId) {
        throw new InvalidRunStateError('startHandoff() got the context of another run than the tool call it runs in.');
    }
    const host = inject(ctx, HANDOFF_CONTEXT);
    if (!isObject(input)) throw new ValidationError('startHandoff() needs an input object.');
    if (input.payload === undefined) throw new ValidationError('startHandoff() needs a payload.');
    assertHandoffKey('idempotency key', input.idempotencyKey, false);
    assertHandoffKey('concurrency key', input.concurrencyKey, true);
    assertHandoffKey('address', input.address, true);

    const { run } = ctx;
    const agent = host.getAgent(run.agent);
    const subscription = agent ? findHandoffSubscription(agent) : undefined;
    if (!subscription) {
        throw new ValidationError(`Agent "${run.agent}" accepts no hand-offs: add handoff.on() to its channels.`);
    }
    const depth = run.trigger.parent?.kind === 'handoff' ? run.trigger.parent.depth : 0;
    if (depth >= MAX_HANDOFF_DEPTH) {
        throw new ValidationError(`A handed-off run cannot hand off again (depth ${MAX_HANDOFF_DEPTH}).`);
    }

    const payload = await validatePayload(run.agent, subscription.options.schema as StandardSchemaV1 | undefined, input.payload);
    const concurrencyKey = input.concurrencyKey ?? subscription.concurrencyKey?.(payload);
    assertHandoffKey('concurrency key', concurrencyKey, true);
    const given = input.idempotencyKey ?? subscription.idempotencyKey?.(payload);
    assertHandoffKey('idempotency key', given, false);
    const { address } = input;
    const key = claimKey(given ?? `${run.runId}:${stableHash({
        payload, 
        concurrencyKey, 
        address, 
    })}`);
    const effectKey = `${run.runId}:handoff:${stableHash({
        payload,
        key,
        concurrencyKey,
        address,
    })}`;

    const recorded = await host.effects.getEffect(effectKey);
    if (recorded) return recorded.result as HandoffResult;
    const pending = host.inflight.get(effectKey);
    if (pending) return pending;

    const maxPerRun = (subscription.options.maxPerRun as number | undefined) ?? DEFAULT_MAX_HANDOFFS_PER_RUN;
    const promise = host.serial(run.runId, async (): Promise<HandoffResult> => {
        const countKey = `handoff-count:${run.runId}`;
        const stored = await host.effects.getEffect(countKey);
        const count = isObject(stored?.result) && typeof stored.result.count === 'number' ? stored.result.count : 0;
        if (count >= maxPerRun) {
            throw new ValidationError(`Run ${run.runId} reached its ${maxPerRun} hand-offs (handoff.on({ maxPerRun })).`);
        }
        // counted before the dispatch: a crash in between burns one slot, never adds one
        await host.effects.putEffect(countKey, { count: count + 1 });
        const { invoker } = run.trigger;
        const result = await host.dispatch({
            agent: run.agent,
            trigger: HANDOFF_SUBSCRIPTION_ID,
            channel: AGENT_CHANNEL_NAME,
            payload,
            idempotencyKey: key,
            ...(concurrencyKey !== undefined ? { concurrencyKey } : {}),
            ...(address !== undefined ? { address } : {}),
            ...(invoker ? { invoker } : {}),
        }, {
            kind: 'handoff',
            runId: run.runId,
            agent: run.agent,
            depth: depth + 1,
        });
        const value: HandoffResult = { runId: result.runId, deduplicated: result.deduplicated };
        // the child exists: a failing record must not fail the call (dispatch dedupes a redo)
        try {
            await host.effects.putEffect(effectKey, value);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[chamvi] recording a hand-off failed', error);
        }
        return value;
    });
    host.inflight.set(effectKey, promise);
    try {
        return await promise;
    } finally {
        if (host.inflight.get(effectKey) === promise) host.inflight.delete(effectKey);
    }
}
