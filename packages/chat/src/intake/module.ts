/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, ValidationError } from '@chamvi/core';
import type {
    Agent,
    ChannelContext,
    ChannelSubscription,
    ConversationTarget,
    IClock,
    Invoker,
} from '@chamvi/core';
import { isObject } from 'smob';
import { encodeChatAddress, hashKey } from '../channel/helpers.ts';
import { CHAT_INTAKE_FAILED_ERROR_CODE } from '../channel/constants.ts';
import type {
    ChatEvent,
    ChatIntake,
    ChatIntakeContext,
    ChatPayload,
    ResolvedChatChannelOptions,
} from '../channel/types.ts';
import type { ChatIncoming } from '../ingress/types.ts';
import { chatConcurrencyKey, chatIdempotencyKey, matchesChatSubscription } from '../subscription/helpers.ts';
import { CHAT_ID_MAX_LENGTH, CHAT_INTAKE_RETRY_DELAYS_MS, TERMINAL_ERROR_CODES } from './constants.ts';
import type { ChatDispatch, ChatDispatchFailure } from './types.ts';

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= CHAT_ID_MAX_LENGTH && !value.includes('\0');
}

/** A retry may succeed: not a refusal, recognized by its code (so another core copy's errors count too). */
function isTransient(error: unknown): boolean {
    return !(isObject(error) && typeof error.code === 'string' && TERMINAL_ERROR_CODES.has(error.code));
}

/** Intake errors whose every failure was a refusal: a redelivery of the message cannot change them. */
const refusals = new WeakSet<object>();

/**
 * Whether delivering the message again may help: false for a refusal (a
 * terminal code, or an intake error without a transient failure left), true
 * for anything else (a store failure, the channel not started or stopped).
 */
export function isRetryableIntakeError(error: unknown): boolean {
    if (isObject(error) && refusals.has(error)) {
        return false;
    }

    return isTransient(error);
}

/** Waits `ms` on the clock; rejects with the signal's reason once it aborts. */
function wait(clock: IClock, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);

            return;
        }

        const onAbort = () => {
            timer.clear();
            reject(signal.reason);
        };
        const timer = clock.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * The trusted metadata of a message (ids, event, text), copied out of the
 * provider's objects, so nothing raw reaches a run. ValidationError (naming
 * no value) for an id that is no bounded string or an adapter the channel
 * does not hold.
 */
function readPayload(incoming: ChatIncoming, options: ResolvedChatChannelOptions): ChatPayload {
    const {
        adapter,
        threadId,
        message,
    } = incoming;
    const adapterName = isObject(adapter) ? adapter.name : undefined;

    if (typeof adapterName !== 'string' || !options.adapterNames.includes(adapterName)) {
        throw new ValidationError(`Chat channel "${options.name}" got a message of an adapter it does not hold.`);
    }

    if (!isId(threadId) || !isObject(message) || !isId(message.id) || !isObject(message.author) || !isId(message.author.userId)) {
        throw new ValidationError(`Chat channel "${options.name}" got a message of adapter "${adapterName}" with an invalid thread, message or author id.`);
    }

    let event: ChatEvent = 'message';

    if (typeof adapter.isDM === 'function' && adapter.isDM(threadId) === true) {
        event = 'direct';
    } else if (message.isMention === true) {
        event = 'mention';
    }

    // the thread must fit an address before any policy runs (it never would later)
    try {
        encodeChatAddress({ adapter: adapterName, threadId }, options.adapterNames);
    } catch {
        throw new ValidationError(`Chat channel "${options.name}" got a message of adapter "${adapterName}" whose thread id is too long for a chat address.`);
    }

    const channelId = adapter.channelIdFromThreadId(threadId);

    if (!isId(channelId)) {
        throw new ValidationError(`Chat channel "${options.name}" got a message of adapter "${adapterName}" with an invalid channel id.`);
    }

    const name = message.author.fullName || message.author.userName;
    const sentAt = message.metadata?.dateSent;

    return {
        adapter: adapterName,
        event,
        threadId,
        channelId,
        message: {
            id: message.id,
            text: typeof message.text === 'string' ? message.text : '',
            author: {
                id: message.author.userId,
                ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
            },
            ...(sentAt instanceof Date && !Number.isNaN(sentAt.getTime()) ? { sentAt: sentAt.toISOString() } : {}),
        },
    };
}

