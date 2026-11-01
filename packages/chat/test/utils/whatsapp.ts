/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    BaileysEventMap,
    Contact,
    UserFacingSocketConfig,
    WAMessage,
} from 'baileys';
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import type {
    Agent,
    ConversationAccess,
    IStore,
    Run,
} from '@chamvi/core';
import { createWhatsAppChat } from '@chamvi/chat/baileys';
import type {
    WhatsAppChatOptions,
    WhatsAppChatSetup,
    WhatsAppPairing,
    WhatsAppSocket,
    WhatsAppSocketFactory,
} from '@chamvi/chat/baileys';
import type { ChatChannel } from '@chamvi/chat';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import { createRecordingAuth } from './auth.ts';
import type { RecordingAuth } from './auth.ts';
import { createMemoryState } from './chat.ts';

/** The bot's own account. */
export const BOT_JID = '4900000000000@s.whatsapp.net';
export const BOT_LID = '900000000000@lid';
/** An allowed sender and a stranger. */
export const ALICE = '491701111111@s.whatsapp.net';
export const MALLORY = '491702222222@s.whatsapp.net';
export const GROUP = '120363000000000001@g.us';

type Listener = (arg: never) => void;

export type FakeSocket = Omit<WhatsAppSocket, 'user'> & {
    user: Contact | undefined;
    readonly config: UserFacingSocketConfig;
    readonly sent: Array<{
        jid: string;
        text: string;
        messageId?: string
    }>;
    readonly ended: number;
    /** LID -> phone number jid, what the socket's LID mapping store answers */
    readonly lids: Map<string, string>;
    /** answers sendMessage; default resolves with a message of the given (or a fresh) id */
    onSend?: (jid: string, text: string, messageId?: string) => Promise<WAMessage | undefined>;
    /** answers end(); default resolves at once */
    onEnd?: () => Promise<void>;
    emit<T extends keyof BaileysEventMap>(event: T, arg: BaileysEventMap[T]): void;
    listenerCount(): number;
    open(): void;
    close(statusCode: number): void;
    deliver(...messages: WAMessage[]): void;
};

export type FakeSockets = {
    factory: WhatsAppSocketFactory;
    readonly sockets: FakeSocket[];
    /** the last socket made */
    last(): FakeSocket;
    /** the next factory call throws `error` */
    failNext(error: unknown): void;
};

/** A socket factory of fake Baileys sockets: events are emitted by the test, nothing reaches a network. */
export function createFakeSockets(trace: string[] = []): FakeSockets {
    const sockets: FakeSocket[] = [];
    let failure: { error: unknown } | undefined;

    const factory: WhatsAppSocketFactory = (config) => {
        trace.push('connect');

        if (failure) {
            const { error } = failure;

            failure = undefined;

            throw error;
        }

        const listeners = new Map<string, Set<Listener>>();
        const sent: FakeSocket['sent'] = [];
        const lids = new Map<string, string>();
        let ended = 0;
        let count = 0;

        const socket: FakeSocket = {
            config,
            sent,
            lids,
            user: undefined as Contact | undefined,
            get ended() {
                return ended;
            },
            ev: {
                on(event, listener) {
                    const set = listeners.get(event) ?? new Set();

                    set.add(listener as Listener);
                    listeners.set(event, set);
                },
                off(event, listener) {
                    listeners.get(event)?.delete(listener as Listener);
                },
            },
            signalRepository: { lidMapping: { getPNForLID: async (lid: string) => lids.get(lid) ?? null } },
            async end() {
                trace.push('disconnect');
                ended += 1;
                await socket.onEnd?.();
            },
            async sendMessage(jid, content, options) {
                const text = 'text' in content && typeof content.text === 'string' ? content.text : '';
                const messageId = options?.messageId;

                sent.push({
                    jid,
                    text,
                    ...(messageId ? { messageId } : {}),
                });

                if (socket.onSend) {
                    return socket.onSend(jid, text, messageId);
                }

                count += 1;

                return {
                    key: {
                        remoteJid: jid,
                        fromMe: true,
                        id: messageId ?? `sent-${count}`,
                    },
                };
            },
            emit(event, arg) {
                for (const listener of listeners.get(event) ?? []) {
                    (listener as (value: typeof arg) => void)(arg);
                }
            },
            listenerCount() {
                return listeners.values().toArray().reduce((sum, set) => sum + set.size, 0);
            },
            open() {
                socket.user = {
                    id: '4900000000000:3@s.whatsapp.net',
                    lid: '900000000000:3@lid',
                };
                socket.emit('connection.update', { connection: 'open' });
            },
            close(statusCode) {
                socket.emit('connection.update', {
                    connection: 'close',
                    lastDisconnect: {
                        error: Object.assign(new Error('Connection Closed'), { output: { statusCode } }),
                        date: new Date(0),
                    },
                });
            },
            deliver(...messages) {
                socket.emit('messages.upsert', { messages, type: 'notify' });
            },
        };

        sockets.push(socket);

        return socket;
    };

    return {
        factory,
        sockets,
        last() {
            const socket = sockets.at(-1);

            if (!socket) {
                throw new Error('no socket was made');
            }

            return socket;
        },
        failNext(error) {
            failure = { error };
        },
    };
}

