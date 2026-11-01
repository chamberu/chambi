import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { IEngine } from '@chamvi/core';
import { createWhatsAppChat } from '@chamvi/chat/baileys';
import type { WhatsAppChatOptions } from '@chamvi/chat/baileys';

export function createWhatsAppEngine(
    model: LanguageModel,
    // auth: your secure session store; state: a Chat SDK state adapter
    options: Pick<WhatsAppChatOptions, 'auth' | 'state' | 'onPairing' | 'socketFactory' | 'clock'>,
): IEngine {
    const { WHATSAPP_SENDERS, APP_URL } = process.env;

    if (!WHATSAPP_SENDERS || !APP_URL) {
        throw new Error('Set WHATSAPP_SENDERS (phone number jids, comma separated) and APP_URL.');
    }

    const whatsapp = createWhatsAppChat({
        // a non-secret alias of the account, not its phone number
        account: 'assistant',
        // only these senders start runs; everybody else is ignored
        policy: { senders: WHATSAPP_SENDERS.split(',') },
        resolveInvoker: (identity) => ({
            id: identity.sender,
            kind: 'whatsapp',
            permissions: [],
        }),
        // a link to the approval in the chamvi UI: ids only, answered there
        approvalUrl: ({ runId, approvalId }) => `${APP_URL}/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
        ...options,
    });

    const reply = defineTool({
        description: 'Reply in the chat the message came from.',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }, { context }) => {
            // the source chat: no address needed
            await context.channels.findOneOrFail('chat').emit({ body: text });

            return 'sent';
        },
    });

    const assistant = defineAgent({
        name: 'assistant',
        model,
        instructions: 'You are the owner\'s assistant on WhatsApp. Answer with the reply tool.',
        // one memory per direct chat and one per group
        conversation: true,
        // direct messages and mentions in an allowed group
        channels: [whatsapp.channel.on()],
        tools: { reply },
    });

    return new Engine({
        // memory store: conversations included; use @chamvi/store-db in production
        store: createMemoryStore({ clock: options.clock }),
        agents: [assistant],
        channels: [whatsapp.channel],
        clock: options.clock,
        conversations: { authorize: ({ agent }) => agent === 'assistant' },
    });
}
