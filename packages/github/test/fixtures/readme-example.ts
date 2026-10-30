import type { LanguageModel } from 'ai';
import {
    Engine,
    ToolDeniedError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { createGithubApp, github, githubChannel } from '@chamvi/github';
import type { GithubAppOptions } from '@chamvi/github';
import { createHttpApp, createShutdown, staticTokens } from '@chamvi/http';

export async function createTriageServer(
    model: LanguageModel,
    options: Pick<GithubAppOptions, 'fetch' | 'clock'> = {},
) {
    const {
        GITHUB_APP_ID,
        GITHUB_PRIVATE_KEY,
        GITHUB_WEBHOOK_SECRET,
        CHAMVI_TOKEN,
    } = process.env;

    if (!GITHUB_APP_ID || !GITHUB_PRIVATE_KEY || !GITHUB_WEBHOOK_SECRET || !CHAMVI_TOKEN) {
        throw new Error('Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET and CHAMVI_TOKEN.');
    }

    const gh = createGithubApp({
        appId: GITHUB_APP_ID,
        privateKey: GITHUB_PRIVATE_KEY,
        webhookSecret: GITHUB_WEBHOOK_SECRET,
        ...options,
    });
    // deliveries in, issue comments out
    const channel = githubChannel({ app: gh, clock: options.clock });

    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Label new issues and thank the author in one comment.',
        // one run per issues.opened delivery, deduplicated by the delivery id
        channels: [github.on('issues.opened')],
        tools: () => ({ ...gh.readTools(), ...gh.writeTools() }),
        hooks: {
            // closing waits for the owner, asked in a comment on the issue
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'github_close_issue') {
                    return undefined;
                }

                const { approved } = await ctx.channels.findOneOrFail('github').approve({
                    title: 'Close this issue?',
                    body: JSON.stringify(input),
                });

                if (!approved) {
                    throw new ToolDeniedError('The owner keeps the issue open.');
                }

                return undefined;
            },
        },
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [triage],
        channels: [channel],
    });

    const shutdown = createShutdown({ engine });
    const app = createHttpApp({
        engine,
        auth: staticTokens({
            tokens: [{
                value: CHAMVI_TOKEN,
                id: 'ci',
                permissions: ['*'],
            }],
        }),
        // POST /channels/github: point the App's webhook URL here
        channels: [channel],
        shutdown,
    });

    await engine.start();

    return {
        app,
        engine,
        shutdown,
    };
}
