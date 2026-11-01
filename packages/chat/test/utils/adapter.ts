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
    /** how often initialize() and disconnect() ran */
    readonly initializeCalls: number;
    readonly disconnectCalls: number;
    /** every platform read the adapter served (history, thread, user lookups), by method name */
    readonly reads: string[];
    /** whether a thread is a direct chat; default every thread is */
    isDirect: (threadId: string) => boolean;
    /** runs inside initialize(), after the adapter took the ChatInstance */
    onInitialize?: (chat: ChatInstance) => void | Promise<void>;
    /** answers handleWebhook(); default 501 */
    onWebhook?: (request: Request, options?: WebhookOptions) => Promise<Response>;
    /** hands a message to chat.processMessage and returns its promise, as a webhook adapter can */
    deliver(message: Message, options?: WebhookOptions): Promise<void>;
    /** hands a message to chat.processMessage and drops its promise, as a socket adapter may */
    deliverIgnored(message: Message): void;
};

/** A transport-free Chat SDK adapter: every thread is a direct chat unless `isDirect` says otherwise. */
export function createFakeAdapter(name = 'fake'): FakeAdapter {
    let chat: ChatInstance | undefined;
    let initializeCalls = 0;
    let disconnectCalls = 0;
    const posts: FakeAdapter['posts'] = [];
    const reads: string[] = [];

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
        get initializeCalls() {
            return initializeCalls;
        },
        get disconnectCalls() {
            return disconnectCalls;
        },
        posts,
        reads,
        isDirect: () => true,
        async initialize(instance) {
            initializeCalls += 1;
            chat = instance;
            await adapter.onInitialize?.(instance);
        },
        async disconnect() {
            disconnectCalls += 1;
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
        isDM: (threadId) => adapter.isDirect(threadId),
        parseMessage: () => {
            throw new Error('not used');
        },
        async handleWebhook(request, options) {
            if (adapter.onWebhook) {
                return adapter.onWebhook(request, options);
            }

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
            reads.push('fetchMessages');

            return { messages: [] };
        },
        async getUser() {
            reads.push('getUser');

            return null;
        },
        async fetchThread(threadId) {
            reads.push('fetchThread');

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

/** A text message from another user (`user-1` unless `author` says otherwise) in the fake adapter's thread. */
export function createTextMessage(input: {
    adapter?: string;
    thread?: string;
    id: string;
    text?: string;
    author?: string;
    isMe?: boolean;
    isMention?: boolean;
    attachments?: Message['attachments'];
}): Message {
    const text = input.text ?? 'hello';

    return new Message({
        id: input.id,
        threadId: `${input.adapter ?? 'fake'}:${input.thread ?? 'chat-1'}`,
        text,
        formatted: parseMarkdown(text),
        raw: {},
        author: {
            userId: input.author ?? 'user-1',
            userName: 'user',
            fullName: 'User',
            isBot: input.isMe === true,
            isMe: input.isMe === true,
        },
        metadata: { dateSent: new Date(0), edited: false },
        attachments: input.attachments ?? [],
        ...(input.isMention !== undefined ? { isMention: input.isMention } : {}),
    });
}
