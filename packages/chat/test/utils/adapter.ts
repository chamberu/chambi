/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { Message, parseMarkdown } from 'chat';
import type {
    Adapter,
    AdapterPostableMessage,
    ChatInstance,
    RawMessage,
    WebhookOptions,
} from 'chat';

export type FakeAdapter = Adapter<string, unknown> & {
    /** the ChatInstance the adapter got from initialize() */
    readonly chat: ChatInstance | undefined;
    readonly posts: Array<{ threadId: string; message: AdapterPostableMessage }>;
    /** hands a message to chat.processMessage and returns its promise, as a webhook adapter can */
    deliver(message: Message, options?: WebhookOptions): Promise<void>;
    /** hands a message to chat.processMessage and drops its promise, as chat-adapter-baileys 2.1.0 does */
    deliverIgnored(message: Message): void;
};

/** A transport-free Chat SDK adapter: every thread is a direct chat. */
export function createFakeAdapter(name = 'fake'): FakeAdapter {
    let chat: ChatInstance | undefined;
    const posts: FakeAdapter['posts'] = [];

    const requireChat = (): ChatInstance => {
        if (!chat) {
            throw new Error(`adapter ${name} is not initialized`);
        }

        return chat;
    };

    const adapter: FakeAdapter = {
        name,
        userName: 'chamvi',
        get chat() {
            return chat;
        },
        posts,
        async initialize(instance) {
            chat = instance;
        },
        deliver(message, options) {
            return requireChat().processMessage(adapter, message.threadId, message, options);
        },
        deliverIgnored(message) {
            void requireChat().processMessage(adapter, message.threadId, message);
        },
        encodeThreadId: (id) => `${name}:${id}`,
        decodeThreadId: (threadId) => threadId.slice(name.length + 1),
        channelIdFromThreadId: (threadId) => threadId,
        isDM: () => true,
        parseMessage: () => {
            throw new Error('not used');
        },
        async handleWebhook() {
            return new Response(null, { status: 501 });
        },
        async postMessage(threadId, message): Promise<RawMessage<unknown>> {
            posts.push({ threadId, message });

            return {
                id: `sent-${posts.length}`,
                threadId,
                raw: {},
            };
        },
        async editMessage(threadId) {
            return {
                id: 'edited',
                threadId,
                raw: {},
            };
        },
        deleteMessage: () => Promise.resolve(),
        addReaction: () => Promise.resolve(),
        removeReaction: () => Promise.resolve(),
        startTyping: () => Promise.resolve(),
        async fetchMessages() {
            return { messages: [] };
        },
        async fetchThread(threadId) {
            return {
                id: threadId,
                channelId: threadId,
                metadata: {},
            };
        },
        renderFormatted: () => '',
    };

    return adapter;
}

/** A text message from another user in the fake adapter's thread. */
export function createTextMessage(input: {
    adapter?: string;
    thread?: string;
    id: string;
    text?: string
}): Message {
    const text = input.text ?? 'hello';

    return new Message({
        id: input.id,
        threadId: `${input.adapter ?? 'fake'}:${input.thread ?? 'chat-1'}`,
        text,
        formatted: parseMarkdown(text),
        raw: {},
        author: {
            userId: 'user-1',
            userName: 'user',
            fullName: 'User',
            isBot: false,
            isMe: false,
        },
        metadata: { dateSent: new Date(0), edited: false },
        attachments: [],
    });
}