/** The first subscription of `agent` to this channel that takes the payload; a throwing filter throws. */
function firstMatch(agent: Agent, channel: string, payload: ChatPayload): ChannelSubscription | undefined {
    return (agent.definition.channels ?? []).find((subscription) => subscription.channel === channel &&
        matchesChatSubscription(subscription, payload));
}

/** The conversation of the message: the transport's (hook), else from the payload. */
function conversationOf(incoming: ChatIncoming, options: ResolvedChatChannelOptions, payload: ChatPayload): ConversationTarget | undefined {
    if (options.conversationTarget) {
        return options.conversationTarget(incoming, payload);
    }

    return {
        account: options.account ?? payload.adapter,
        chat: payload.threadId,
        // a group is one shared memory: its members are who reads it
        audience: payload.event === 'direct' ? `direct:${payload.message.author.id}` : `group:${payload.channelId}`,
        text: payload.message.text,
    };
}

/**
 * The dispatches of one attempt, read from the live agents (a replaced agent's
 * new subscriptions, a removed agent none). A throwing filter fails its agent
 * only.
 */
function plan(
    context: ChannelContext,
    options: ResolvedChatChannelOptions,
    incoming: ChatIncoming,
    payload: ChatPayload,
    invoker: Invoker | undefined,
    skip: ReadonlySet<string>,
): { dispatches: ChatDispatch[]; failures: ChatDispatchFailure[] } {
    const address = encodeChatAddress({ adapter: payload.adapter, threadId: payload.threadId }, options.adapterNames);
    const idempotencyKey = chatIdempotencyKey(options.name, payload);
    const dispatches: ChatDispatch[] = [];
    const failures: ChatDispatchFailure[] = [];

    for (const agent of context.engine.listAgents()) {
        if (skip.has(agent.name)) {
            continue;
        }

        let subscription: ChannelSubscription | undefined;

        try {
            subscription = firstMatch(agent, options.name, payload);
        } catch (error) {
            failures.push({
                agent: agent.name,
                error,
                transient: false,
            });

            continue;
        }

        if (!subscription) {
            continue;
        }

        const envelope = {
            agent: agent.name,
            trigger: subscription.id,
            payload: structuredClone(payload),
            idempotencyKey,
            address,
            ...(invoker ? { invoker } : {}),
        };

        if (agent.definition.conversation) {
            const conversation = conversationOf(incoming, options, payload);

            if (!conversation) {
                failures.push({
                    agent: agent.name,
                    error: new ValidationError(`Chat channel "${options.name}" has no conversation identity for a message of adapter "${payload.adapter}".`),
                    transient: false,
                });

                continue;
            }

            // the engine derives the conversation's own concurrency key
            dispatches.push({
                agent: agent.name,
                envelope,
                conversation,
            });
        } else {
            dispatches.push({
                agent: agent.name,
                envelope: { ...envelope, concurrencyKey: chatConcurrencyKey(options.name, payload) },
            });
        }
    }

    return { dispatches, failures };
}

async function runDispatch(context: ChannelContext, dispatch: ChatDispatch): Promise<void> {
    if (dispatch.conversation) {
        await context.dispatchConversation(dispatch.envelope, dispatch.conversation);
    } else {
        await context.dispatch(dispatch.envelope);
    }
}

/** The one error of a message not (fully) accepted: names channel, adapter and agents, never the message's text or author. */
function intakeError(options: ResolvedChatChannelOptions, adapter: string, failures: ChatDispatchFailure[], attempts: number): ChamviError {
    const agents = failures.map((failure) => failure.agent).join(', ');
    const errors = failures.map((failure) => failure.error);

    return new ChamviError({
        message: `Chat channel "${options.name}" could not start a run of agent(s) ${agents} for a message of adapter "${adapter}" (${attempts} attempt(s)).`,
        code: CHAT_INTAKE_FAILED_ERROR_CODE,
        cause: errors.length === 1 ? errors[0] : new AggregateError(errors),
    });
}

/**
 * Dispatches the message to every matching agent, retrying transient failures
 * (a store write) after `CHAT_INTAKE_RETRY_DELAYS_MS` on the engine's clock.
 * An agent whose run was created (or deduplicated) or that failed terminally
 * is not dispatched again; every retry re-reads the live agents. Resolves once
 * every run is stored (accepted, not executed); rejects with one error
 * otherwise, or with the abort reason when the channel stops meanwhile.
 */