let sequence = 0;

/** An incoming WhatsApp text message (a group message when `chat` is a group jid). */
export function waMessage(input: {
    chat: string;
    text?: string;
    id?: string;
    participant?: string;
    participantAlt?: string;
    remoteJidAlt?: string;
    fromMe?: boolean;
    mentions?: string[];
    pushName?: string;
    image?: boolean;
}): WAMessage {
    sequence += 1;

    const text = input.text ?? 'hello';
    const contextInfo = input.mentions ? { mentionedJid: input.mentions } : undefined;
    let message: WAMessage['message'];

    if (input.image) {
        message = { imageMessage: { caption: text, mimetype: 'image/jpeg' } };
    } else if (contextInfo) {
        message = { extendedTextMessage: { text, contextInfo } };
    } else {
        message = { conversation: text };
    }

    return {
        key: {
            remoteJid: input.chat,
            fromMe: input.fromMe === true,
            id: input.id ?? `MSG${sequence}`,
            ...(input.participant ? { participant: input.participant } : {}),
            ...(input.participantAlt ? { participantAlt: input.participantAlt } : {}),
            ...(input.remoteJidAlt ? { remoteJidAlt: input.remoteJidAlt } : {}),
        },
        message,
        messageTimestamp: 1_793_000_000,
        ...(input.pushName ? { pushName: input.pushName } : {}),
    };
}

export type WhatsAppFixture = {
    setup: WhatsAppChatSetup;
    channel: ChatChannel;
    auth: RecordingAuth;
    sockets: FakeSockets;
    trace: string[];
    clock: ControllableClock;
    engine: Engine;
    store: IStore;
    errors: unknown[];
    pairings: WhatsAppPairing[];
    access: ConversationAccess[];
    runs(): Promise<Run[]>;
};

export type WhatsAppFixtureInput = {
    patch?: Partial<WhatsAppChatOptions>;
    agents?: (channel: ChatChannel) => Agent[];
};

/** createWhatsAppChat() over the fake sockets and the recording auth, on an Engine with a memory store. */
export function createWhatsAppFixture(input: WhatsAppFixtureInput = {}): WhatsAppFixture {
    const trace: string[] = [];
    const clock = new ControllableClock(new Date('2026-11-01T09:00:00Z'));
    const auth = createRecordingAuth(trace);
    const sockets = createFakeSockets(trace);
    const errors: unknown[] = [];
    const pairings: WhatsAppPairing[] = [];
    const access: ConversationAccess[] = [];
    const setup = createWhatsAppChat({
        account: 'support',
        auth: auth.provider,
        policy: { senders: [ALICE], groups: [GROUP] },
        resolveInvoker: (identity) => ({
            id: identity.sender,
            kind: 'whatsapp',
            permissions: [],
        }),
        state: createMemoryState(),
        approvalUrl: (ref) => `https://chamvi.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`,
        onPairing: (pairing) => {
            pairings.push(pairing);
        },
        onError: (error) => {
            errors.push(error);
        },
        socketFactory: sockets.factory,
        ...input.patch,
    });
    const { channel } = setup;
    const memory = createMemoryStore({ clock });
    const engine = new Engine({
        store: memory,
        agents: input.agents ? input.agents(channel) : [defineAgent({
            name: 'assistant',
            model: textModel(),
            instructions: 'Answer.',
            channels: [channel.on()],
        })],
        channels: [channel],
        clock,
        conversations: {
            authorize: (item) => {
                access.push(item);

                return true;
            },
        },
        onError: (error) => {
            errors.push(error);
        },
    });

    return {
        setup,
        channel,
        auth,
        sockets,
        trace,
        clock,
        engine,
        store: memory,
        errors,
        pairings,
        access,
        runs: async () => (await memory.runs.find({})).data,
    };
}

/** lets queued promise work run (no timers) */
export async function settle(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }
}
