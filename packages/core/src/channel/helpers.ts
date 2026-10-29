/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { conversationFor, dispatchConversation } from '../conversation/context.ts';
import { isObject } from 'smob';
import { requestApproval } from '../approval/request.ts';
import type { ApprovalDecision, ApprovalRequestInput } from '../approval/types.ts';
import { currentToolCall } from '../effect/frame.ts';
import { matchesEmitReceipt } from '../conversation/helpers.ts';
import { assertConversationText } from '../conversation/persistence/module.ts';
import { stableHash } from '../effect/helpers.ts';
import type { Engine } from '../engine/module.ts';
import {
    ChannelNotFoundError,
    InvalidAgentDefinitionError,
    InvalidRunStateError,
    ValidationError,
} from '../errors/index.ts';
import { NAME_MAX_LENGTH, NAME_PATTERN } from '../agent/constants.ts';
import { untilAborted } from '../run/helpers.ts';
import type { RunContext } from '../run/types.ts';
import type { IEffectRepository } from '../repository/types.ts';
import type {
    ChannelContext,
    ChannelHandle,
    EmitMessage,
    IChannel,
    ToolChannels,
} from './types.ts';

/** Emits in flight in one execution by effect key: parallel identical emits share one send. */
type Inflight = Map<string, Promise<unknown>>;

/** The context a channel's `start` and `in` get: its dispatch always carries the channel's own name. */
export function createChannelContext(engine: Engine, channel: Pick<IChannel, 'name'>): ChannelContext {
    return {
        engine,
        dispatchConversation: (envelope, target) => dispatchConversation(engine, channel, envelope, target),
        dispatch: (envelope) => engine.dispatch({ ...envelope, channel: channel.name }),
    };
}

/** Refuses a channel name that breaks the agent-name rules. */
/** Refuses a `defaultAddress` that is given but no non-empty string (InvalidAgentDefinitionError). */
export function assertDefaultAddress(channel: { name: string; defaultAddress?: unknown }): void {
    const { defaultAddress } = channel;
    if (defaultAddress !== undefined && (typeof defaultAddress !== 'string' || defaultAddress.length === 0)) {
        throw new InvalidAgentDefinitionError(`Channel "${channel.name}" has a defaultAddress that is no non-empty string.`);
    }
}

export function assertChannelName(name: unknown): asserts name is string {
    if (typeof name !== 'string' || name.length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) {
        throw new InvalidAgentDefinitionError(
            `Invalid channel name "${String(name)}": must match ${NAME_PATTERN} and be at most ${NAME_MAX_LENGTH} characters.`,
        );
    }
}

function assertEmitMessage(message: unknown): asserts message is EmitMessage {
    if (!isObject(message) || typeof message.body !== 'string') {
        throw new ValidationError('An emitted message needs a string body.');
    }
    if (message.title !== undefined && typeof message.title !== 'string') {
        throw new ValidationError('An emitted message title must be a string.');
    }
    if (message.key !== undefined && (typeof message.key !== 'string' || message.key.length === 0)) {
        throw new ValidationError('An emitted message key must be a non-empty string.');
    }
}

/**
 * A handle on `channel` (which has `out`) for the execution of `run`.
 * `emit` is an effect: recorded under its key in the effect store, so a
 * redone step (or a parallel identical call) sends once; a throwing `out`
 * records nothing. `approve` is approve() with the request delivered
 * through this channel to `address` (default: the bound address, else the
 * channel's `defaultAddress`).
 */
