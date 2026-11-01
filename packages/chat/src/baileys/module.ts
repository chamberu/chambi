/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { makeWASocket } from 'baileys';
import { Chat } from 'chat';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Invoker } from '@chamvi/core';
import { isObject } from 'smob';
import { createChatChannel } from '../channel/module.ts';
import { createChatIntake } from '../intake/module.ts';
import { createChatIngressAdapter } from '../ingress/module.ts';
import type { ChatIncoming } from '../ingress/types.ts';
import { createWhatsAppAdapter } from './adapter.ts';
import { MESSAGE_ID_PREFIX, WHATSAPP_ADAPTER_NAME } from './constants.ts';
import { isAllowed, resolvePolicy, toConversationTarget } from './policy.ts';
import type { WhatsAppChatOptions, WhatsAppChatSetup } from './types.ts';

function invalid(message: string): InvalidAgentDefinitionError {
    return new InvalidAgentDefinitionError(`createWhatsAppChat: ${message}`);
}

function assertOptions(options: WhatsAppChatOptions): void {
    if (!isObject(options)) {
        throw invalid('options must be an object.');
    }

    if (typeof options.account !== 'string' || options.account.length === 0 || options.account.includes('\0')) {
        throw invalid('account must be a non-empty string without NUL (an alias, not a phone number or secret).');
    }

    if (!isObject(options.auth) || typeof options.auth.acquire !== 'function') {
        throw invalid('auth must be an auth provider with acquire(signal).');
    }

    if (!isObject(options.state)) {
        throw invalid('state must be a Chat SDK StateAdapter.');
    }

    for (const key of ['resolveInvoker', 'approvalUrl', 'onPairing'] as const) {
        if (typeof options[key] !== 'function') {
            throw invalid(`${key} must be a function.`);
        }
    }

    for (const key of ['onError', 'socketFactory'] as const) {
        if (options[key] !== undefined && typeof options[key] !== 'function') {
            throw invalid(`${key} must be a function.`);
        }
    }
}

/** A WhatsApp message id from a send's key: one key, one id, under every retry. */
function messageIdOf(channel: string, key: string): string {
    return MESSAGE_ID_PREFIX + createHash('sha256').update(JSON.stringify([channel, key])).digest('hex')
        .slice(0, 36)
        .toUpperCase();
}

/**
 * WhatsApp Web as a chat channel: a Chat SDK Chat with chamvi's adapter on
 * Baileys, wrapped by createChatIngressAdapter(), and its chatChannel().
 * Nothing is acquired or connected here (a factory or `start --check` writes
 * nothing): the channel's start initializes the Chat, then acquires the auth
 * lease, then builds the socket; its stop ends the socket and any reconnect,
 * waits for auth writes, flushes and releases the lease. `status()` follows
 * Baileys' connection events; sends go out only while it is `connected`.
 *
 * A message starts runs only when the policy allows its authenticated
 * identity (WhatsAppPolicy; an unresolved LID, the bot's own messages and
 * unknown senders are denied) and `resolveInvoker` names an invoker (undefined
 * denies). An agent with `conversation` gets the conversation
 * `{ account, chat jid, direct:<sender> | group:<group jid> }`.
 *
 * Each send carries a message id derived from the message key, so a retry
 * reuses it; whether WhatsApp drops such a duplicate is not verified, so
 * delivery is at least once.
 */
export function createWhatsAppChat(options: WhatsAppChatOptions): WhatsAppChatSetup {
    assertOptions(options);

    const policy = resolvePolicy(options.policy);
    // eslint-disable-next-line no-console
    const onError = options.onError ?? ((error: unknown) => console.error('[chamvi]', error));
    const adapter = createWhatsAppAdapter({
        account: options.account,
        userName: options.userName ?? 'chamvi',
        auth: options.auth,
        socketFactory: options.socketFactory ?? makeWASocket,
        ...(options.socketOptions ? { socketOptions: options.socketOptions } : {}),
        onPairing: options.onPairing,
        onError,
        ...(options.clock ? { clock: options.clock } : {}),
    });
    const ingress = createChatIngressAdapter(adapter);
    const chat = new Chat({
        userName: options.userName ?? 'chamvi',
        adapters: { [WHATSAPP_ADAPTER_NAME]: ingress },
        state: options.state,
        logger: options.logger ?? 'warn',
        concurrency: 'concurrent',
    });

    // the invoker the policy decision found, kept for the channel's resolveInvoker
    const invokers = new WeakMap<object, Invoker>();

    const allowMessage = async (incoming: ChatIncoming): Promise<boolean> => {
        const identity = adapter.identityOf(incoming.message);

        if (!identity || !isAllowed(policy, identity)) {
            return false;
        }

        const invoker = await options.resolveInvoker(identity);

        if (!invoker) {
            return false;
        }

        invokers.set(incoming.message, invoker);

        return true;
    };

    const { name } = options;
    const channel = createChatChannel({
        chat,
        adapters: [ingress],
        ...(name !== undefined ? { name } : {}),
        ...(options.untrusted !== undefined ? { untrusted: options.untrusted } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        account: options.account,
        connect: (ctx) => adapter.connection.connect(ctx),
        disconnect: () => adapter.connection.close(),
        allowMessage,
        resolveInvoker: (incoming) => invokers.get(incoming.message),
        approvalUrl: options.approvalUrl,
        onError,
    }, createChatIntake(), {
        online: () => adapter.connection.status() === 'connected',
        prepare: ({
            threadId,
            text,
            key,
        }) => {
            // refuses a thread of no WhatsApp chat before anything goes out
            adapter.decodeThreadId(threadId);

            const messageId = messageIdOf(channel.name, key);

            return () => adapter.send(threadId, text, messageId);
        },
        conversationTarget: (incoming, payload) => {
            const identity = adapter.identityOf(incoming.message);

            return identity ? toConversationTarget(identity, payload.message.text) : undefined;
        },
    });

    return {
        chat,
        ingress,
        channel,
        status: () => adapter.connection.status(),
    };
}
