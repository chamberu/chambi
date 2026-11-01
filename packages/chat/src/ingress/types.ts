/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import type { Adapter, Message } from 'chat';

/**
 * A Chat SDK adapter wrapped by createChatIngressAdapter(): register it with
 * the Chat in place of the adapter it wraps.
 */
export type ChatIngress = Adapter & { readonly name: string };

/** One incoming message as the wrapped adapter handed it to processMessage. */
export type ChatIncoming = {
    adapter: Adapter;
    threadId: string;
    message: Message;
};

/** Takes the messages of an ingress; a rejection is a message not accepted. */
export interface IChatReceiver {
    receive(input: ChatIncoming): Promise<void>;
}
