import { readFile } from 'node:fs/promises';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { cron, cronChannel } from '@chamvi/channel-cron';
import {
    Engine,
    ValidationError,
    consoleChannel,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    ChannelContext,
    ChannelMessage,
    ChannelRequest,
    ChannelSendOptions,
    IChannel,
} from '@chamvi/core';
import {
    http,
    httpChannel,
    readRequestBody,
    webhook,
    webhookChannel,
} from '@chamvi/http';
import type { Authenticator } from '@chamvi/http';

export async function dispatchExamples(model: LanguageModel, auth: Authenticator) {
    // #region subscriptions
    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Triage the issue in the payload.',
        channels: [
            http.on(), // channel 'http', id 'http'
            webhook.on('/issues'), // channel 'webhook', id 'webhook:/issues'
            cron.on('*/30 * * * *', { overlap: 'skip' }), // channel 'cron', id 'cron:*/30 * * * *'
        ],
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [triage],
        // every subscribed channel must be registered (InvalidAgentDefinitionError otherwise)
        channels: [httpChannel(), webhookChannel({ auth }), cronChannel()],
    });
    // #endregion subscriptions

    // #region dispatch
    const first = await engine.dispatch({
        agent: 'triage',
        trigger: 'webhook:/issues',
        channel: 'webhook',
        payload: { repo: 'acme/app', issue: 42 },
        // where the run came from on its channel; ctx.channels.findOne() answers there
        address: 'acme/app#42',
        // a redelivery with the same key returns the same run
        idempotencyKey: 'delivery-7f3a',
        // one run at a time per issue
        concurrencyKey: 'acme/app#42',
    });

    const again = await engine.dispatch({
        agent: 'triage',
        trigger: 'webhook:/issues',
        channel: 'webhook',
        payload: { repo: 'acme/app', issue: 42 },
        idempotencyKey: 'delivery-7f3a',
    });

    again.runId === first.runId; // true
    again.deduplicated; // true
    // #endregion dispatch

    // #region attachments
    const withFile = await engine.dispatch({
        agent: 'triage',
        trigger: 'http',
        channel: 'http',
        payload: { repo: 'acme/app', issue: 43 },
        // stored as artifacts of the run; the model gets them as file parts
        attachments: [{
            mediaType: 'image/png',
            filename: 'crash.png',
            data: new Uint8Array(await readFile('crash.png')),
        }],
    });

    const run = await engine.getRun(withFile.runId);
    run?.trigger.attachments; // [{ id, runId, agent, mediaType: 'image/png', filename: 'crash.png', size, createdAt }]
    // #endregion attachments

    return { first, again };
}

// #region outbound
export const resolve = defineTool({
    description: 'Report the fix and tell the on-call channel.',
    inputSchema: z.object({ summary: z.string() }),
    async execute({ summary }, { context }) {
        // the run's source channel at its source address; undefined when that channel has no out
        await context.channels.findOne()?.emit({ body: summary });
        // any registered channel with out; the address is required off the source channel
        await context.channels.findOneOrFail('console').emit({ title: 'Resolved', body: summary }, 'on-call');
        return 'reported';
    },
});

export function createEngine(model: LanguageModel) {
    return new Engine({
        store: createMemoryStore(),
        agents: [defineAgent({
            name: 'fixer',
            model,
            instructions: 'Fix the issue, then report it.',
            tools: { resolve },
        })],
        channels: [consoleChannel()],
    });
}
// #endregion outbound

// #region custom
type ChatPost = {
    channel: string; 
    text: string; 
    user: string 
};

/** A chat bridge: messages in at POST /channels/chat, answers out to the chat's API. */
export function chatChannel(options: { secret: string; apiUrl: string }): IChannel {
    return {
        name: 'chat',

        // served by createHttpApp({ channels: [chat] }) at POST /channels/chat[/...]
        async in({ request }: ChannelRequest, ctx: ChannelContext): Promise<Response> {
            // the http app never authenticates channel routes: check your own credentials
            if (request.headers.get('authorization') !== `Bearer ${options.secret}`) {
                return new Response(null, { status: 401 });
            }
            // 413 above the limit
            const bytes = await readRequestBody(request, { limit: 64 * 1024 });
            const post = JSON.parse(new TextDecoder().decode(bytes)) as ChatPost;
            if (typeof post.text !== 'string') throw new ValidationError('text is required.');

            // dispatches as this channel (envelope channel 'chat'), never as another
            const { runId } = await ctx.dispatch({
                agent: 'helpdesk',
                trigger: 'chat',
                payload: post,
                address: post.channel,
            });
            return Response.json({ runId }, { status: 202 });
        },

        // called for emit() and for approval requests; must be idempotent on message.key
        async out(message: ChannelMessage, address: string, opts: ChannelSendOptions): Promise<void> {
            const response = await fetch(`${options.apiUrl}/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'idempotency-key': message.key },
                body: JSON.stringify({
                    channel: address,
                    text: [message.title, message.body].filter(Boolean).join('\n'),
                    // an approval carries its id and expiry: link to the UI
                    link: message.approvalId ?
                        `https://chamvi.example/ui/approvals?run=${message.runId}&approval=${message.approvalId}` :
                        undefined,
                }),
                signal: opts.signal,
            });
            // throw on failure: an emit records nothing, an approval is re-sent on the next poll
            if (!response.ok) throw new Error(`Chat answered ${response.status}.`);
        },
    };
}
// #endregion custom