function createChannelHandle(
    run: RunContext,
    effects: IEffectRepository,
    inflight: Inflight,
    channel: IChannel<any, any>,
    address?: string,
    conversation?: ReturnType<typeof conversationFor>,
): ChannelHandle {
    const { name } = channel;
    const fallback = address ?? channel.defaultAddress;
    const missing = () => new ValidationError(
        `Channel "${name}" needs an address: only the run's source channel and a channel with a defaultAddress have a default one.`,
    );
    const capture = conversation && run.trigger.channel === name ? conversation : undefined;
    const send = async (effectKey: string, key: string, message: EmitMessage, target: string) => {
        const stored = await effects.findOne(effectKey);
        if (stored) return stored.result;
        if (conversation) run.signal.throwIfAborted();
        const delivery = Promise.resolve(channel.out!({
            kind: 'message',
            key,
            runId: run.runId,
            agent: run.agent,
            ...(message.title !== undefined ? { title: message.title } : {}),
            body: message.body,
        }, target, { signal: run.signal, trigger: run.trigger }));
        if (conversation) {
            // An aborted, non-cooperative transport may still deliver; it must never write a late receipt.
            void delivery.catch(() => {});
            await untilAborted(delivery, run.signal);
        } else {
            await delivery;
        }
        // The message went out: a failing write must not fail the call (as for effect tools).
        const receipt = {
            channel: name,
            address: target,
            key,
        };
        try {
            await effects.save(effectKey, receipt);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`chamvi: failed to record emit ${effectKey}`, error);
            return undefined;
        }
        return receipt;
    };

    const emit = async (message: EmitMessage, to?: string): Promise<void> => {
        if (!currentToolCall()) {
            throw new InvalidRunStateError(`emit() on channel "${name}" runs inside a tool call, not in the tools factory.`);
        }
        assertEmitMessage(message);
        const target = to ?? fallback;
        if (target === undefined) throw missing();
        if (typeof target !== 'string' || target.length === 0) {
            throw new ValidationError('The address must be a non-empty string.');
        }
        if (conversation) {
            if (message.key !== undefined) assertConversationText(message.key, Number.MAX_SAFE_INTEGER);
            assertConversationText(target, Number.MAX_SAFE_INTEGER);
        }
        const prefix = `${run.runId}:emit:${name}:`;
        const effectKey = message.key !== undefined ?
            `${prefix}key:${message.key}` :
            `${prefix}${stableHash({
                address: target,
                title: message.title,
                body: message.body,
            })}`;
        const key = message.key ?? effectKey;
        const captured = { ...message };
        const work = (async () => {
            const source = capture && target === capture.run.trigger.address ? capture : undefined;
            if (source) {
                assertConversationText(captured.body, source.capability.limits.maxItemBytes);
                await source.capability.repository.prepareEmit(source.binding.scope, {
                    id: `emit:${stableHash(effectKey)}`,
                    runId: source.run.id,
                    role: 'assistant',
                    status: 'pending',
                    text: captured.body,
                    effectKey,
                    target: { channel: name, address: target },
                    createdAt: source.run.createdAt, // persistence owns the timestamp
                });
            }
            // Prepare every caller before sharing a send, so key collisions cannot hide in-flight.
            let pending = inflight.get(effectKey);
            if (!pending) {
                pending = send(effectKey, key, captured, target).finally(() => inflight.delete(effectKey));
                inflight.set(effectKey, pending);
            }
            const receipt = await pending;
            // Every source caller validates a shared send, including the in-flight fast path.
            if (source && receipt !== undefined) {
                if (!matchesEmitReceipt(receipt, { channel: name, address: target })) throw new ValidationError('The emit effect belongs to another target.');
                await source.capability.repository.confirmEmit(source.binding.scope, `emit:${stableHash(effectKey)}`);
            }
        })();
        return conversation ? conversation.capability.track(conversation.run.id, work) : work;
    };

    const approve = async (request: ApprovalRequestInput & { address?: string }): Promise<ApprovalDecision> => {
        const { address: to, ...rest }: ApprovalRequestInput & { address?: string } = isObject(request) ? request : { title: '' };
        const target = to ?? fallback;
        if (target === undefined) throw missing();
        if (typeof target !== 'string' || target.length === 0) {
            throw new ValidationError('The address must be a non-empty string.');
        }
        return requestApproval(rest as ApprovalRequestInput, { channel: name, address: target });
    };

    return {
        name,
        ...(fallback !== undefined ? { address: fallback } : {}),
        emit,
        approve,
    };
}

/**
 * The execution's `ToolContext.channels` over `engine`'s channels with
 * `out`: `findOne(name?)` (default: the run's source channel) or undefined,
 * `findOneOrFail(name?)` or ChannelNotFoundError, `find()` all of them. On
 * the source channel a handle defaults to the source address. Emits in
 * flight are shared by every handle of the execution.
 */
export function createToolChannels(
    run: RunContext,
    effects: IEffectRepository,
    engine: Pick<Engine, 'getChannel' | 'listChannels'>,
): ToolChannels {
    const inflight: Inflight = new Map();
    const conversation = conversationFor(run);
    const trusted = conversation ? {
        runId: conversation.run.id,
        agent: conversation.run.agent,
        trigger: structuredClone(conversation.run.trigger),
        signal: run.signal,
    } : run;
    const canSend = (channel: IChannel<any, any> | undefined): channel is IChannel<any, any> => (
        typeof channel?.out === 'function'
    );
    const handle = (channel: IChannel<any, any>) => createChannelHandle(
        trusted,
        effects,
        inflight,
        channel,
        trusted.trigger.channel === channel.name ? trusted.trigger.address : undefined,
        conversation,
    );
    const findOne = (name?: string) => {
        const channel = engine.getChannel(name ?? trusted.trigger.channel);
        return canSend(channel) ? handle(channel) : undefined;
    };
    return {
        findOne,
        findOneOrFail(name) {
            const found = findOne(name);
            if (!found) throw new ChannelNotFoundError(name ?? trusted.trigger.channel);
            return found;
        },
        find: () => engine.listChannels().filter(canSend).map(handle),
    };
}
