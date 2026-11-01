/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import type { Adapter, Message } from 'chat';
import { Chat } from 'chat';
import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, InvalidRunStateError } from '@chamvi/core';
import { createChatIngressAdapter } from '@chamvi/chat';
import type { ChatIncoming, ChatIngress } from '@chamvi/chat';
import { bindIngress, isChatIngress } from '../../../src/ingress/module.ts';
import { createFakeAdapter, createTextMessage } from '../../utils/adapter.ts';
import { createMemoryState, createRecordingLogger } from '../../utils/chat.ts';

function buildChat(ingress: ChatIngress) {
    const state = createMemoryState();
    const chat = new Chat({
        userName: 'chamvi',
        adapters: { [ingress.name]: ingress },
        state,
        logger: createRecordingLogger(),
        concurrency: 'concurrent',
    });

    return { chat, state };
}

describe('createChatIngressAdapter', () => {
    it('wrapper_binds_public_methods', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat, state } = buildChat(ingress);

        await chat.initialize();

        // one bound function per method, called on the real adapter
        expect(ingress.postMessage).toBe(ingress.postMessage);
        expect(ingress.name).toBe('fake');
        await ingress.postMessage('fake:chat-1', 'hi');
        expect(adapter.posts).toEqual([{ threadId: 'fake:chat-1', message: 'hi' }]);

        // the facade the adapter got: the real chat's members, bound to the real chat
        const facade = adapter.chat;

        expect(facade).toBeDefined();
        expect(facade).not.toBe(chat);
        expect(facade?.getState).toBe(facade?.getState);
        expect(facade?.getState()).toBe(state);
        expect(facade?.processMessage).toBe(facade?.processMessage);
        expect(facade?.processMessage).not.toBe(chat.processMessage);
        expect(chat.getAdapter('fake')).toBe(ingress);
        expect(isChatIngress(ingress)).toBe(true);
        expect(isChatIngress(adapter)).toBe(false);
    });

    it('an action event goes to the real chat and never reaches the receiver', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat(ingress);
        const received: ChatIncoming[] = [];

        bindIngress(ingress, {
            receive: async (input) => {
                received.push(input);
            },
        });
        await chat.initialize();

        await adapter.chat?.processAction({
            actionId: 'approve',
            adapter: ingress,
            messageId: 'm-1',
            raw: {},
            threadId: 'fake:chat-1',
            user: {
                userId: 'user-1',
                userName: 'user',
                fullName: 'User',
                isBot: false,
                isMe: false,
            },
            value: 'yes',
        }, undefined);

        expect(received).toEqual([]);
    });

    it('checks the receiver before the lazy message factory runs', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat(ingress);
        let parsed = 0;

        await chat.initialize();

        const factory = async (): Promise<Message> => {
            parsed += 1;

            return createTextMessage({ id: 'm-1' });
        };

        await expect(adapter.chat?.processMessage(ingress, 'fake:chat-1', factory)).rejects.toThrow(InvalidRunStateError);
        expect(parsed).toBe(0);
    });

    it('hands waitUntil the acceptance task, rejecting when the message was not accepted', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const { chat } = buildChat(ingress);
        const tasks: Promise<unknown>[] = [];
        const failure = new Error('store down');

        bindIngress(ingress, {
            receive: async (input) => {
                if (input.message.id === 'bad') {
                    throw failure;
                }
            },
        });
        await chat.initialize();

        const waitUntil = (task: Promise<unknown>) => {
            tasks.push(task);
        };

        await adapter.deliver(createTextMessage({ id: 'good' }), { waitUntil });
        await adapter.deliver(createTextMessage({ id: 'bad' }), { waitUntil }).catch(() => undefined);

        expect(tasks).toHaveLength(2);
        await expect(tasks[0]).resolves.toBeUndefined();
        await expect(tasks[1]).rejects.toBe(failure);
    });
});

describe('bindIngress', () => {
    it('refuses an adapter createChatIngressAdapter() did not wrap', () => {
        const adapter = createFakeAdapter();

        expect(() => bindIngress(adapter as unknown as ChatIngress, { receive: () => Promise.resolve() }))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a second receiver while one is bound', () => {
        const ingress = createChatIngressAdapter(createFakeAdapter());

        bindIngress(ingress, { receive: () => Promise.resolve() });

        expect(() => bindIngress(ingress, { receive: () => Promise.resolve() })).toThrow(/already has a receiver/);
    });

    it('a stale disposer leaves a later binding alone', async () => {
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter as Adapter);
        const { chat } = buildChat(ingress);
        const received: string[] = [];

        await chat.initialize();

        const first = bindIngress(ingress, { receive: () => Promise.resolve() });

        first();

        bindIngress(ingress, {
            receive: async (input) => {
                received.push(input.message.id);
            },
        });

        // the first disposer again: not its binding any more
        first();

        await adapter.deliver(createTextMessage({ id: 'm-1' }));

        expect(received).toEqual(['m-1']);
    });
});
