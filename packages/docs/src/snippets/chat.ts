import type { LanguageModel } from 'ai';
import { Chat } from 'chat';
import type { Adapter, StateAdapter } from 'chat';
import { z } from 'zod';
import { createApp } from '@chamvi/app';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import { chatChannel, createChatIngressAdapter } from '@chamvi/chat';
import { createWhatsAppChat } from '@chamvi/chat/baileys';
import type { IWhatsAppAuthProvider } from '@chamvi/chat/baileys';
import { chatModule } from '@chamvi/chat/module';

declare const model: LanguageModel;
// your secure, exclusive session store (chamvi ships none)
declare const auth: IWhatsAppAuthProvider;
// a Chat SDK state adapter
declare const state: StateAdapter;
// any Chat SDK adapter of a webhook platform
declare const platformAdapter: Adapter;
declare function showQr(qr: string): void;

const approvalUrl = ({ runId, approvalId }: { runId: string; approvalId: string }) => `https://chamvi.example/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`;

// #region whatsapp
const whatsapp = createWhatsAppChat({
    // a non-secret alias of the account (the conversation account)
    account: 'assistant',
    auth,
    state,
    // placeholder jids: phone number jids, no device suffix; groups need a mention by default
    policy: { senders: ['491701111111@s.whatsapp.net'], groups: ['120363000000000001@g.us'] },
    // undefined denies the message
    resolveInvoker: (identity) => ({
        id: identity.sender,
        kind: 'whatsapp',
        permissions: [],
    }),
    approvalUrl,
    // render the QR for the phone; never log it
    onPairing: ({ qr }) => showQr(qr),
});
// #endregion whatsapp

// #region agent
const reply = defineTool({
    description: 'Reply in the chat the message came from.',
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }, { context }) => {
        // the source chat: no address, and no outbound gate in a tainted run
        await context.channels.findOneOrFail('chat').emit({ body: text });

        return 'sent';
    },
});

export const assistant = defineAgent({
    name: 'assistant',
    model,
    instructions: 'Answer with the reply tool.',
    // one memory per direct chat and one per group
    conversation: true,
    // direct messages and group mentions (events: ['direct', 'mention'])
    channels: [whatsapp.channel.on()],
    tools: { reply },
});

export const engine = new Engine({
    store: createMemoryStore(),
    agents: [assistant],
    channels: [whatsapp.channel],
    conversations: { authorize: ({ agent }) => agent === 'assistant' },
});
// #endregion agent

// #region generic
const ingress = createChatIngressAdapter(platformAdapter);
const chat = new Chat({
    userName: 'chamvi',
    adapters: { [ingress.name]: ingress },
    state,
    concurrency: 'concurrent',
});

export const platform = chatChannel({
    chat,
    adapters: [ingress],
    name: 'platform',
    // required for every adapter: who may start runs
    allowMessage: ({ message }) => message.author.userId === 'U0123',
    // served at POST /channels/platform/<adapter>
    webhooks: [ingress.name],
    approvalUrl,
});
// #endregion generic

// #region module
export default createApp({
    agents: [assistant],
    modules: [chatModule({ channel: whatsapp.channel })],
    conversations: { authorize: ({ agent }) => agent === 'assistant' },
});
// #endregion module
