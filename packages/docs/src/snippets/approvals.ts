import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    RunStatus,
    ToolDeniedError,
    approve,
    consoleChannel,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';

declare function deployVersion(version: string, env: string): Promise<string>;
declare function runShell(command: string): Promise<string>;

// #region tool
const deploy = defineTool({
    description: 'Deploys a version to an environment.',
    inputSchema: z.object({ version: z.string(), env: z.enum(['staging', 'prod']) }),
    execute: async ({ version, env }, { context }) => {
        if (env === 'prod') {
            // pauses the run in `waiting`; once answered, the call runs again and gets the decision
            const decision = await approve(context, {
                title: `Deploy ${version} to prod?`,
                body: 'Staging has been green for a day.',
                timeoutMs: 60 * 60 * 1000,
            });

            if (!decision.approved) {
                return `Not deployed: ${decision.reason ?? 'denied'}.`;
            }
        }

        // staging deploys run right away
        return deployVersion(version, env);
    },
});
// #endregion tool

// #region choice
const RULES = [
    {
        id: 'unicorn/no-null',
        label: 'unicorn/no-null',
        detail: '@@ -1 +1 @@\n-const user = null;\n+const user = undefined;',
    },
    {
        id: 'unicorn/prefer-at',
        label: 'unicorn/prefer-at',
        detail: '@@ -1 +1 @@\n-items[items.length - 1]\n+items.at(-1)',
    },
];

const pickRules = defineTool({
    description: 'Asks which new lint rules to adopt.',
    inputSchema: z.object({}),
    execute: async (_input, { context }) => {
        const decision = await approve(context, {
            title: 'Adopt which new rules?',
            body: 'Each option shows what the rule changes.',
            options: RULES,
            multiple: true,
        });

        if (!decision.approved) {
            return `Adopt none: ${decision.reason ?? 'denied'}.`;
        }

        // map the ids back to your own options; an id you do not know is a denial
        const adopted = RULES.filter((rule) => decision.selected?.includes(rule.id));

        return `Adopt ${adopted.map((rule) => rule.id).join(', ')}.`;
    },
});
// #endregion choice

// #region channel
const restart = defineTool({
    description: 'Restarts the service.',
    inputSchema: z.object({ service: z.string() }),
    execute: async ({ service }, { context }) => {
        // the request also goes out through the channel (kind 'approval')
        const { approved } = await context.channels.findOneOrFail('console').approve({
            title: `Restart ${service}?`,
            address: 'ops',
        });

        return approved ? `restarted ${service}` : 'left running';
    },
});
// #endregion channel

// #region hook
// a tool from another library: you cannot put approve() into its execute
const shell = tool({
    description: 'Runs a shell command.',
    inputSchema: z.object({ command: z.string() }),
    execute: async ({ command }) => runShell(command),
});

export function createOperator(model: LanguageModel) {
    return defineAgent({
        name: 'operator',
        model,
        instructions: 'Keep the service healthy.',
        tools: { shell, restart },
        hooks: {
            // runs before every tool call, inside the call: approve() works here and replays on resume
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'shell') {
                    return input;
                }

                const { command } = input as { command: string };
                const decision = await approve(ctx, { title: 'Run a shell command?', body: command });

                // a tool error the model sees; the run goes on
                if (!decision.approved) {
                    throw new ToolDeniedError(`Refused: ${decision.reason ?? 'denied'}`);
                }

                return input;
            },
            // runs on a fresh and on a recorded result alike: redact before the model sees it
            afterToolExecution({ output }) {
                return typeof output === 'string' ? output.replaceAll(/ghp_\w+/g, '[token]') : output;
            },
        },
    });
}
// #endregion hook

export async function approvalFlow(model: LanguageModel) {
    // #region engine
    const deployer = defineAgent({
        name: 'deployer',
        model,
        instructions: 'Deploy the requested version.',
        tools: {
            deploy,
            restart,
            pickRules,
        },
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [deployer],
        channels: [consoleChannel()],
    });
    // #endregion engine

    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'deployer',
        trigger: 'manual',
        channel: 'console',
        payload: { version: '1.4.0', env: 'prod' },
    });

    await engine.idle();

    // #region answer
    const run = await engine.getRun(runId);

    if (run?.status === RunStatus.WAITING && run.waiting) {
        // run.waiting: { approvalId, toolName, toolCallId, title, body?, channel?, address?, expiresAt, ... }
        await engine.approve(run.id, {
            approvalId: run.waiting.approvalId,
            approved: false,
            reason: 'Not on a Friday.',
        });
    }
    // #endregion answer

    await engine.idle();
    await engine.stop();

    return engine.getRun(runId);
}
