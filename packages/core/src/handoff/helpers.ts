/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { buildIssuesForStandardSchemaIssues } from '@validup/standard-schema';
import { isObject } from 'smob';
import type { Agent } from '../agent/types.ts';
import { AGENT_CHANNEL_NAME } from '../channel/constants.ts';
import type { ChannelSubscription } from '../channel/types.ts';
import { InvalidAgentDefinitionError, ValidationError } from '../errors/index.ts';
import type { RunContext } from '../run/types.ts';
import { describeIssues } from '../state/helpers.ts';
import { TRIGGER_KEY_MAX_LENGTH } from '../trigger/constants.ts';
import type { Invoker, TriggerParent } from '../trigger/types.ts';
import { DEFAULT_MAX_HANDOFFS_PER_RUN, HANDOFF_SUBSCRIPTION_ID } from './constants.ts';
import type { HandoffRunSnapshot } from './types.ts';

/** The agent's `handoff.on()` subscription (channel `agent`, id `handoff`), if any. */
export function findHandoffSubscription(agent: Agent): ChannelSubscription | undefined {
    return agent.definition.channels?.find((s) => s.channel === AGENT_CHANNEL_NAME && s.id === HANDOFF_SUBSCRIPTION_ID);
}

/** `payload` parsed by `schema` (the parsed value); without one unchanged. */
export async function validatePayload(agent: string, schema: StandardSchemaV1 | undefined, payload: unknown): Promise<unknown> {
    if (!schema) {
        return payload;
    }

    const result = await schema['~standard'].validate(payload);

    if (result.issues) {
        const issues = buildIssuesForStandardSchemaIssues(result.issues);
        throw new ValidationError(`Invalid hand-off payload for agent "${agent}": ${describeIssues(issues)}`, issues);
    }

    return result.value;
}

/** The idempotency key a hand-off claims: `handoff:<key>`, or `sha256:<hex>` of it above 255 characters. */
export function claimKey(key: string): string {
    const prefixed = `handoff:${key}`;

    if (prefixed.length <= TRIGGER_KEY_MAX_LENGTH) {
        return prefixed;
    }

    return `sha256:${createHash('sha256').update(prefixed).digest('hex')}`;
}

/** A given key: a non-empty string without NUL (the idempotency key may be long, it is hashed). */
export function assertHandoffKey(name: string, value: unknown, bounded: boolean): asserts value is string | undefined {
    if (value === undefined) {
        return;
    }

    if (typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
        (!bounded || value.length <= TRIGGER_KEY_MAX_LENGTH)) {
        return;
    }

    const bound = bounded ? ` of at most ${TRIGGER_KEY_MAX_LENGTH} characters` : '';
    throw new ValidationError(`The hand-off ${name} must be a non-empty string${bound} without NUL.`);
}

/**
 * The subscription's `maxPerRun` (default DEFAULT_MAX_HANDOFFS_PER_RUN);
 * InvalidAgentDefinitionError for a value that is no positive safe integer
 * (a subscription built by hand, or options changed after handoff.on()).
 */
export function maxPerRunOf(agent: string, subscription: ChannelSubscription): number {
    const value = (subscription.options as Record<string, unknown> | undefined)?.maxPerRun;

    if (value === undefined) {
        return DEFAULT_MAX_HANDOFFS_PER_RUN;
    }

    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new InvalidAgentDefinitionError(`Agent "${agent}": the hand-off subscription's maxPerRun must be a positive integer.`);
    }

    return value;
}

/** Refuses an agent whose hand-off subscription has an invalid `maxPerRun` (the engine's registration check). */
export function assertHandoffSubscription(agent: Agent): void {
    const subscription = findHandoffSubscription(agent);

    if (subscription) {
        maxPerRunOf(agent.name, subscription);
    }
}

// the engine's copy of each execution's run, taken before any tool runs
const snapshots = new WeakMap<RunContext, HandoffRunSnapshot>();

function cloneInvoker(invoker: Invoker): Invoker {
    return {
        id: invoker.id,
        kind: invoker.kind,
        ...(invoker.name !== undefined ? { name: invoker.name } : {}),
        permissions: [...invoker.permissions],
    };
}

function cloneParent(parent: TriggerParent): TriggerParent {
    return {
        kind: parent.kind,
        runId: parent.runId,
        agent: parent.agent,
        depth: parent.depth,
    };
}

/**
 * Keeps a frozen copy of the run's id, agent, invoker and parent for
 * startHandoff(), so tool code that writes to `ctx.run` cannot pick another
 * agent, widen the invoker or drop the lineage.
 */
export function bindRunSnapshot(run: RunContext): void {
    const { invoker, parent } = run.trigger;

    snapshots.set(run, Object.freeze({
        runId: run.runId,
        agent: run.agent,
        ...(invoker ? { invoker: Object.freeze(cloneInvoker(invoker)) } : {}),
        ...(parent ? { parent: Object.freeze(cloneParent(parent)) } : {}),
    }));
}

/** The copy bindRunSnapshot() took for this run context (undefined for one the engine did not build). */
export function runSnapshotOf(run: RunContext | undefined): HandoffRunSnapshot | undefined {
    return run ? snapshots.get(run) : undefined;
}

/** The `handoff-count:<runId>` record: the slots spent and the calls (effect key hashes) they were spent on. */
export function readCount(value: unknown): { count: number, calls: string[] } {
    if (!isObject(value)) {
        return { count: 0, calls: [] };
    }

    const count = typeof value.count === 'number' ? value.count : 0;
    const calls = Array.isArray(value.calls) ? value.calls.filter((c): c is string => typeof c === 'string') : [];

    return { count, calls };
}
