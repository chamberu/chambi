/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Agent } from '../agent/types.ts';
import type { ChannelSubscription, DispatchResult } from '../channel/types.ts';
import type { DispatchEnvelope } from '../engine/types.ts';
import type { IEffectStore } from '../store/types.ts';
import type { Invoker, TriggerParent } from '../trigger/types.ts';

export type HandoffSubscriptionOptions<P = unknown> = {
    /** Parses the payload a tool hands off; the parsed value is the child's payload. */
    schema?: StandardSchemaV1<unknown, P>;
    /** How many hand-offs one run may start (all executions together), default 100. */
    maxPerRun?: number;
    /** The child's concurrency key when the call gives none. */
    concurrencyKey?(payload: P): string | undefined;
    /** The child's idempotency key when the call gives none. */
    idempotencyKey?(payload: P): string | undefined;
};

/** Makes the `handoff` subscription of the `agent` channel: the opt-in for startHandoff(). */
export type HandoffSubscriber = {
    on<P = unknown>(options?: HandoffSubscriptionOptions<P>): ChannelSubscription<P>;
};

export type HandoffInput = {
    /** The child run's payload (required), parsed by the subscription's schema. */
    payload: unknown;
    /** Dedupes across runs: a second hand-off under the same key gets the first child. */
    idempotencyKey?: string;
    concurrencyKey?: string;
    /** The child's `trigger.address` (and `Run.address`). */
    address?: string;
};

export type HandoffResult = {
    runId: string;
    deduplicated: boolean;
};

/** The engine's copy of a run startHandoff() reads (internal). */
export type HandoffRunSnapshot = {
    readonly runId: string;
    readonly agent: string;
    readonly invoker?: Invoker;
    readonly parent?: TriggerParent;
};

/** The engine side of startHandoff() (internal, provided under HANDOFF_CONTEXT). */
export type HandoffHost = {
    getAgent(name: string): Agent | undefined;
    effects: IEffectStore;
    /** Creates the run with `parent` as its lineage (dispatch() never sets one). */
    dispatch(envelope: DispatchEnvelope, parent: TriggerParent): Promise<DispatchResult>;
    /** Runs `fn` after every earlier call of the same run settled (the count read-check-write). */
    serial<T>(runId: string, fn: () => Promise<T>): Promise<T>;
    /** Hand-offs in flight by effect key, so identical parallel calls share one. */
    inflight: Map<string, Promise<HandoffResult>>;
};
