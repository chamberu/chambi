import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    AppToken,
    createApp,
    defineAgent,
    defineTool,
    hasConversation,
    memoryTools,
} from '@chamvi/app';
import type { ConversationOptions, IChannel, IEngine } from '@chamvi/app';

export function conversationApp(model: LanguageModel, chat: IChannel, authorize: ConversationOptions['authorize']) {
    // #region app
    const reply = defineTool({
        description: 'Send an answer to this conversation.',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }, { context }) => context.channels.findOneOrFail(chat.name).emit({ body: text }),
    });
    const helper = defineAgent({
        name: 'helper',
        model,
        conversation: { key: 'helper' }, // keep this key when renaming the agent
        instructions: 'Help the user. Send answers with reply. Save notes only when explicitly asked.',
        channels: [{
            channel: chat.name,
            id: 'message',
            options: {},
        }],
        tools: (ctx) => ({ reply, ...(hasConversation(ctx) ? memoryTools() : {}) }),
    });

    return createApp({
        agents: [helper],
        conversations: {
            authorize, // your policy checks authenticated identities for dispatch, recall and notes
            limits: {
                maxItems: 20,
                maxHistoryBytes: 32768,
                maxNotesBytes: 8192,
            },
        },
        modules: [{
            name: 'example:chat',
            async setup(container) {
                container.registerMany(AppToken.CHANNELS, { useValue: chat });
            },
        }],
    });
    // #endregion app
}

// #region intake
export async function firstMessage(engine: IEngine, chat: IChannel) {
    // `chat` must be the exact registered adapter. Its authenticated event supplies these fields.
    const text = 'Please remember that I prefer short answers.';

    await engine.channelContext(chat).dispatchConversation({
        agent: 'helper',
        trigger: 'message',
        address: 'example-chat',
        payload: { text },
        idempotencyKey: 'example-event-1',
    }, {
        account: 'main',
        chat: 'example-chat',
        audience: 'direct',
        text,
    });
    await engine.idle();
}

export async function nextMessage(engine: IEngine, chat: IChannel) {
    // After a restart, use the new engine and its exact registered adapter, with the same database.
    const text = 'What answer style do I prefer?';

    await engine.channelContext(chat).dispatchConversation({
        agent: 'helper',
        trigger: 'message',
        address: 'example-chat',
        payload: { text },
        idempotencyKey: 'example-event-2',
    }, {
        account: 'main',
        chat: 'example-chat',
        audience: 'direct',
        text,
    });
    await engine.idle();
}
// #endregion intake

export async function manageConversation(engine: IEngine, chat: IChannel) {
    // #region management
    const identity = {
        agent: 'helper',
        channel: chat.name,
        account: 'main',
        chat: 'example-chat',
        audience: 'direct',
    };
    const inspection = await engine.inspectConversation(identity, { limit: 20, offset: 0 });

    await engine.resetConversation(identity, { keepNotes: true });
    await engine.deleteConversation(identity);
    await engine.pruneConversations();

    // #endregion management
    return inspection;
}
