/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { AsyncLocalStorage } from 'node:async_hooks';
import { InvalidAgentDefinitionError, InvalidRunStateError } from '@chamvi/core';
import { isObject } from 'smob';
import type {
    Adapter,
    ChatInstance,
    Message,
    WebhookOptions,
} from 'chat';
import type { ChatIngress, IChatReceiver } from './types.ts';

type IngressState = {
    receiver: IChatReceiver | undefined;
    /** told about a message that arrived after the last receiver was unbound */
    onRefused?: (error: unknown) => void;
};

// ingress -> its receiver binding; keyed by the wrapper object, never a global singleton of data
const states = new WeakMap<object, IngressState>();

// the collector of the webhook call (trackIngress) a message was handed over in; data lives per call
const trackers = new AsyncLocalStorage<(task: Promise<void>) => void>();

/**
 * Runs `fn` (a webhook handler) so every message any ingress gets during it,
 * also from work it started without passing `waitUntil` on, hands its
 * acceptance task to `track` (internal: the channel's `in`).
 */
export function trackIngress<T>(track: (task: Promise<void>) => void, fn: () => T): T {
    return trackers.run(track, fn);
}

/**
 * A Proxy over `target` whose members are the target's, methods bound to the
 * target (one bound function per method, so `proxy.fn === proxy.fn`), except
 * the keys `overrides` names, which are answered from there.
 */
function forwardMembers<T extends object>(target: T, overrides: Partial<Record<PropertyKey, unknown>>): T {
    const bound = new WeakMap<object, unknown>();

    return new Proxy(target, {
        get(object, key) {
            if (Object.hasOwn(overrides, key)) {
                return overrides[key];
            }

            const value: unknown = Reflect.get(object, key, object);

            if (typeof value !== 'function') {
                return value;
            }

            let method = bound.get(value);

            if (!method) {
                method = value.bind(object);
                bound.set(value, method);
            }

            return method;
        },
    });
}

async function receive(
    state: IngressState,
    adapter: Adapter,
    threadId: string,
    message: Message | (() => Promise<Message>),
): Promise<void> {
    // checked before the lazy factory runs: no receiver, no parsing work
    const { receiver } = state;

    if (!receiver) {
        // a late event (a socket message after stop) is refused, and the stopped channel told once
        const error = new InvalidRunStateError(`Chat adapter "${adapter.name}" has no receiver bound (its channel is not started); the message is refused.`);

        try {
            state.onRefused?.(error);
        } catch {
            // the report must not replace the refusal
        }

        throw error;
    }

    const resolved = typeof message === 'function' ? await message() : message;

    await receiver.receive({
        adapter,
        threadId,
        message: resolved,
    });
}

/**
 * Wraps a Chat SDK adapter so its incoming messages reach chamvi instead of the
 * SDK's handlers: initialize(chat) hands the adapter a ChatInstance whose
 * processMessage goes to the bound receiver (no SDK dedupe, no SDK handler) and
 * whose every other member is the real chat's, called on the real chat.
 *
 * The deprecated handleIncomingMessage takes the same path, so no message
 * reaches the SDK's handlers or its dedupe through it.
 *
 * Of processMessage's WebhookOptions only `waitUntil` is applied: it gets the
 * acceptance task (rejecting when the message was not accepted), so a webhook
 * caller can wait for acceptance before it answers. `deduplicate` and
 * `propagateHandlerErrors` are ignored (chamvi deduplicates itself and always
 * propagates a failure), `onOpenModal` has no use for a message. Inside a
 * trackIngress() call (the channel's webhook `in`) the acceptance task is
 * also handed to its collector, whether or not the adapter passed options.
 */
export function createChatIngressAdapter(adapter: Adapter): ChatIngress {
    const state: IngressState = { receiver: undefined };

    const facadeOf = (chat: ChatInstance): ChatInstance => {
        const processMessage: ChatInstance['processMessage'] = (
            source,
            threadId,
            message,
            options?: WebhookOptions,
        ) => {
            const task = receive(state, source, threadId, message);

            // a caller that drops the promise (a socket adapter) must not cause an
            // unhandled rejection; a caller that awaits it still sees the failure
            task.catch(() => undefined);
            trackers.getStore()?.(task);
            options?.waitUntil?.(task);

            return task;
        };

        const handleIncomingMessage: ChatInstance['handleIncomingMessage'] = (source, threadId, message) => {
            const task = receive(state, source, threadId, message);

            task.catch(() => undefined);
            trackers.getStore()?.(task);

            return task;
        };

        return forwardMembers(chat, { processMessage, handleIncomingMessage });
    };

    const initialize: Adapter['initialize'] = (chat) => adapter.initialize(facadeOf(chat));
    const ingress = forwardMembers(adapter, { initialize }) as ChatIngress;

    states.set(ingress, state);

    return ingress;
}

/** Whether `value` is a wrapper createChatIngressAdapter() made. */
export function isChatIngress(value: unknown): value is ChatIngress {
    return isObject(value) && states.has(value);
}

/**
 * Binds the receiver of an ingress (internal: the channel binds itself on start).
 * Returns the disposer that unbinds it again; a disposer only ever unbinds its
 * own receiver, so a stale one leaves a later binding alone. After the unbind
 * `onRefused` hears of every message refused for want of a receiver, until
 * the next bind.
 */
export function bindIngress(
    ingress: ChatIngress,
    receiver: IChatReceiver,
    onRefused?: (error: unknown) => void,
): () => void {
    const state = states.get(ingress);

    if (!state) {
        throw new InvalidAgentDefinitionError(`Chat adapter "${ingress.name}" is not an ingress of createChatIngressAdapter().`);
    }

    if (state.receiver) {
        throw new InvalidAgentDefinitionError(`Chat adapter "${ingress.name}" already has a receiver bound.`);
    }

    state.receiver = receiver;
    delete state.onRefused;

    return () => {
        if (!(state.receiver === receiver)) {
            return;
        }

        state.receiver = undefined;

        if (onRefused) {
            state.onRefused = onRefused;
        }
    };
}
