/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ApprovalDecision, ApprovalOption, ApprovalRequestInput } from '../approval/types.ts';
import type { Engine } from '../engine/module.ts';
import type { DispatchEnvelope } from '../engine/types.ts';
import type { TriggerEnvelope } from '../trigger/types.ts';

/** The HTTP input of a channel: the raw web request (body unread) and the raw subpath after `/channels/<name>`. */
export type ChannelRequest = {
    request: Request;
    subpath: string;
};

/** What a channel may dispatch: the engine sets `channel` to the channel's own name. */
export type ChannelDispatchEnvelope = Omit<DispatchEnvelope, 'channel'>;

/** What `engine.dispatch()` resolves. */
export type DispatchResult = {
    runId: string;
    deduplicated: boolean;
};

export type ChannelContext = {
    engine: Engine;
    /** engine.dispatch with `channel` set to this channel's name (a channel cannot dispatch as another). */
    dispatch(envelope: ChannelDispatchEnvelope): Promise<DispatchResult>;
};

/** One outbound message; `key` is stable per logical message and the transport's dedupe key. */
export type ChannelMessage = {
    kind: 'message' | 'approval';
    key: string;
    runId: string;
    agent: string;
    title?: string;
    body: string;
    /** Set for kind `approval`. */
    approvalId?: string;
    /** Set for kind `approval`. */
    expiresAt?: Date;
    /** Set for kind `approval` with options. */
    options?: ApprovalOption[];
    /** Set (true) for kind `approval` with options of which several may be selected. */
    multiple?: boolean;
};

export type ChannelSendOptions = {
    signal: AbortSignal;
    /** The run's stored envelope: a transport may read the source payload, never write it. */
    trigger: TriggerEnvelope;
};

/**
 * Anything a run can come from or talk to. The presence of `start`, `in`
 * and `out` is the only capability; `name` follows the agent-name rules
 * and is unique per engine.
 */
export interface IChannel<TInput = ChannelRequest, TOutput = Response> {
    readonly name: string;
    /**
     * Where `emit()` and `approve()` send when the tool names no address and
     * the run did not come from this channel (e.g. OpenClaw's `deliver.to`);
     * a non-empty string. Without it such a call needs an address.
     */
    readonly defaultAddress?: string;
    /** Background inbound (cron ticks, sockets, polling); called by engine.start() after the first recover. */
    start?(ctx: ChannelContext): Promise<void>;
    /** Called first by engine.drain() and engine.stop(): no new inbound. */
    stop?(): Promise<void>;
    /** The channel's single inbound entry; transports feed it (the http route, a socket loop, tests). */
    in?(input: TInput, ctx: ChannelContext): Promise<TOutput>;
    /** Sends a message to an address the channel defines; idempotent on `message.key`. */
    out?(message: ChannelMessage, address: string, opts: ChannelSendOptions): Promise<void>;
}

/**
 * An agent's subscription to a channel (replaces the trigger definition):
 * `channel` names a channel registered on the engine, `id` is unique
 * within the agent, `options` belong to the channel.
 */
export type ChannelSubscription<P = unknown> = {
    channel: string;
    id: string;
    options: Record<string, unknown>;
    // method signatures (bivariant): a ChannelSubscription<P> fits AgentDefinition.channels
    concurrencyKey?(payload: P): string | undefined;
    idempotencyKey?(payload: P): string | undefined;
};

/** A message a tool emits; `key` overrides the content-addressed dedupe key. */
export type EmitMessage = {
    title?: string;
    body: string;
    key?: string;
};

/**
 * A channel bound to the run (`ToolContext.channels`). `address` is
 * the run's source address when this is the run's source channel, else the
 * channel's `defaultAddress`.
 */
export type ChannelHandle = {
    readonly name: string;
    readonly address?: string;
    /**
     * Sends `message` through the channel's `out` to `address` (default: the
     * bound address), at most once per key; only inside a tool call.
     */
    emit(message: EmitMessage, address?: string): Promise<void>;
    /** Asks the owner to approve, durably (suspends the tool call until answered). */
    approve(request: ApprovalRequestInput & { address?: string }): Promise<ApprovalDecision>;
};

/**
 * `ToolContext.channels`: run-bound handles on the engine's channels with
 * `out`. On the run's source channel a handle defaults to the source address.
 */
export type ToolChannels = {
    /**
     * The channel `name` (default: the run's source channel); undefined when
     * the engine has no such channel or it has no `out`.
     */
    findOne(name?: string): ChannelHandle | undefined;
    /** As findOne(), but ChannelNotFoundError instead of undefined. */
    findOneOrFail(name?: string): ChannelHandle;
    /** Every engine channel with `out`, in registration order. */
    find(): ChannelHandle[];
};

export type ConsoleChannelOptions = {
    /** Default `'console'`. */
    name?: string;
    /** Receives each line; default `console.log`. */
    write?: (line: string) => void;
};