async function deliver(
    {
        context,
        signal,
        options,
    }: ChatIntakeContext,
    incoming: ChatIncoming,
    payload: ChatPayload,
    invoker: Invoker | undefined,
): Promise<void> {
    const done = new Set<string>();
    const terminal: ChatDispatchFailure[] = [];
    const transient: ChatDispatchFailure[] = [];
    let attempts = 0;

    for (;;) {
        attempts += 1;
        transient.length = 0;

        const { dispatches, failures } = plan(context, options, incoming, payload, invoker, done);

        for (const failure of failures) {
            done.add(failure.agent);
            terminal.push(failure);
        }

        // one agent's failure never keeps the others from their run
        for (const dispatch of dispatches) {
            try {
                await runDispatch(context, dispatch);
                done.add(dispatch.agent);
            } catch (error) {
                const failure = {
                    agent: dispatch.agent,
                    error,
                    transient: isTransient(error),
                };

                if (failure.transient) {
                    transient.push(failure);
                } else {
                    done.add(dispatch.agent);
                    terminal.push(failure);
                }
            }
        }

        const delay = CHAT_INTAKE_RETRY_DELAYS_MS[attempts - 1];

        if (transient.length === 0 || delay === undefined) {
            break;
        }

        await wait(context.engine.clock, delay, signal);
    }

    const failures = [...terminal, ...transient];

    if (failures.length === 0) {
        return;
    }

    const error = intakeError(options, payload.adapter, failures, attempts);

    if (transient.length === 0) {
        refusals.add(error);
    }

    throw error;
}

/**
 * The intake of one chat channel: policy first, then the runs. In order: a
 * message of the bot itself is skipped; the ids are checked; `allowMessage`
 * decides (a refused message is dropped silently: no download, no history, no
 * invoker lookup, no run); a message with attachments or without text is
 * refused (ValidationError, media is not supported yet); `resolveInvoker` names the
 * invoker; then every agent with a matching subscription gets one run, through
 * the trusted conversation intake for an agent with `conversation`, else a
 * plain dispatch.
 *
 * Concurrent deliveries of one message share one intake (an in-flight map,
 * emptied once it settles: a failed message may come again); durable
 * deduplication is the engine's idempotency key per agent and message.
 */
export function createChatIntake(): ChatIntake {
    const inFlight = new Map<string, Promise<void>>();

    const accept = async (incoming: ChatIncoming, ctx: ChatIntakeContext): Promise<void> => {
        // the bot's own messages (an echo of what it sent) start nothing
        if (incoming.message?.author?.isMe === true) {
            return;
        }

        const { options } = ctx;

        const payload = readPayload(incoming, options);

        if (await options.allowMessage(incoming) !== true) {
            return;
        }

        if (Array.isArray(incoming.message.attachments) && incoming.message.attachments.length > 0) {
            throw new ValidationError(`Chat channel "${options.name}" refused a message of adapter "${payload.adapter}": attachments are not supported.`);
        }

        // nothing to answer: only text messages start runs
        if (payload.message.text.trim().length === 0) {
            throw new ValidationError(`Chat channel "${options.name}" refused a message of adapter "${payload.adapter}": it has no text.`);
        }

        const invoker = options.resolveInvoker ? await options.resolveInvoker(incoming) : undefined;

        await deliver(ctx, incoming, payload, invoker);
    };

    return (incoming, ctx) => {
        const author = isObject(incoming.message) && isObject(incoming.message.author) ? incoming.message.author.userId : undefined;
        const key = isObject(incoming.message) && isId(incoming.message.id) && isId(incoming.threadId) && isId(author) ?
            hashKey([incoming.adapter?.name ?? '', incoming.threadId, author, incoming.message.id]) :
            undefined;
        const running = key === undefined ? undefined : inFlight.get(key);

        if (running) {
            return running;
        }

        const task = accept(incoming, ctx);

        if (key !== undefined) {
            inFlight.set(key, task);
            task.then(
                () => inFlight.delete(key),
                () => inFlight.delete(key),
            );
        }

        return task;
    };
}
