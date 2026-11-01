/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


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
};

// ingress -> its receiver binding; keyed by the wrapper object, never a global singleton of data
const states = new WeakMap<object, IngressState>();

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
        throw new InvalidRunStateError(`Chat adapter "${adapter.name}" has no receiver bound.`);
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
 * Of processMessage's WebhookOptions only `waitUntil` is applied: it gets the
 * acceptance task (rejecting when the message was not accepted), so a webhook
 * caller can wait for acceptance before it answers. `deduplicate` and
 * `propagateHandlerErrors` are ignored (chamvi deduplicates itself and always
 * propagates a failure), `onOpenModal` has no use for a message.
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

            // a caller that drops the promise (chat-adapter-baileys) must not cause an
            // unhandled rejection; a caller that awaits it still sees the failure
            task.catch(() => undefined);
            options?.waitUntil?.(task);

            return task;
        };

        return forwardMembers(chat, { processMessage });
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
 * own receiver, so a stale one leaves a later binding alone.
 */
export function bindIngress(ingress: ChatIngress, receiver: IChatReceiver): () => void {
    const state = states.get(ingress);

    if (!state) {
        throw new InvalidAgentDefinitionError(`Chat adapter "${ingress.name}" is not an ingress of createChatIngressAdapter().`);
    }

    if (state.receiver) {
        throw new InvalidAgentDefinitionError(`Chat adapter "${ingress.name}" already has a receiver bound.`);
    }

    state.receiver = receiver;

    return () => {
        if (state.receiver === receiver) {
            state.receiver = undefined;
        }
    };
}
