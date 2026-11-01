/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    isJidGroup,
    isLidUser,
    isPnUser,
    jidNormalizedUser,
    normalizeMessageContent,
    toNumber,
} from 'baileys';
import type { BaileysEventMap, WAMessage, WAMessageContent } from 'baileys';
import { Message, parseMarkdown, toPlainText } from 'chat';
import type {
    AdapterPostableMessage,
    Attachment,
    ChatInstance,
    RawMessage,
} from 'chat';
import { ChamviError, ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { CHAT_REQUEST_ERROR_CODE } from '../channel/constants.ts';
import { WHATSAPP_ADAPTER_NAME } from './constants.ts';
import { createWhatsAppConnection } from './connection.ts';
import { resolveIdentity } from './policy.ts';
import type {
    WhatsAppAdapter,
    WhatsAppAdapterOptions,
    WhatsAppIdentity,
    WhatsAppSocket,
} from './types.ts';

const THREAD_PREFIX = `${WHATSAPP_ADAPTER_NAME}:`;

/** The media kinds a message may carry: refused by the intake, never downloaded. */
const MEDIA = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['ptvMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'file'],
    ['stickerMessage', 'image'],
] as const;

/** What the adapter reads of a media message: its type and caption, never its bytes. */
type MediaFields = { mimetype?: string | null; caption?: string | null };

function unsupported(method: string): ChamviError {
    return new ChamviError({
        code: CHAT_REQUEST_ERROR_CODE,
        message: `The WhatsApp adapter does not support ${method}.`,
    });
}

function isChatJid(jid: string): boolean {
    return isJidGroup(jid) === true || isPnUser(jid) === true || isLidUser(jid) === true;
}

/** The thread id of a chat jid. */
export function encodeWhatsAppThread(jid: string): string {
    return THREAD_PREFIX + jid;
}

/** The chat jid of a thread id; ValidationError for anything that is no WhatsApp chat. */
export function decodeWhatsAppThread(threadId: string): string {
    const jid = typeof threadId === 'string' && threadId.startsWith(THREAD_PREFIX) ? threadId.slice(THREAD_PREFIX.length) : '';

    if (!isChatJid(jid) || jidNormalizedUser(jid) !== jid) {
        throw new ValidationError('The thread is no WhatsApp chat (a user or group jid).');
    }

    return jid;
}

/** The text and the media of a message's content; undefined for content that is neither (reactions, protocol messages). */
function readContent(content: WAMessageContent | undefined): { text: string; attachments: Attachment[] } | undefined {
    if (!content) {
        return undefined;
    }

    const attachments: Attachment[] = [];
    let caption: string | undefined;

    for (const [field, type] of MEDIA) {
        const media: MediaFields | null | undefined = content[field];

        if (isObject(media)) {
            attachments.push({
                type,
                ...(typeof media.mimetype === 'string' ? { mimeType: media.mimetype } : {}),
            });
            caption ??= typeof media.caption === 'string' ? media.caption : undefined;
        }
    }

    const text = content.conversation ?? content.extendedTextMessage?.text ?? caption;

    if (typeof text !== 'string' && attachments.length === 0) {
        return undefined;
    }

    return { text: text ?? '', attachments };
}

function textOf(message: AdapterPostableMessage): string {
    if (typeof message === 'string') {
        return message;
    }

    if (isObject(message) && 'raw' in message && typeof message.raw === 'string') {
        return message.raw;
    }

    if (isObject(message) && 'markdown' in message && typeof message.markdown === 'string') {
        return message.markdown;
    }

    throw new ValidationError('The WhatsApp adapter sends text only (a string, raw or markdown).');
}

/**
 * The Chat SDK adapter of WhatsApp Web, on Baileys' public socket API.
 * `initialize` only takes the ChatInstance: no auth, no socket. The socket
 * comes from `connection.connect()` (the channel's `connect`), and every
 * text or media message of a direct chat or a group goes to
 * `chat.processMessage` with its resolved identity kept beside it
 * (`identityOf`). Sends go to the jid of the thread id `whatsapp:<jid>` and
 * only while the connection is open.
 */
export function createWhatsAppAdapter(options: WhatsAppAdapterOptions): WhatsAppAdapter {
    let chat: ChatInstance | undefined;
    const identities = new WeakMap<Message, WhatsAppIdentity | undefined>();

    const report = (error: unknown) => {
        try {
            options.onError(error);
        } catch {
            // contained
        }
    };

    // the adapter is referenced by the message handler before it exists
    let adapter!: WhatsAppAdapter;

    const handle = async (socket: WhatsAppSocket, raw: WAMessage): Promise<void> => {
        const content = normalizeMessageContent(raw.message);
        const read = readContent(content);
        const remote = raw.key.remoteJid;
        const { id } = raw.key;

        if (!read || typeof remote !== 'string' || !isChatJid(remote) || typeof id !== 'string' || id.length === 0) {
            return;
        }

        const identity = await resolveIdentity(raw, content, socket, options.account);
        const group = isJidGroup(remote) === true;
        const from = (group ? raw.key.participant : remote) ?? '';
        // the Chat SDK needs an author id. Without an identity it is the raw sender id (a LID), or, for a
        // group message without participant, the group jid: a display value only, since allowMessage
        // denies every message without an identity before the policy or resolveInvoker sees an author
        const author = identity?.sender ?? (from ? jidNormalizedUser(from) : remote);
        const threadId = encodeWhatsAppThread(identity?.chat ?? jidNormalizedUser(remote));
        const seconds = toNumber(raw.messageTimestamp);
        const message = new Message<unknown>({
            id,
            threadId,
            text: read.text,
            formatted: parseMarkdown(read.text),
            raw,
            author: {
                userId: author,
                userName: author,
                fullName: '',
                isBot: false,
                isMe: raw.key.fromMe === true,
            },
            metadata: { dateSent: new Date(seconds > 0 ? seconds * 1000 : 0), edited: false },
            attachments: read.attachments,
            isMention: identity?.mentioned === true,
        });

        identities.set(message, identity);

        if (!chat) {
            return;
        }

        // a refused or failed message is the channel's to report
        await chat.processMessage(adapter, threadId, message).catch(() => undefined);
    };

    const connection = createWhatsAppConnection({
        ...options,
        onMessages: (socket, upsert: BaileysEventMap['messages.upsert']) => {
            // only live messages: history and appends start nothing
            if (upsert.type !== 'notify') {
                return;
            }

            for (const raw of upsert.messages) {
                handle(socket, raw).catch(report);
            }
        },
    });

    const send = async (threadId: string, text: string, messageId?: string): Promise<RawMessage<unknown>> => {
        const jid = decodeWhatsAppThread(threadId);
        const socket = connection.socket();

        if (!socket) {
            throw new ChamviError({
                code: CHAT_REQUEST_ERROR_CODE,
                message: 'The WhatsApp connection is not open; nothing was sent.',
            });
        }

        const sent = await socket.sendMessage(jid, { text }, messageId ? { messageId } : undefined);

        return {
            id: sent?.key.id ?? messageId ?? '',
            threadId,
            raw: sent,
        };
    };

    adapter = {
        name: WHATSAPP_ADAPTER_NAME,
        userName: options.userName,
        connection,
        get botUserId() {
            const id = connection.socket()?.user?.id;

            return id ? jidNormalizedUser(id) : undefined;
        },
        identityOf: (message) => identities.get(message),
        send,
        async initialize(instance) {
            chat = instance;
        },
        disconnect: () => connection.close(),
        encodeThreadId: encodeWhatsAppThread,
        decodeThreadId: decodeWhatsAppThread,
        channelIdFromThreadId: (threadId) => threadId,
        isDM: (threadId) => !threadId.startsWith(THREAD_PREFIX) || isJidGroup(threadId.slice(THREAD_PREFIX.length)) !== true,
        parseMessage() {
            // messages reach the Chat through processMessage only
            throw unsupported('parseMessage');
        },
        async handleWebhook() {
            return new Response(null, { status: 404 });
        },
        postMessage: (threadId, message) => send(threadId, textOf(message)),
        editMessage: () => Promise.reject(unsupported('editMessage')),
        deleteMessage: () => Promise.reject(unsupported('deleteMessage')),
        addReaction: () => Promise.reject(unsupported('addReaction')),
        removeReaction: () => Promise.reject(unsupported('removeReaction')),
        startTyping: () => Promise.resolve(),
        // history is 0: nothing is fetched from the platform
        fetchMessages: () => Promise.resolve({ messages: [] }),
        async fetchThread(threadId) {
            return {
                id: threadId,
                channelId: threadId,
                isDM: adapter.isDM!(threadId),
                metadata: {},
            };
        },
        renderFormatted: (content) => toPlainText(content),
    };

    return adapter;
}
