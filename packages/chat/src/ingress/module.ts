/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { InvalidAgentDefinitionError, InvalidRunStateError } from '@chamvi/core';
import type { Adapter, ChatInstance, Message } from 'chat';
import type { ChatIncoming, ChatIngress, IChatReceiver } from './types.ts';

type IngressState = {
    receiver: IChatReceiver | undefined;
};

// ingress -> its receiver binding; never a global singleton of data
const states = new WeakMap<object, IngressState>();

function bindMembers<T extends object>(target: T, override: (key: PropertyKey) => unknown): T {
    return new Proxy(target, {
        get(object, key) {
            const replaced = override(key);

            if (replaced !== undefined) {
                return replaced;
            }

            const value = Reflect.get(object, key, object);

            return typeof value === 'function' ? value.bind(object) : value;
        },
    });
}

async function receive(
    state: IngressState,
    incoming: Omit<ChatIncoming, 'message'> & { message: Message | (() => Promise<Message>) },
): Promise<void> {
    const message = typeof incoming.message === 'function' ? await incoming.message() : incoming.message;
    const { receiver } = state;

    if (!receiver) {
        throw new InvalidRunStateError(`Chat adapter "${incoming.adapter.name}" has no receiver bound.`);
    }

    await receiver.receive({
        adapter: incoming.adapter,
        threadId: incoming.threadId,
        message,
    });
}

/**
 * Wraps a Chat SDK adapter so its incoming messages reach chamvi instead of the
 * SDK's handlers: initialize(chat) hands the adapter a ChatInstance whose
 * processMessage goes to the bound receiver (no SDK dedupe, no SDK handler) and
 * whose every other member is the real chat's.
 */
export function createChatIngressAdapter(adapter: Adapter): ChatIngress {
    const state: IngressState = { receiver: undefined };

    const facadeOf = (chat: ChatInstance): ChatInstance => bindMembers(chat, (key) => {
        if (key !== 'processMessage') {
            return undefined;
        }

        const processMessage: ChatInstance['processMessage'] = (source, threadId, message) => {
            const task = receive(state, {
                adapter: source,
                threadId,
                message,
            });

            // a caller that drops the promise (chat-adapter-baileys) must not cause an
            // unhandled rejection; a caller that awaits it still sees the failure
            task.catch(() => undefined);

            return task;
        };

        return processMessage;
    });

    const ingress = bindMembers(adapter, (key) => {
        if (key !== 'initialize') {
            return undefined;
        }

        const initialize: Adapter['initialize'] = (chat) => adapter.initialize(facadeOf(chat));

        return initialize;
    });

    states.set(ingress, state);

    return ingress;
}

/**
 * Binds the receiver of an ingress (internal: the channel binds itself on start).
 * Returns the disposer that unbinds it again.
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
