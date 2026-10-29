import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { cron, cronChannel } from '@chamvi/channel-cron';
import type { Stores } from '@chamvi/core';
import {
    Engine,
    ToolDeniedError,
    defineAgent,
    defineTool,
    requireToolPermission,
} from '@chamvi/core';
import { createGithubApp, github, githubChannel } from '@chamvi/github';
import { createHttpApp, staticTokens } from '@chamvi/http';

export function createTriage(model: LanguageModel, store: Stores) {
    // #region app
    const gh = createGithubApp({
        appId: process.env.GITHUB_APP_ID ?? '',
        // a one-line PEM with literal \n works
        privateKey: process.env.GITHUB_PRIVATE_KEY ?? '',
        // [old, new] while rotating the secret
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
        // the bot login without a GET /app
        slug: 'octo-triage',
        // for runs not started by a delivery (the cron sweep below)
        installationId: 12345678,
    });

    // deliveries in at POST /channels/github, issue comments out
    const channel = githubChannel({
        app: gh,
        // mentioned at the top of every comment
        mention: 'octocat',
        // a link to the approval in the UI, without the token
        approvalUrl: ({ runId, approvalId }) => `https://chamvi.example/ui/approvals?run=${encodeURIComponent(runId)}&approval=${encodeURIComponent(approvalId)}`,
        // raise for large push or pull_request deliveries
        bodyLimit: 4 * 1024 * 1024,
    });
    // #endregion app

    // #region agent
    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Label new issues and ask for missing details in one comment.',
        channels: [
            github.on('issues.opened', {
                // skip issues opened by bots
                filter: (event) => event.payload.sender?.type !== 'Bot',
            }),
            // a sweep for issues missed while the app was down
            cron.on('0 * * * *'),
        ],
        tools: () => ({ ...gh.readTools(), ...gh.writeTools() }),
        hooks: {
            // closing waits for the owner, asked in a comment on the run's issue
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'github_close_issue') return input;
                const { approved } = await ctx.channels.findOneOrFail('github').approve({
                    title: 'Close this issue?',
                    body: JSON.stringify(input),
                });
                if (!approved) throw new ToolDeniedError('The owner keeps the issue open.');
                return input;
            },
        },
        // delivery and cron runs have no invoker
        toolPolicy: requireToolPermission({ withoutInvoker: 'allow' }),
    });
    // #endregion agent

    // #region http
    const engine = new Engine({
        stores: store,
        agents: [triage],
        channels: [channel, cronChannel()],
    });
    const app = createHttpApp({
        engine,
        auth: staticTokens({
            tokens: [{
                value: process.env.CHAMVI_TOKEN ?? '',
                id: 'ci',
                permissions: ['*'],
            }],
        }),
        // POST /channels/github: the App's webhook URL
        channels: [channel],
    });
    // #endregion http

    return {
        app,
        engine,
        gh,
    };
}

// #region outbound
export const answer = defineTool({
    description: 'Answer on the issue.',
    inputSchema: z.object({ body: z.string() }),
    async execute({ body }, { context }) {
        // a github run: a comment on the issue it came from
        await context.channels.findOne()?.emit({ body });
        // any issue: the address is <owner>/<repo>#<number>
        await context.channels.findOneOrFail('github').emit({ title: 'Triage log', body }, github.to({ repo: 'octo/ops', number: 1 }));
        return 'sent';
    },
});
// #endregion outbound
