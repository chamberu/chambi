// #region modules
// src/index.ts
import {
    ToolDeniedError,
    createApp,
    defineAgent,
} from '@chamvi/app';
import { githubModule } from '@chamvi/github/module';
import { openclawModule } from '@chamvi/channel-openclaw/module';
import { sandboxModule } from '@chamvi/sandbox/module';
import { uiModule } from '@chamvi/ui/module';
import { codingTools } from '@chamvi/coding';
import { github, injectGithubContext } from '@chamvi/github';
import { injectSandboxContext } from '@chamvi/sandbox';

// every factory reads its env when it is called (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ...)
const githubApp = githubModule();
// CHAMVI_SANDBOX_PROVIDER, when set, wins over the option
const sandbox = sandboxModule({
    provider: 'docker',
    allowRepo: (url) => url.startsWith('https://github.com/acme/'),
});

const repro = defineAgent({
    name: 'repro',
    instructions: 'Reproduce the reported bug with a failing test and comment the result.',
    channels: [github.on('issues.labeled')],
    // each module provides its instance on the engine; a factory injects it per execution
    // (github.app and sandbox.manager still exist at import time, for definition-time use)
    tools: (ctx) => {
        const manager = injectSandboxContext(ctx);
        return {
            ...injectGithubContext(ctx).readTools(),
            ...manager.tools(),
            ...codingTools(manager),
        };
    },
    hooks: {
        // every shell command waits for the owner, asked in their OpenClaw chat
        async beforeToolExecution({ toolName, input }, ctx) {
            if (toolName !== 'bash') return input;
            const { approved } = await ctx.channels.findOneOrFail('openclaw').approve({
                title: 'Run a shell command?',
                body: (input as { command: string }).command,
            });
            if (!approved) throw new ToolDeniedError('The owner refused the command.');
            return input;
        },
    },
});

export default createApp({
    // repro has no model of its own: it takes this default
    model: 'anthropic/claude-sonnet-5-5',
    agents: [repro],
    modules: [
        // the github channel: deliveries at POST /channels/github, comments out
        githubApp,
        // attached to the engine on start, closed after the engine drained
        sandbox,
        // the channel named 'openclaw', approval links from CHAMVI_PUBLIC_URL
        openclawModule(),
        // the dashboard at /ui
        uiModule(),
    ],
});
// #endregion modules
