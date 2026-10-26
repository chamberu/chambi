// #region app
// src/index.ts
import {
    createApp,
    defineAgent,
    defineTool,
    http,
    resolveModel,
} from '@chamvi/app';
import { generateText } from 'ai';
import { z } from 'zod';

// a tool asks a model of its own: resolveModel() goes through the app's providers
const summarize = defineTool({
    description: 'Summarizes a long text.',
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }, { context }) => {
        const { text: summary } = await generateText({
            // the cheap model of the router below; resolveModel(context) alone is the run's agent model
            model: resolveModel(context, 'router/cc/claude-haiku-4-5'),
            prompt: `Summarize in three sentences:\n\n${text}`,
            abortSignal: context.run.signal,
        });
        return summary;
    },
});

const triage = defineAgent({
    name: 'triage',
    // no model: the app's default below
    instructions: 'Triage the reported issue: label it and summarize the next step.',
    channels: [http.on()],
    tools: { summarize },
});

const review = defineAgent({
    name: 'review',
    // provider "team-a", model "claude-opus-4-6": split at the first '/'
    model: 'team-a/claude-opus-4-6',
    instructions: 'Review the change and list what is missing.',
    channels: [http.on()],
});

export default createApp({
    // the default of agents without a model; CHAMVI_MODEL and chamvi.json win over it
    model: 'anthropic/claude-sonnet-5-5',
    providers: {
        // a second Anthropic key: CHAMVI_PROVIDER_TEAM_A_API_KEY would win over this one
        'team-a': { type: 'anthropic', apiKey: { env: 'TEAM_A_KEY' } },
        // a self-hosted router; the deployment sets only CHAMVI_PROVIDER_ROUTER_API_KEY
        router: { type: 'openai-compatible', baseURL: 'http://9router:20128/v1' },
    },
    agents: [triage, review],
});
// #endregion app
